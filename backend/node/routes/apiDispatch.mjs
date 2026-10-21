import { randomBytes } from 'node:crypto'
import { evaluateResumeAgainstJd, generateVendorAssessmentSheet, vendorReportNeedsRefresh } from '../vendor/aiEvaluation.mjs'
import {
  pingDatabase,
  appendInterviewHistory,
  upsertJobRecord,
  upsertEmployerApplicationRecord,
  upsertJobApplicationRecord,
  deleteJobApplicationRecord,
  loadJobApplicationsForEmail,
  markJobApplicationsDeletedInPostgres,
  deleteJobRecord,
  dbPool,
  loadDb as reloadDbFromStore,
  syncOpenJobsFromDatabase,
  syncOrgJobsFromDatabase,
  syncEmployerApplicationsFromDatabase,
} from '../db/store.mjs'
import { smtpConfigured, smtpConfigSummary, verifySmtpConnection, publicAppOrigin } from '../mail.mjs'
import { sendMail } from '../mail.mjs'
import { groqWhisperConfigured, transcribeWithGroqWhisper } from '../groqWhisper.mjs'
import { parseResumeUploadBody } from '../storage/resumeUploadValidation.mjs'
import {
  objectStorageConfigured,
  resolveResumeDownloadForUser,
  uploadResumeToObjectStorage,
} from '../storage/resumeObjectStorage.mjs'
import {
  newInviteToken,
  insertInterviewInvite,
  getInterviewInviteByToken,
  inviteAccessState,
  sendInterviewInviteEmail,
  invitePublicUrl,
  inviteJoinWindowEnd,
  INVITE_JOIN_WINDOW_MINUTES,
  buildInterviewInviteEmail,
  parseInviteContext,
} from '../interviewInvites.mjs'
import {
  upsertCandidateTalent,
  searchCandidateTalent,
  getCandidateTalentById,
  grantOrganizationTalentAccess,
} from '../db/talentIndex.mjs'
import {
  createVendorJob,
  deleteVendorJob,
  resolvePublicJob,
  parsePublicJobPath,
  listOrgJobs,
  listOpenJobs,
  listOpenJobsPage,
  publicJobListPayload,
  getOrgJob,
  getOrgApplication,
  createJobApplication,
  attachCandidateReportToApplication,
  listJobApplications,
  updateApplicationInterview,
  publicJobPayload,
} from '../vendor/jobs.mjs'
import { listJobCandidates, listOrganizationCandidates } from '../vendor/orgCandidates.mjs'
import {
  JOB_DELETED_MESSAGE,
  markCandidateJobApplicationsDeleted,
  recordCandidateJobApplication,
} from '../vendor/candidateApplications.mjs'
import { computeEmployerInterviewComposite } from '../atsScorer.mjs'
import {
  generateAdaptiveQuestion,
  generateAdaptiveQuestionLocal,
  analyzeInterviewSkillMatch,
  resolveInterviewQuestionMode,
  INTERVIEW_TURN_COUNT,
  generateInterviewTurn,
  getInterviewInteractiveFlowJson,
  processInterviewInteractive,
  llmConfigured,
  parseResumeWithAI,
  summarizeProfile,
  scoreInterviewSession,
  callLlmApi,
} from '../interviewAgent.mjs'
import { buildJdCoveragePlan, generateVendorJobQuestion } from '../prompts/vendorJobInterview.mjs'
import { extractPrimarySkillsFromJd } from '../vendor/atsScore.mjs'

function isOpenVendorJob(job) {
  const status = String(job?.status || 'published').toLowerCase()
  return status === 'active' || status === 'published'
}

/** @param {import('../db/store.mjs').DbShape} db */
async function resolveVendorJobForInterview(db, body, email, databaseUrl) {
  if (body.applicationId) {
    const application = (db.employerApplications || []).find(
      (a) => a.id === String(body.applicationId),
    )
    if (!application) {
      return { error: { status: 404, message: 'Application not found.' } }
    }
    if (
      String(application.candidateEmail || '').toLowerCase() !==
      String(email || '').toLowerCase()
    ) {
      return { error: { status: 403, message: 'This application does not belong to your account.' } }
    }
    let job = getOrgJob(db, application.organizationId, application.jobId)
    if (!job && databaseUrl) {
      await syncOpenJobsFromDatabase(databaseUrl, db)
      job = getOrgJob(db, application.organizationId, application.jobId)
    }
    if (!job) {
      return { error: { status: 404, message: 'Job not found for this application.' } }
    }
    return { job, application }
  }
  if (body.jobId) {
    let job = (db.jobs || []).find((j) => j.id === String(body.jobId))
    if (!job && databaseUrl) {
      await syncOpenJobsFromDatabase(databaseUrl, db)
      job = (db.jobs || []).find((j) => j.id === String(body.jobId))
    }
    if (!job || !isOpenVendorJob(job)) {
      return { error: { status: 404, message: 'Job not found or not open.' } }
    }
    return { job, application: null }
  }
  return { job: null, application: null }
}
/** @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx */
export function createApiDispatchMiddleware(ctx) {
  const {
    config,
    isProdLike,
    PORT,
    json,
    readBody,
    rateLimit,
    clientIp,
    requireAuth,
    registerSession,
    loadDb,
    saveDb,
    setDbCache,
    tenantContextForUser,
    requireEmployerTenant,
    mergeInterviewProfile,
    mergeTurnIntoInterviewHistory,
    buildEmployerInviteContext,
    buildJobSeekerInviteContext,
    runPaddleOcrParser,
    serveSpaStatic,
    authHelpers,
  } = ctx
  const {
    hashPassword,
    verifyPassword,
    registerAccount,
    UniqueAccountError,
    validateEmployerSignup,
    loginRoleMismatchMessage,
    normalizePhone,
    isValidPhoneInput,
    findUserByPhone,
    deleteSessionToken,
  } = authHelpers

  return async function apiDispatch(req, res) {
  const url = new URL(req.originalUrl || req.url || '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const ip = clientIp(req)

  try {
    // Every confidential vault operation is authenticated and tenant-scoped.
    let vaultTenantId = null
    if (path.startsWith('/api/confidential/')) {
      const email = await requireAuth(req, res)
      if (!email) return
      const user = loadDb().users.find(u => u.email === email && u.status !== 'disabled')
      const tenant = tenantContextForUser(loadDb(), user)
      if (user?.role !== 'employer' || tenant.organization?.status !== 'active' ||
          !['owner', 'admin', 'recruiter'].includes(tenant.membership?.role)) {
        return json(res, 403, { error: 'Recruiter organization access required' })
      }
      vaultTenantId = tenant.organization.id
    }
    /** Jobs actually posted by employer accounts. No static catalog. */
    if (req.method === 'GET' && path === '/api/jobs') {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      if (config.databaseUrl) {
        await syncOpenJobsFromDatabase(config.databaseUrl, db)
      }
      const summary = url.searchParams.get('summary') === '1'
      const limitRaw = url.searchParams.get('limit')
      const offsetRaw = url.searchParams.get('offset')
      const mapJob = summary
        ? (job) => publicJobListPayload(job)
        : (job) => publicJobPayload(job)
      if (limitRaw != null && limitRaw !== '') {
        const { jobs, total, limit, offset } = listOpenJobsPage(
          db,
          limitRaw,
          offsetRaw ?? 0,
        )
        return json(res, 200, { jobs: jobs.map(mapJob), total, limit, offset })
      }
      const jobs = listOpenJobs(db).map(mapJob)
      return json(res, 200, { jobs, total: jobs.length })
    }

    /** Public: resolve shareable job link (no auth) — /api/jobs/public/:code or /api/jobs/public/:companySlug/:code */
    if (req.method === 'GET' && path.startsWith('/api/jobs/public/')) {
      const { code, companySlug, isApply } = parsePublicJobPath(path)
      if (isApply || !code) {
        return json(res, 404, { error: 'Job link not found or expired.' })
      }
      const db = loadDb()
      const job = await resolvePublicJob(db, config.databaseUrl, code, companySlug)
      if (!job) return json(res, 404, { error: 'Job link not found or expired.' })
      return json(res, 200, { job: publicJobPayload(job) })
    }

    /** Public apply: ATS score + application row (candidate must be signed in) */
    if (req.method === 'POST' && path.startsWith('/api/jobs/public/') && path.endsWith('/apply')) {
      const { code, companySlug } = parsePublicJobPath(path)
      const body = await readBody(req)
      const db = loadDb()
      if (config.databaseUrl) {
        await syncOpenJobsFromDatabase(config.databaseUrl, db)
      }
      const job = await resolvePublicJob(db, config.databaseUrl, code, companySlug)
      if (!job) return json(res, 404, { error: 'Job link not found or expired.' })
      const sessionEmail = await requireAuth(req, res)
      if (!sessionEmail) return
      const bodyEmail = String(body.candidateEmail || '').trim().toLowerCase()
      if (bodyEmail && bodyEmail !== sessionEmail) {
        return json(res, 403, {
          error: 'Application email must match your signed-in candidate account.',
        })
      }
      const u = db.users.find((x) => x.email === sessionEmail)
      if (u?.role === 'employer') {
        return json(res, 403, {
          error:
            'Employer (vendor) accounts cannot apply to jobs as candidates. Sign out and use a candidate account with its own email and phone.',
        })
      }
      const candidateUserId = u?.id || null
      const resumeText = String(body.resumeText || '')
      if (resumeText.trim().length < 30 || resumeText.length > 100000) {
        return json(res, 400, { error: 'Upload a readable resume before applying (30–100,000 characters).' })
      }
      const atsEvaluation = await evaluateResumeAgainstJd({
        resumeText,
        jobDescription: job.jobDescription || '',
        requiredSkills: job.requiredSkills || [],
        roleTitle: job.roleTrack,
      })
      const profile = db.profiles[sessionEmail] || {}
      const { application, created, ats } = createJobApplication(db, job, {
        candidateName: body.candidateName || profile.fullName || profile.name || u?.name,
        candidatePhone: body.candidatePhone || profile.contactPhone || u?.phone,
        candidateRole: body.candidateRole || profile.currentRole || '',
        experienceYears: body.experienceYears || profile.totalExperience || '',
        resumeName: body.resumeName || profile.resumeName || 'HireRight profile',
        resumeText,
        candidateEmail: sessionEmail,
        candidateUserId,
        atsEvaluation,
      })
      attachCandidateReportToApplication(db, application, sessionEmail, {
        candidateRole: body.candidateRole || profile.currentRole || '',
        attachInterviewReport: body.attachInterviewReport !== false,
      })
      const candidateApplication = recordCandidateJobApplication(db, sessionEmail, job, application, {
        match: typeof body.match === 'number' ? body.match : Number(body.match) || null,
      })
      if (config.databaseUrl) {
        await upsertEmployerApplicationRecord(config.databaseUrl, application)
        await upsertJobApplicationRecord(config.databaseUrl, sessionEmail, candidateApplication)
      }
      await saveDb(db)
      if (candidateUserId && config.databaseUrl) {
        void grantOrganizationTalentAccess(
          config.databaseUrl,
          job.organizationId,
          candidateUserId,
          'application',
        ).catch((err) => console.warn('[talent] grant access:', err.message))
      }
      return json(res, created ? 201 : 200, {
        applicationId: application.id,
        candidateApplication,
        job: publicJobPayload(job),
        ats: ats || {
          atsScore: application.data.atsScore,
          jdMatchScore: application.data.jdMatchScore,
          primarySkills: application.data.primarySkills,
          matchedSkills: application.data.matchedSkills,
          missingSkills: application.data.missingSkills,
          strengths: application.data.atsStrengths,
          gaps: application.data.atsGaps,
          summary: application.data.atsSummary,
          aiEnhanced: application.data.aiEnhancedAts,
        },
        organizationId: job.organizationId,
      })
    }

    if (req.method === 'POST' && path === '/api/vendor/jobs') {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const body = await readBody(req)
      const job = createVendorJob(db, ctx.tenant.organization.id, ctx.user.id, body)
      await upsertJobRecord(config.databaseUrl, job)
      await saveDb(db)
      if (config.databaseUrl) {
        await syncOpenJobsFromDatabase(config.databaseUrl, db)
      }
      return json(res, 201, { job: publicJobPayload(job) })
    }

    if (req.method === 'GET' && path === '/api/vendor/jobs') {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const orgId = ctx.tenant.organization.id
      if (config.databaseUrl) {
        await syncOrgJobsFromDatabase(config.databaseUrl, db, orgId)
      }
      const jobs = listOrgJobs(db, orgId, {
        createdByUserId: ctx.user.id,
        createdByEmail: ctx.user.email,
      }).map((job) => publicJobPayload(job))
      return json(res, 200, { jobs, total: jobs.length, organizationId: orgId })
    }

    if (
      req.method === 'POST' &&
      /^\/api\/vendor\/jobs\/[^/]+\/mark-deleted-for-candidates$/.test(path)
    ) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const jobId = path.split('/')[4]
      const orgId = ctx.tenant.organization.id
      const job = getOrgJob(db, orgId, jobId)
      if (!job) {
        return json(res, 404, { error: 'Job not found.' })
      }
      const marked = markCandidateJobApplicationsDeleted(db, jobId, {
        title: job.title,
        company: job.company,
      })
      if (config.databaseUrl) {
        await markJobApplicationsDeletedInPostgres(config.databaseUrl, jobId, {
          jobDeletedMessage: JOB_DELETED_MESSAGE,
        })
        for (const row of marked.records) {
          await upsertJobApplicationRecord(config.databaseUrl, row.email, row.record)
        }
      }
      await saveDb(db)
      return json(res, 200, {
        ok: true,
        jobId,
        candidateApplicationsUpdated: marked.updated,
      })
    }

    if (
      req.method === 'DELETE' &&
      /^\/api\/vendor\/jobs\/[^/]+$/.test(path)
    ) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const jobId = path.split('/')[4]
      const orgId = ctx.tenant.organization.id
      try {
        const job = getOrgJob(db, orgId, jobId)
        const marked = job
          ? markCandidateJobApplicationsDeleted(db, jobId, {
              title: job.title,
              company: job.company,
            })
          : { updated: 0, records: [] }
        const removed = deleteVendorJob(db, orgId, jobId)
        if (config.databaseUrl) {
          if (marked.updated > 0) {
            await markJobApplicationsDeletedInPostgres(config.databaseUrl, jobId, {
              jobDeletedMessage: JOB_DELETED_MESSAGE,
            })
            for (const row of marked.records) {
              await upsertJobApplicationRecord(config.databaseUrl, row.email, row.record)
            }
          }
          await deleteJobRecord(config.databaseUrl, jobId, orgId)
        }
        await saveDb(db)
        return json(res, 200, {
          ok: true,
          ...removed,
          candidateApplicationsUpdated: marked.updated,
        })
      } catch (err) {
        const status = err.status || 500
        return json(res, status, { error: err.message || 'Could not delete job.' })
      }
    }

    if (req.method === 'GET' && path.startsWith('/api/vendor/jobs/') && path.endsWith('/applicants')) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      if (config.databaseUrl) {
        await syncEmployerApplicationsFromDatabase(config.databaseUrl, db)
      }
      const jobId = path.split('/')[4]
      const job = getOrgJob(db, ctx.tenant.organization.id, jobId)
      if (!job) return json(res, 404, { error: 'Job not found.' })
      const applicants = listJobApplications(db, ctx.tenant.organization.id, jobId).map((app) =>
        attachCandidateReportToApplication(db, app, app.candidateEmail, {
          attachInterviewReport: true,
        }),
      )
      return json(res, 200, { job, applicants, total: applicants.length })
    }

    if (req.method === 'GET' && path === '/api/vendor/candidates') {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      if (config.databaseUrl) {
        await syncEmployerApplicationsFromDatabase(config.databaseUrl, db)
      }
      const orgId = ctx.tenant.organization.id
      const filters = {
        name: url.searchParams.get('name') || '',
        job: url.searchParams.get('job') || '',
        experienceYears:
          url.searchParams.get('experienceYears') || url.searchParams.get('experience') || '',
        keywords: url.searchParams.get('keywords') || url.searchParams.get('q') || '',
        jobId: url.searchParams.get('jobId') || '',
      }
      const roster = await listOrganizationCandidates(db, orgId, config.databaseUrl, filters)
      return json(res, 200, {
        organizationId: orgId,
        ...roster,
      })
    }

    if (
      req.method === 'GET' &&
      /^\/api\/vendor\/jobs\/[^/]+\/candidates$/.test(path)
    ) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      if (config.databaseUrl) {
        await syncEmployerApplicationsFromDatabase(config.databaseUrl, db)
      }
      const jobId = path.split('/')[4]
      const job = getOrgJob(db, ctx.tenant.organization.id, jobId)
      if (!job) return json(res, 404, { error: 'Job not found.' })
      const filters = {
        name: url.searchParams.get('name') || '',
        job: url.searchParams.get('job') || '',
        experienceYears:
          url.searchParams.get('experienceYears') || url.searchParams.get('experience') || '',
        keywords: url.searchParams.get('keywords') || url.searchParams.get('q') || '',
      }
      const roster = listJobCandidates(db, ctx.tenant.organization.id, jobId, filters)
      return json(res, 200, { job, organizationId: ctx.tenant.organization.id, ...roster })
    }

    if (req.method === 'GET' && path.startsWith('/api/vendor/applicants/') && path.endsWith('/report')) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.split('/')[4]
      const app = getOrgApplication(db, ctx.tenant.organization.id, appId)
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      const job = getOrgJob(db, ctx.tenant.organization.id, app.jobId)
      const forceRefresh = url.searchParams.get('refresh') === '1'
      if (!vendorReportNeedsRefresh(app.data, forceRefresh) && app.data?.vendorReport) {
        return json(res, 200, { report: app.data.vendorReport, application: app })
      }
      const report = await generateVendorAssessmentSheet({
        candidateName: app.data.candidateName || app.candidateEmail,
        jobTitle: job?.title || app.data.jobTitle,
        company: job?.company || app.data.company,
        jobDescription: job?.jobDescription || '',
        resumeText: app.data.resumeText || '',
        atsEvaluation: {
          atsScore: app.data.atsScore,
          jdMatchScore: app.data.jdMatchScore,
          primarySkills: app.data.primarySkills,
          matchedSkills: app.data.matchedSkills,
          missingSkills: app.data.missingSkills,
          strengths: app.data.atsStrengths,
          gaps: app.data.atsGaps,
          summary: app.data.atsSummary,
        },
        interviewResult: app.data.interviewResult,
      })
      app.data.vendorReport = report
      await saveDb(db)
      return json(res, 200, { report, application: app })
    }

    if (req.method === 'GET' && /^\/api\/vendor\/applicants\/[^/]+\/interview-plan$/.test(path)) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.split('/')[4]
      const app = getOrgApplication(db, ctx.tenant.organization.id, appId)
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      const job = getOrgJob(db, ctx.tenant.organization.id, app.jobId)
      const jobDescription = String(job?.jobDescription || '')
      const requiredSkills = job?.requiredSkills || app.data?.primarySkills || []
      const profile = {
        resumeText: app.data?.resumeText || '',
        workExperiences: app.data?.workExperiences || [],
        skills: app.data?.skills || [],
        experienceYears: app.data?.experienceYears || '',
      }
      const digest = summarizeProfile(profile, app.data?.candidateName || app.candidateEmail)
      const skillAnalysis = analyzeInterviewSkillMatch({
        jobDescription,
        requiredSkills,
        profile,
        ctx: digest,
      })
      const role = job?.roleTrack || job?.title || app.data?.jobTitle || 'Engineer'
      const level = app.data?.experienceYears || job?.experienceLevel || '1–3 years'
      const questions = []
      const history = []
      for (let turn = 0; turn < INTERVIEW_TURN_COUNT; turn++) {
        const question = generateAdaptiveQuestionLocal({
          ctx: digest,
          role,
          level,
          jobDescription,
          history,
          lastAnswer: '',
        })
        questions.push(question)
        history.push({ question, answer: '' })
      }
      return json(res, 200, {
        questionMode: 'adaptive',
        role,
        level,
        skillAnalysis,
        questions: questions.map((q) => ({
          text: q.text,
          category: q.category,
          topic: q.topic,
        })),
      })
    }

    if (req.method === 'POST' && /^\/api\/vendor\/applicants\/[^/]+\/interview-invite$/.test(path)) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.split('/')[4]
      const body = await readBody(req)
      const app = getOrgApplication(db, ctx.tenant.organization.id, appId)
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      const job = getOrgJob(db, ctx.tenant.organization.id, app.jobId)
      const scheduledStartRaw = body.scheduledStart || body.scheduledAt
      const start = new Date(scheduledStartRaw)
      if (Number.isNaN(start.getTime())) {
        return json(res, 400, { error: 'scheduledStart (ISO datetime) is required.' })
      }
      const durationMin = Math.min(180, Math.max(15, Number(body.durationMinutes || 60)))
      const end = inviteJoinWindowEnd(start)
      const token = newInviteToken()
      const contextJson = {
        ...buildEmployerInviteContext(db, app, job),
        interviewDurationMinutes: durationMin,
        joinWindowMinutes: INVITE_JOIN_WINDOW_MINUTES,
      }
      const pool = dbPool(config.databaseUrl)
      await insertInterviewInvite(pool, {
        token,
        organizationId: ctx.tenant.organization.id,
        applicationId: app.id,
        jobId: app.jobId,
        candidateEmail: app.candidateEmail,
        candidateName: app.data?.candidateName || '',
        jobTitle: job?.title || app.data?.jobTitle || '',
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        createdByUserId: ctx.user.id,
        contextJson,
      })
      const inviteUrl = invitePublicUrl(token)
      let emailSent = false
      let emailError = null
      if (smtpConfigured()) {
        try {
          await sendInterviewInviteEmail({
            to: app.candidateEmail,
            candidateName: app.data?.candidateName,
            jobTitle: job?.title,
            scheduledStart: start.toISOString(),
            inviteUrl,
          })
          await pool.query(
            'UPDATE interview_invites SET email_sent_at = NOW() WHERE token = $1',
            [token],
          )
          emailSent = true
        } catch (err) {
          emailError = err instanceof Error ? err.message : 'Email failed'
        }
      }
      app.data = app.data || {}
      app.data.lastInterviewInvite = {
        token,
        inviteUrl,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        emailSent,
      }
      await saveDb(db)
      return json(res, 201, {
        invite: {
          token,
          inviteUrl,
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          emailSent,
          emailError,
          smtpConfigured: smtpConfigured(),
        },
      })
    }

    if (req.method === 'PATCH' && path.startsWith('/api/vendor/applicants/')) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.replace('/api/vendor/applicants/', '').split('/')[0]
      const body = await readBody(req)
      const app = (db.employerApplications || []).find(
        (a) => a.id === appId && a.organizationId === ctx.tenant.organization.id,
      )
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      if (body.status) app.status = String(body.status)
      await saveDb(db)
      return json(res, 200, { application: app })
    }

    if (req.method === 'GET' && path.startsWith('/api/interview-invites/')) {
      const token = path.replace('/api/interview-invites/', '').trim()
      if (!token) return json(res, 400, { error: 'Invite token required.' })
      const pool = dbPool(config.databaseUrl)
      const row = await getInterviewInviteByToken(pool, token)
      if (!row) return json(res, 404, { error: 'Invite not found.' })
      const access = inviteAccessState(row)
      const db = loadDb()
      const orgId = row.organization_id
      const job = orgId && row.job_id ? getOrgJob(db, orgId, row.job_id) : null
      const app =
        orgId && row.application_id ? getOrgApplication(db, orgId, row.application_id) : null
      const ctx = parseInviteContext(row)
      const resumeText =
        ctx.resumeText || app?.data?.resumeText || db.profiles?.[row.candidate_email]?.resumeText || ''
      const jobDescription =
        ctx.jobDescription || job?.jobDescription || app?.data?.jobDescription || ''
      return json(res, 200, {
        invite: {
          token: row.token,
          candidateEmail: row.candidate_email,
          candidateName: row.candidate_name,
          jobTitle: row.job_title || job?.title || ctx.jobTitle,
          scheduledStart: row.scheduled_start,
          scheduledEnd: row.scheduled_end,
          applicationId: row.application_id || null,
          jobId: row.job_id || null,
          organizationId: orgId || null,
          jobDescription,
          resumeText,
          resumeName: ctx.resumeName || app?.data?.resumeName || null,
          roleTrack: ctx.roleTrack || job?.roleTrack || '',
          experienceLevel: ctx.experienceLevel || job?.experienceLevel || '',
          company: job?.company || '',
          primarySkills: ctx.primarySkills || app?.data?.primarySkills || job?.requiredSkills || [],
          atsScore: app?.data?.atsScore ?? null,
          jdMatchScore: app?.data?.jdMatchScore ?? null,
          contextSource: ctx.source || null,
          ...access,
          interviewPath: `/interview/invite/${row.token}`,
        },
      })
    }

    if (req.method === 'POST' && path === '/api/interview/confirmation-email') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const scheduledStart = body.scheduledStart || body.scheduledAt
      const start = scheduledStart ? new Date(scheduledStart) : null
      if (!start || Number.isNaN(start.getTime())) {
        return json(res, 400, { error: 'scheduledStart is required.' })
      }
      if (!smtpConfigured()) {
        return json(res, 503, { error: 'SMTP not configured on server.', smtpConfigured: false })
      }
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      const durationMin = Math.min(180, Math.max(15, Number(body.durationMinutes || 60)))
      const end = inviteJoinWindowEnd(start)
      const token = newInviteToken()
      const orgId =
        user?.primaryOrganizationId ||
        db.organizationMembers?.find((m) => m.userId === user?.id)?.organizationId ||
        null
      const contextJson = {
        ...buildJobSeekerInviteContext(db, email, body),
        interviewDurationMinutes: durationMin,
        joinWindowMinutes: INVITE_JOIN_WINDOW_MINUTES,
      }
      const pool = dbPool(config.databaseUrl)
      await insertInterviewInvite(pool, {
        token,
        organizationId: orgId,
        candidateEmail: email,
        candidateName: user?.name || '',
        jobTitle: body.jobTitle || contextJson.jobTitle || 'AI Interview',
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        createdByUserId: user?.id,
        contextJson,
      })
      const inviteUrl = invitePublicUrl(token)
      const { subject, html, text } = buildInterviewInviteEmail({
        candidateName: user?.name,
        jobTitle: body.jobTitle || contextJson.jobTitle,
        scheduledStart: start.toISOString(),
        inviteUrl,
      })
      let emailSent = false
      let emailError = null
      try {
        await sendMail({ to: email, subject, html, text })
        await pool.query('UPDATE interview_invites SET email_sent_at = NOW() WHERE token = $1', [token])
        emailSent = true
      } catch (err) {
        emailError = err instanceof Error ? err.message : 'Email failed'
        console.warn('[mail] confirmation-email send failed:', emailError)
      }
      return json(res, 200, {
        ok: true,
        inviteUrl,
        emailSent,
        emailError,
        token,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        smtpConfigured: true,
      })
    }

    /** Employer / vendor: search job seekers (Neon FTS + filters) */
    if (req.method === 'GET' && path === '/api/talent/search') {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      if (!user || user.role !== 'employer') {
        return json(res, 403, { error: 'Employer account required for talent search.' })
      }
      const tenant = tenantContextForUser(db, user)
      if (!tenant.organization?.id) {
        return json(res, 403, { error: 'No organization linked to this employer account.' })
      }
      const skillsParam = String(url.searchParams.get('skills') || '')
      const skills = skillsParam
        ? skillsParam.split(',').map((s) => s.trim()).filter(Boolean)
        : []
      const minScoreRaw = url.searchParams.get('minScore')
      const minScore = minScoreRaw ? Number(minScoreRaw) : undefined
      try {
        const result = await searchCandidateTalent(config.databaseUrl, tenant.organization.id, {
          q: url.searchParams.get('q') || '',
          location: url.searchParams.get('location') || '',
          experienceYears: url.searchParams.get('experienceYears') || url.searchParams.get('experience') || '',
          skills,
          minScore: Number.isFinite(minScore) ? minScore : undefined,
          limit: Number(url.searchParams.get('limit') || 25),
          offset: Number(url.searchParams.get('offset') || 0),
        })
        return json(res, 200, result)
      } catch (err) {
        return json(res, 500, {
          error: err instanceof Error ? err.message : 'Talent search failed.',
        })
      }
    }

    if (req.method === 'GET' && path.startsWith('/api/talent/candidates/')) {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      if (!user || user.role !== 'employer') {
        return json(res, 403, { error: 'Employer account required.' })
      }
      const tenant = tenantContextForUser(db, user)
      if (!tenant.organization?.id) {
        return json(res, 403, { error: 'No organization linked to this employer account.' })
      }
      const userId = path.replace('/api/talent/candidates/', '').split('/')[0]
      try {
        const candidate = await getCandidateTalentById(
          config.databaseUrl,
          tenant.organization.id,
          userId,
        )
        if (!candidate) return json(res, 404, { error: 'Candidate not found or not visible.' })
        const interview = db.interviews[candidate.email] || null
        return json(res, 200, { candidate, interview })
      } catch (err) {
        return json(res, 500, {
          error: err instanceof Error ? err.message : 'Could not load candidate.',
        })
      }
    }

    /** Start Ava interview: resume-aware dynamic questions (Bearer token required) */
    if (req.method === 'POST' && path === '/api/interview/start') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivstart:${email}`, 12)) {
        return json(res, 429, { error: 'Interview start rate limited. Wait a minute.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const profile = mergeInterviewProfile(db, email, body.profile)
      const account = db.users.find((u) => u.email === email)

      const ctx = summarizeProfile(profile, account?.name)
      const vendorResolved = await resolveVendorJobForInterview(
        db,
        body,
        email,
        config.databaseUrl,
      )
      if (vendorResolved.error) {
        return json(res, vendorResolved.error.status, { error: vendorResolved.error.message })
      }

      const vendorJob = vendorResolved.job
      const vendorApplication = vendorResolved.application
      let role = String(body.role || 'Full Stack Engineer')
      let level = String(body.level || '1–3 years')
      const jobDescription = String(body.jobDescription || '')
      const explicitRoleTrack = body.explicitRoleTrack === true
      const questionModeHint = String(body.questionMode || '').trim()
      let jobRecord = body.jobId
        ? (db.jobs || []).find((j) => j.id === String(body.jobId))
        : null
      let requiredSkills =
        Array.isArray(body.primarySkills) && body.primarySkills.length
          ? body.primarySkills.map(String)
          : jobRecord?.requiredSkills || []
      let effectiveJd = jobDescription || jobRecord?.jobDescription || ''
      let questionMode
      let jdPlan = null
      let roleTrack = jobRecord?.roleTrack || role

      if (vendorJob) {
        role = String(vendorJob.title || role)
        level = String(vendorJob.experienceLevel || level)
        effectiveJd = String(vendorJob.jobDescription || '')
        roleTrack = String(vendorJob.roleTrack || role)
        jobRecord = vendorJob
        requiredSkills = vendorJob.requiredSkills?.length
          ? vendorJob.requiredSkills.map(String)
          : extractPrimarySkillsFromJd(effectiveJd, [])
        questionMode = 'vendor_jd'
        jdPlan = buildJdCoveragePlan({
          jobDescription: effectiveJd,
          requiredSkills,
          resumeText: ctx.resumeSnippet || profile?.resumeText || '',
        })
      } else {
        const effectiveJdEarly = effectiveJd
        questionMode = resolveInterviewQuestionMode({
          mode:
            questionModeHint ||
            (explicitRoleTrack && effectiveJdEarly.trim().length >= 40 ? 'individual_jd' : undefined),
          applicationId: body.applicationId,
          jobId: body.jobId,
          jobDescription: effectiveJdEarly,
          requiredSkills,
        })
      }

      let skillAnalysis = null
      if (
        questionMode === 'employer' ||
        questionMode === 'individual_jd' ||
        questionMode === 'vendor_jd'
      ) {
        skillAnalysis = analyzeInterviewSkillMatch({
          jobDescription: effectiveJd,
          requiredSkills,
          profile,
          ctx,
        })
      }

      const first =
        questionMode === 'vendor_jd'
          ? await generateVendorJobQuestion(
              {
                ctx,
                profile,
                role,
                jobTitle: role,
                roleTrack,
                level,
                jobDescription: effectiveJd,
                plan: jdPlan,
                requiredSkills,
                history: [],
                lastAnswer: '',
                candidateName: account?.name,
              },
              { callLlm: callLlmApi },
            )
          : await generateAdaptiveQuestion({
              ctx,
              profile,
              role,
              level,
              jobDescription: effectiveJd,
              explicitRoleTrack,
              history: [],
              lastAnswer: '',
              accountName: account?.name,
            })
      const questions = [first]
      const agentLabel =
        first.focus === 'vendor-jd-llm'
          ? 'vendor-jd-llm'
          : first.focus === 'vendor-jd-local'
            ? 'vendor-jd-local'
            : first.focus === 'adaptive-llm'
              ? 'llm-adaptive'
              : 'adaptive-local'
      const adaptive = true

      const sessionId = randomBytes(12).toString('hex')
      const session = {
        id: sessionId,
        email,
        role,
        level,
        mode: adaptive ? 'adaptive' : 'fixed',
        questions,
        history: [],
        answers: [],
        agent: agentLabel,
        context: ctx,
        jobDescription: effectiveJd,
        explicitRoleTrack,
        jobId: vendorJob ? String(vendorJob.id) : body.jobId ? String(body.jobId) : null,
        applicationId: vendorApplication
          ? String(vendorApplication.id)
          : body.applicationId
            ? String(body.applicationId)
            : null,
        organizationId: (() => {
          if (vendorApplication?.organizationId) return String(vendorApplication.organizationId)
          const fromBody = body.organizationId ? String(body.organizationId) : ''
          if (fromBody) return fromBody
          if (!body.applicationId) return null
          const linked = (db.employerApplications || []).find(
            (a) => a.id === String(body.applicationId),
          )
          return linked?.organizationId ? String(linked.organizationId) : null
        })(),
        roleTrack,
        jdPlan,
        primarySkills: skillAnalysis?.jdSkills || requiredSkills,
        questionMode,
        skillAnalysis,
        atsScore:
          typeof body.atsScore === 'number'
            ? body.atsScore
            : skillAnalysis?.atsScore ?? null,
        jdMatchScore:
          typeof body.jdMatchScore === 'number'
            ? body.jdMatchScore
            : skillAnalysis?.jdMatchScore ?? null,
        integrity: {
          faceViolations: 0,
          singlePersonOk: true,
          maxFacesSeen: 1,
        },
        startedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        status: 'active',
      }
      db.interviewSessions[sessionId] = session
      await saveDb(db)

      return json(res, 200, {
        sessionId,
        agent: agentLabel,
        adaptive,
        llm: llmConfigured(),
        total: adaptive ? INTERVIEW_TURN_COUNT : questions.length,
        questionIndex: 0,
        question: questions[0],
        questions,
        profileDigest: ctx,
        questionMode,
        skillAnalysis: skillAnalysis
          ? {
              jdSkills: skillAnalysis.jdSkills,
              matchedSkills: skillAnalysis.matchedSkills,
              missingSkills: skillAnalysis.missingSkills,
              atsScore: skillAnalysis.atsScore,
              jdMatchScore: skillAnalysis.jdMatchScore,
            }
          : null,
        job: vendorJob
          ? { id: vendorJob.id, title: vendorJob.title, roleTrack: vendorJob.roleTrack }
          : null,
      })
    }

    /** Next adaptive question (dynamic — no fixed bank) */
    if (req.method === 'POST' && path === '/api/interview/next') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivnext:${email}`, 30)) {
        return json(res, 429, { error: 'Next-question rate limited.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const sessionId = String(body.sessionId || '')
      const session = sessionId ? /** @type {any} */ (db.interviewSessions[sessionId]) : null
      if (!session || session.email !== email) {
        return json(res, 404, { error: 'Interview session not found.' })
      }
      const profile = mergeInterviewProfile(db, email, body.profile)
      const account = db.users.find((u) => u.email === email)
      const ctx = summarizeProfile(profile, account?.name)
      const history = mergeTurnIntoInterviewHistory(
        Array.isArray(body.history) ? body.history : session.history || [],
        body.lastQuestion,
        body.lastAnswer,
      )
      session.history = history
      const lastAnswer = String(body.lastAnswer || '')
      const next =
        session.questionMode === 'vendor_jd'
          ? await generateVendorJobQuestion(
              {
                ctx,
                profile,
                role: session.role,
                jobTitle: session.role,
                roleTrack: session.roleTrack || session.role,
                level: session.level,
                jobDescription: session.jobDescription,
                plan: session.jdPlan,
                requiredSkills: session.primarySkills,
                history,
                lastAnswer,
                candidateName: account?.name,
              },
              { callLlm: callLlmApi },
            )
          : await generateAdaptiveQuestion({
              ctx,
              profile,
              role: String(body.role || session.role),
              level: String(body.level || session.level),
              jobDescription: String(body.jobDescription || session.jobDescription || ''),
              explicitRoleTrack:
                body.explicitRoleTrack === true || session.explicitRoleTrack === true,
              history,
              lastAnswer,
              accountName: account?.name,
            })
      session.questions = [...(session.questions || []), next]
      db.interviewSessions[sessionId] = session
      await saveDb(db)
      return json(res, 200, { question: next, turn: history.length + 1 })
    }

    /** Interactive turn: Ava acknowledges answer before next question */
    if (req.method === 'POST' && path === '/api/interview/transcribe') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!groqWhisperConfigured()) {
        return json(res, 503, { error: 'Groq Whisper STT is not configured on the server.' })
      }
      if (!rateLimit(`ivstt:${email}`, 45)) {
        return json(res, 429, { error: 'Transcription rate limited. Slow down and try again.' })
      }
      const body = await readBody(req)
      const audioBase64 = String(body.audioBase64 || body.audio || '').trim()
      if (!audioBase64) {
        return json(res, 400, { error: 'audioBase64 is required.' })
      }
      let audioBuffer
      try {
        audioBuffer = Buffer.from(audioBase64, 'base64')
      } catch {
        return json(res, 400, { error: 'Invalid audioBase64.' })
      }
      const maxBytes = Math.min(config.maxBodyBytes, 2_500_000)
      if (!audioBuffer.length || audioBuffer.length > maxBytes) {
        return json(res, 400, { error: 'Audio clip is empty or too large.' })
      }
      try {
        const result = await transcribeWithGroqWhisper(audioBuffer, {
          filename: String(body.filename || 'speech.wav'),
          mimeType: String(body.mimeType || 'audio/wav'),
        })
        return json(res, 200, { text: result.text, model: result.model, language: result.language })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transcription failed.'
        console.warn('[groq-whisper]', message)
        return json(res, 502, { error: message })
      }
    }

    if (req.method === 'POST' && path === '/api/interview/turn') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivturn:${email}`, 40)) {
        return json(res, 429, { error: 'Turn rate limited.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const profile = mergeInterviewProfile(db, email, body.profile)
      const ctx = summarizeProfile(profile, db.users.find((u) => u.email === email)?.name)
      const turn = await generateInterviewTurn({
        ctx,
        profile,
        role: String(body.role || 'Full Stack Engineer'),
        level: String(body.level || '1–3 years'),
        question: body.question || {},
        answer: String(body.answer || ''),
        questionIndex: Number(body.questionIndex ?? 0),
        totalQuestions: Number(body.totalQuestions ?? 0),
        nextQuestion: body.nextQuestion || {},
      })
      return json(res, 200, turn)
    }

    /** Interactive prelude + command actions (JSON flow: welcome → confirm → questions) */
    if (req.method === 'GET' && path === '/api/interview/flow') {
      return json(res, 200, { flow: getInterviewInteractiveFlowJson() })
    }

    if (req.method === 'POST' && path === '/api/interview/interact') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivinteract:${email}`, 60)) {
        return json(res, 429, { error: 'Interactive turn rate limited.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const profile = mergeInterviewProfile(db, email, body.profile)
      const account = db.users.find((u) => u.email === email)
      const ctx = summarizeProfile(profile, account?.name)
      const result = processInterviewInteractive({
        phase: String(body.phase || 'day_check'),
        userText: String(body.userText || ''),
        role: String(body.role || 'Full Stack Engineer'),
        profile,
        accountName: account?.name,
        ctx,
      })
      return json(res, 200, result)
    }

    if (req.method === 'POST' && path === '/api/resume/upload') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!objectStorageConfigured()) {
        return json(res, 503, {
          error: 'Resume object storage is not configured (S3 or Supabase).',
          skipped: true,
        })
      }
      const body = await readBody(req)
      let parsed
      try {
        parsed = parseResumeUploadBody(body)
      } catch (err) {
        return json(res, err.status || 400, { error: err.message })
      }
      try {
        const db = loadDb()
        const account = db.users.find((u) => u.email === email)
        const pool = dbPool(config.databaseUrl)
        const uploaded = await uploadResumeToObjectStorage({
          pool,
          candidateEmail: email,
          ownerUserId: account?.id,
          filename: parsed.filename,
          buffer: parsed.buffer,
          contentType: parsed.contentType,
        })
        const profilePatch = {
          resumeStoragePath: uploaded.storagePath,
          resumeUrl: uploaded.resumeUrl,
          resumeFileId: uploaded.fileId,
          storageProvider: uploaded.storageProvider,
        }
        const prev = /** @type {Record<string, unknown>} */ (db.profiles[email] || {})
        db.profiles[email] = {
          ...prev,
          ...profilePatch,
          updatedAt: new Date().toISOString(),
        }
        await saveDb(db)
        await pool.query(
          `INSERT INTO profiles (email, data, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (email) DO UPDATE SET data = profiles.data || EXCLUDED.data, updated_at = NOW()`,
          [email, JSON.stringify(profilePatch)],
        )
        console.log(
          `[resume-upload] ${uploaded.storageProvider} email=${email} key=${uploaded.storagePath} bytes=${parsed.buffer.length}`,
        )
        return json(res, 200, {
          ok: true,
          storagePath: uploaded.storagePath,
          resumeUrl: uploaded.resumeUrl,
          bucket: uploaded.bucket,
          fileId: uploaded.fileId,
          storageProvider: uploaded.storageProvider,
        })
      } catch (err) {
        const status = err.status || 502
        console.warn(
          '[resume-upload] failed',
          email,
          err instanceof Error ? err.message : err,
        )
        if (err.skipped) {
          return json(res, status, { error: err.message, skipped: true })
        }
        return json(res, status, { error: err instanceof Error ? err.message : 'Upload failed' })
      }
    }

    if (req.method === 'GET' && path === '/api/resume/download') {
      const email = await requireAuth(req, res)
      if (!email) return
      try {
        const db = loadDb()
        const profile = /** @type {Record<string, unknown>} */ (db.profiles[email] || {})
        const pool = dbPool(config.databaseUrl)
        const signed = await resolveResumeDownloadForUser({
          requesterEmail: email,
          profile,
          pool,
        })
        const accept = String(req.headers.accept || '')
        if (accept.includes('application/json') || req.url?.includes('format=json')) {
          return json(res, 200, {
            downloadUrl: signed.url,
            expiresInSeconds: signed.expiresInSeconds,
            legacyPublic: Boolean(signed.legacyPublic),
          })
        }
        res.writeHead(302, { Location: signed.url })
        res.end()
        return
      } catch (err) {
        return json(res, err.status || 500, {
          error: err instanceof Error ? err.message : 'Could not generate download link.',
        })
      }
    }

    /** PaddleOCR Resume Parsing */
    if (req.method === 'POST' && path === '/api/resume/parse') {
      if (isProdLike) {
        const email = await requireAuth(req, res)
        if (!email) return
        if (!rateLimit(`resume:${email}`, 25, 60_000)) {
          return json(res, 429, { error: 'Too many resume parse requests. Try again shortly.' })
        }
      } else if (!rateLimit(`resume:${ip}`, 30, 60_000)) {
        return json(res, 429, { error: 'Too many resume parse requests. Try again shortly.' })
      }
      const body = await readBody(req)
      const fileData = body.fileData || body.fileBase64
      const fileName = String(body.fileName || 'resume.pdf')
      const text = String(body.text || body.resumeText || '')

      let paddleExtract = null
      if (fileData) {
        try {
          const base64Content = fileData.includes(',') ? fileData.split(',')[1] : fileData
          const buffer = Buffer.from(base64Content, 'base64')
          paddleExtract = await runPaddleOcrParser(buffer, fileName)
        } catch (e) {
          console.warn('[PaddleOCR] Buffer decode notice:', e.message)
        }
      } else if (text.trim()) {
        try {
          const buffer = Buffer.from(text, 'utf-8')
          paddleExtract = await runPaddleOcrParser(buffer, 'resume.txt')
        } catch (e) {
          console.warn('[PaddleOCR] Text buffer notice:', e.message)
        }
      }

      if (paddleExtract) {
        return json(res, 200, { ok: true, source: 'paddle-ocr', extract: paddleExtract })
      }

      // Secondary fallback if PaddleOCR did not return output
      if (text.trim()) {
        try {
          const parsed = await parseResumeWithAI(text)
          if (parsed) {
            return json(res, 200, { ok: true, source: 'gemini-2.5-flash', extract: parsed })
          }
        } catch (err) {
          console.warn('Backend fallback resume parse error:', err)
        }
      }

      return json(res, 400, { ok: false, error: 'Could not extract fields from resume.' })
    }

    /** Record integrity ping (face count) during interview */
    if (req.method === 'POST' && path === '/api/interview/integrity') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const sessionId = String(body.sessionId || '')
      const db = loadDb()
      const session = /** @type {any} */ (db.interviewSessions[sessionId])
      if (!session || session.email !== email) {
        return json(res, 404, { error: 'Interview session not found.' })
      }
      const faceCount = Number(body.faceCount ?? 1)
      session.integrity = session.integrity || {
        faceViolations: 0,
        singlePersonOk: true,
        maxFacesSeen: 1,
      }
      session.integrity.maxFacesSeen = Math.max(session.integrity.maxFacesSeen || 1, faceCount)
      if (faceCount !== 1) {
        session.integrity.faceViolations = (session.integrity.faceViolations || 0) + 1
        session.integrity.singlePersonOk = false
      }
      db.interviewSessions[sessionId] = session
      await saveDb(db)
      return json(res, 200, { integrity: session.integrity })
    }

    /** Score full interview (client sends answers + optional live integrity) */
    if (req.method === 'POST' && path === '/api/interview/score') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivscore:${email}`, 10)) {
        return json(res, 429, { error: 'Score rate limited.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const sessionId = String(body.sessionId || '')
      const session = sessionId ? /** @type {any} */ (db.interviewSessions[sessionId]) : null
      if (!session || session.email !== email) {
        return json(res, 404, { error: 'Interview session not found.' })
      }

      const profile = mergeInterviewProfile(db, email, body.profile)

      const rawQuestions = body.questions || session?.questions
      const answers = Array.isArray(body.answers) ? body.answers.map(String) : []
      const role = String(body.role || session?.role || 'Full Stack Engineer')
      const level = String(body.level || session?.level || '1–3 years')

      const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map((q) => {
        if (q && typeof q === 'object' && q.text) return q
        if (typeof q === 'string') {
          return { text: q, category: 'Technical', keywords: [], hint: '' }
        }
        return null
      }).filter(Boolean)

      if (!questions.length) {
        return json(res, 400, { error: 'Questions required to score interview.' })
      }

      const pairCount = Math.min(
        questions.length,
        answers.length,
        answers.filter((a) => String(a || '').trim()).length || answers.length,
      )
      const scoredQuestions = questions.slice(0, pairCount)
      const scoredAnswers = answers.slice(0, pairCount)
      if (!pairCount) {
        return json(res, 400, { error: 'At least one answer is required to score the interview.' })
      }

      const integrity = {
        ...(session?.integrity || {}),
        ...(body.integrity || {}),
      }

      const startedAt = session?.startedAt ? new Date(session.startedAt).getTime() : Date.now()
      const durationMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000))

      const result = await scoreInterviewSession({
        role,
        level,
        questions: scoredQuestions,
        answers: scoredAnswers,
        profile,
        integrity,
        accountName: db.users.find((u) => u.email === email)?.name,
        durationMinutes,
      })

      const employerInterviewContext =
        session?.questionMode === 'employer' ||
        session?.questionMode === 'individual_jd' ||
        session?.questionMode === 'vendor_jd' ||
        Boolean(session?.jobId) ||
        String(session?.jobDescription || body.jobDescription || '').trim().length >= 40

      let atsForComposite =
        typeof session?.atsScore === 'number'
          ? session.atsScore
          : typeof body.atsScore === 'number'
            ? body.atsScore
            : null

      if (employerInterviewContext && atsForComposite == null) {
        const jdText = String(session?.jobDescription || body.jobDescription || '')
        const resumeText = String(profile?.resumeText || db.profiles[email]?.resumeText || '')
        if (jdText.trim().length >= 30 && resumeText.trim().length >= 30) {
          try {
            const hybrid = await evaluateResumeAgainstJd({
              resumeText,
              jobDescription: jdText,
              requiredSkills: session?.primarySkills || [],
              roleTitle: role,
              skipLlm: true,
            })
            atsForComposite = hybrid.atsScore
            session.atsScore = hybrid.atsScore
            session.jdMatchScore = hybrid.jdMatchScore
            session.skillAnalysis = session.skillAnalysis || {}
            session.skillAnalysis.atsBreakdown = hybrid.atsBreakdown
          } catch {
            // keep interview-only overall
          }
        }
      }

      if (employerInterviewContext && typeof atsForComposite === 'number') {
        const interviewOnly = result.overall
        const composite = computeEmployerInterviewComposite(interviewOnly, atsForComposite)
        result.interviewScore = composite.interviewScore
        result.atsScore = composite.atsScore
        result.overall = composite.compositeScore
        result.compositeScore = composite.compositeScore
        result.resumeFitScore = composite.atsScore
      }

      db.interviews[email] = result
      if (session) {
        session.status = 'completed'
        session.answers = scoredAnswers
        session.questions = scoredQuestions
        session.result = result
        session.completedAt = new Date().toISOString()
        db.interviewSessions[sessionId] = session
      }
      await saveDb(db)
      const scoredUser = db.users.find((u) => u.email === email)
      const applicationId = String(session?.applicationId || '')
      let organizationId = String(session?.organizationId || '')
      if (applicationId && !organizationId) {
        const linked = (db.employerApplications || []).find((a) => a.id === applicationId)
        if (linked?.organizationId) organizationId = String(linked.organizationId)
      }
      if (applicationId && organizationId) {
        const app = getOrgApplication(db, organizationId, applicationId)
        if (!app || app.candidateEmail !== email || (app.candidateUserId && app.candidateUserId !== scoredUser?.id)) {
          return json(res, 403, { error: 'This application does not belong to your account.' })
        }
        const job = app ? getOrgJob(db, organizationId, app.jobId) : null
        let vendorReport = null
        if (app) {
          vendorReport = await generateVendorAssessmentSheet({
            candidateName: app.data.candidateName || email,
            jobTitle: job?.title || app.data.jobTitle,
            company: job?.company || app.data.company,
            jobDescription: job?.jobDescription || session?.jobDescription || body.jobDescription || '',
            resumeText: app.data.resumeText || String(db.profiles[email]?.resumeText || ''),
            atsEvaluation: {
              atsScore: app.data.atsScore ?? session?.atsScore,
              jdMatchScore: app.data.jdMatchScore ?? session?.jdMatchScore,
              primarySkills: app.data.primarySkills,
              matchedSkills: app.data.matchedSkills,
              missingSkills: app.data.missingSkills,
              strengths: app.data.atsStrengths,
              gaps: app.data.atsGaps,
              summary: app.data.atsSummary,
            },
            interviewResult: result,
          })
        }
        updateApplicationInterview(db, applicationId, organizationId, result, {
          atsScore: session?.atsScore ?? app?.data?.atsScore ?? null,
          jdMatchScore: session?.jdMatchScore ?? app?.data?.jdMatchScore ?? null,
          vendorReport,
        })
        await saveDb(db)
      }
      if (scoredUser && config.databaseUrl) {
        void upsertCandidateTalent(
          config.databaseUrl,
          scoredUser,
          db.profiles[email] || {},
          result,
        ).catch((err) => console.warn('[talent] score index:', err.message))
        if (session?.organizationId && scoredUser.id) {
          void grantOrganizationTalentAccess(
            config.databaseUrl,
            session.organizationId,
            scoredUser.id,
            'interview',
          ).catch((err) => console.warn('[talent] grant access:', err.message))
        }
      }
      void appendInterviewHistory(config.databaseUrl, email, result, {
        userId: scoredUser?.id,
        organizationId: session?.organizationId || scoredUser?.primaryOrganizationId || null,
        jobId: session?.jobId || null,
      }).catch((err) => {
        console.warn('[db] interview history append failed:', err.message)
      })
      return json(res, 200, { interview: result })
    }

    if (req.method === 'POST' && path === '/api/interview') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const db = loadDb()
      db.interviews[email] = body
      await saveDb(db)
      return json(res, 200, { interview: body })
    }

    if (req.method === 'GET' && path === '/api/applications') {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      let applications = db.applications[email] || []
      if (config.databaseUrl) {
        applications = await loadJobApplicationsForEmail(config.databaseUrl, email)
        db.applications[email] = applications
      }
      applications = (applications || []).map((row) => ({
        ...row,
        jobStatus: row.jobStatus === 'deleted' ? 'deleted' : 'active',
      }))
      return json(res, 200, { applications })
    }

    if (req.method === 'DELETE' && path.startsWith('/api/applications/')) {
      const email = await requireAuth(req, res)
      if (!email) return
      const appId = path.replace('/api/applications/', '').split('/')[0]
      if (!appId) return json(res, 400, { error: 'Application id required.' })
      const db = loadDb()
      const list = (db.applications[email] || []).filter((a) => String(a.id) !== appId)
      db.applications[email] = list
      if (config.databaseUrl) {
        await deleteJobApplicationRecord(config.databaseUrl, email, appId)
      }
      await saveDb(db)
      return json(res, 200, { applications: list })
    }

    if (req.method === 'POST' && path === '/api/applications') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const db = loadDb()
      const record = {
        ...body,
        id: body.id || randomBytes(6).toString('hex'),
        appliedAt: body.appliedAt || new Date().toISOString(),
        status: body.status || 'Applied',
      }
      db.applications[email] = db.applications[email] || []
      const idx = db.applications[email].findIndex((a) => a.id === record.id)
      if (idx >= 0) db.applications[email][idx] = { ...db.applications[email][idx], ...record }
      else db.applications[email].unshift(record)
      if (config.databaseUrl) {
        await upsertJobApplicationRecord(config.databaseUrl, email, record)
      }
      await saveDb(db)
      return json(res, 201, { applications: db.applications[email], application: record })
    }

    /* -------------------------------------------------------------
     * CONFIDENTIAL TALENT & RESUME VAULT APIS
     * ------------------------------------------------------------- */

    /** Get all confidential candidates (supports ?q= and ?status=) */
    if (req.method === 'GET' && path === '/api/confidential/candidates') {
      const db = loadDb()
      const q = String(url.searchParams.get('q') || '').toLowerCase().trim()
      const status = String(url.searchParams.get('status') || 'All')

      let list = (db.confidentialVault || []).filter(c => c.organizationId === vaultTenantId)
      if (q) {
        list = list.filter(
          (c) =>
            c.name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.currentRole?.toLowerCase().includes(q) ||
            c.location?.toLowerCase().includes(q) ||
            (c.skills && c.skills.some((s) => s.toLowerCase().includes(q))) ||
            c.resumeText?.toLowerCase().includes(q),
        )
      }
      if (status && status !== 'All') {
        list = list.filter((c) => c.status === status)
      }
      return json(res, 200, {
        total: list.length,
        candidates: list,
      })
    }

    /** Add / Ingest a candidate directly into the confidential vault */
    if (req.method === 'POST' && path === '/api/confidential/candidates') {
      const body = await readBody(req)
      if (!body.name && !body.email) {
        return json(res, 400, { error: 'Candidate name or email is required.' })
      }
      const db = loadDb()
      if (!db.confidentialVault) db.confidentialVault = []

      const candidate = {
        id: `conf-${randomBytes(6).toString('hex')}`,
        organizationId: vaultTenantId,
        name: String(body.name || 'Anonymous Candidate'),
        email: String(body.email || `candidate_${Date.now()}@confidential.io`),
        phone: String(body.phone || ''),
        currentRole: String(body.currentRole || ''),
        experienceYears: String(body.experienceYears || ''),
        location: String(body.location || ''),
        skills: Array.isArray(body.skills) ? body.skills : [],
        resumeName: String(body.resumeName || 'candidate_resume.pdf'),
        resumeText: String(body.resumeText || ''),
        summary: String(body.summary || body.resumeText?.slice(0, 160) || ''),
        interviewScore: typeof body.interviewScore === 'number' ? body.interviewScore : undefined,
        interviewResult: body.interviewResult || undefined,
        status: body.status || 'New',
        source: String(body.source || 'Confidential Ingestion API'),
        createdAt: new Date().toISOString(),
      }

      db.confidentialVault.unshift(candidate)
      await saveDb(db)
      return json(res, 201, { success: true, candidate })
    }

    /** Get single candidate by ID */
    if (req.method === 'GET' && path.startsWith('/api/confidential/candidates/')) {
      const id = path.replace('/api/confidential/candidates/', '')
      const db = loadDb()
      const item = (db.confidentialVault || []).find((c) => c.id === id && c.organizationId === vaultTenantId)
      if (!item) return json(res, 404, { error: 'Confidential candidate not found.' })
      return json(res, 200, { candidate: item })
    }

    /** Update candidate status */
    if (req.method === 'PUT' && path.startsWith('/api/confidential/candidates/') && path.endsWith('/status')) {
      const id = path.split('/')[4]
      const body = await readBody(req)
      const db = loadDb()
      const idx = (db.confidentialVault || []).findIndex((c) => c.id === id && c.organizationId === vaultTenantId)
      if (idx < 0) return json(res, 404, { error: 'Confidential candidate not found.' })

      db.confidentialVault[idx].status = body.status || db.confidentialVault[idx].status
      await saveDb(db)
      return json(res, 200, { success: true, candidate: db.confidentialVault[idx] })
    }

    /** Delete candidate */
    if (req.method === 'DELETE' && path.startsWith('/api/confidential/candidates/')) {
      const id = path.replace('/api/confidential/candidates/', '')
      const db = loadDb()
      db.confidentialVault = (db.confidentialVault || []).filter((c) => c.id !== id || c.organizationId !== vaultTenantId)
      await saveDb(db)
      return json(res, 200, { success: true, deletedId: id })
    }

    /** Export all confidential vault data */
    if (req.method === 'GET' && path === '/api/confidential/export') {
      const db = loadDb()
      return json(res, 200, {
        exportedAt: new Date().toISOString(),
        total: (db.confidentialVault || []).filter(c => c.organizationId === vaultTenantId).length,
        candidates: (db.confidentialVault || []).filter(c => c.organizationId === vaultTenantId),
      })
    }

    /** Confidential KPI metrics */
    if (req.method === 'GET' && path === '/api/confidential/stats') {
      const db = loadDb()
      const list = (db.confidentialVault || []).filter(c => c.organizationId === vaultTenantId)
      const scored = list.filter((c) => typeof c.interviewScore === 'number')
      const avgScore = scored.length
        ? Math.round(scored.reduce((a, b) => a + (b.interviewScore || 0), 0) / scored.length)
        : 0

      return json(res, 200, {
        totalCandidates: list.length,
        resumesParsed: list.filter((c) => Boolean(c.resumeText)).length,
        interviewsCompleted: scored.length,
        averageTalentScore: avgScore,
      })
    }

    if (serveSpaStatic(req, res, path)) return

    return json(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('[api] request failed', err.code || err.name)
    return json(res, err.status || 500, {
      error: err.status ? err.message : 'Server error',
    })
  }
  }
}
