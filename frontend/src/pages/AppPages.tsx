import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { fadeUp, staggerContainer } from '../motion/variants'
import {
  addNotification,

  getApplications,
  getInterviewResult,
  type Application,
  type InterviewResult,
  getProfile,
  getUser,
  accountDisplayName,
  resolveCandidateName,
  markNotificationsReadWhere,
  rankPostedJobs,
  resolveInterviewOverall,
  saveApplications,
  profileKey,
  interviewResultKey,
  getAccountPrefs,
  saveAccountPrefs,

} from '../lib/store'
import { pullInterviewFromApi, pullProfileFromApi, syncSessionFromApi } from '../lib/apiSync'
import { sanitizeSkillsList } from '../lib/interviewSessionPayload'
import { parseResumeFile } from '../lib/resumeParser'
import { replaceResumeViaApi } from '../lib/replaceResumeApi'
import {
  missingProfileFields,
  profileCheckHref,
  profileCompletionPercent,
} from '../lib/profileCompletion'
import { CareerIntelligenceDashboard } from '../components/CareerIntelligenceDashboard'
import { downloadScorecardPdf } from '../lib/printScorecard'
import {
  goToCandidateDashboardAfterInterview,
  PENDING_REPORT_UPLOAD_KEY,
  type PostInterviewReportState,
} from '../lib/completeOnboardingAfterInterview'
import { uploadInterviewReportPdfToS3, waitForStoredReportPdf } from '../lib/interviewReportUpload'
import { apiListApplications, apiSaveProfile, apiWithdrawApplication } from '../lib/api'
import { ensureApiSession } from '../lib/apiSession'
import { applyToPublicJob, fetchOpenJobs } from '../lib/vendorApi'
import { pruneStaleForYouNotifications, syncJobMatchNotifications } from '../lib/jobMatchNotifications'
import { slugifyCompany } from '../lib/jobLink'
import {
  ANY,
  filterJobBoard,
  hasActiveJobFilters,
  jobLocationOptions,
  jobWorkMode,
  readHiddenJobIds,
  readSavedJobIds,
  writeHiddenJobIds,
  writeSavedJobIds,
} from '../lib/jobBoardFilters'
import { HrIcon } from '../components/HrIcon'
import {
  accountDeletionRequestPath,
  downloadMyData,
  isVisibleToEmployers,
  profileVisibilityFor,
} from '../lib/candidatePrivacy'
import styles from './AppPages.module.css'
import { EXPERIENCE_RANGE_LABELS } from '../lib/resumeExperience'
import { formatPhoneForDisplay } from '../lib/phone'

export { DashboardPage } from './CandidateDashboard'

/** Dates use one format across candidate pages: "18 Nov 2026". */
function formatProfileDate(value?: string) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

/** Full scorecard + PDF download (`/dashboard/report`). */
export function InterviewReportPage() {
  const user = getUser()
  const [interview, setInterview] = useState<InterviewResult | null>(() => getInterviewResult())
  const [profile, setProfile] = useState(() => getProfile())
  const [reportLoading, setReportLoading] = useState(true)
  // The candidate's name on the report always comes from the resume (signup name only without a resume name).
  const reportName = resolveCandidateName(profile, user)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setReportLoading(true)
      await syncSessionFromApi()
      const [remoteInterview, remoteProfile] = await Promise.all([
        pullInterviewFromApi(),
        pullProfileFromApi(),
      ])
      if (cancelled) return
      setInterview(remoteInterview ?? getInterviewResult())
      setProfile(remoteProfile ?? getProfile())
      setReportLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email])
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const reportState = (location.state as PostInterviewReportState | null) ?? null
  const fromInterview = Boolean(reportState?.fromInterview)
  const autoContinueDashboard = Boolean(reportState?.autoContinueDashboard)
  const [autoDownloadDone, setAutoDownloadDone] = useState(false)
  const [dashboardCountdown, setDashboardCountdown] = useState<number | null>(null)

  useEffect(() => {
    if (!interview || autoDownloadDone) return
    if (searchParams.get('download') !== '1') return
    setAutoDownloadDone(true)
    void downloadScorecardPdf(reportName).catch(() => {
      /* user can click Download report on the page */
    })
  }, [interview, autoDownloadDone, searchParams, reportName])

  useEffect(() => {
    if (sessionStorage.getItem(PENDING_REPORT_UPLOAD_KEY) !== '1') return
    const sessionId = sessionStorage.getItem('hireright.lastInterviewSessionId')
    if (!sessionId || !getInterviewResult()) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const ready = await waitForStoredReportPdf(sessionId)
        if (!ready && !cancelled) {
          await uploadInterviewReportPdfToS3(sessionId)
        }
      })().finally(() => {
        if (!cancelled) sessionStorage.removeItem(PENDING_REPORT_UPLOAD_KEY)
      })
    }, 900)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!fromInterview || !autoContinueDashboard || !interview) return
    let seconds = 6
    setDashboardCountdown(seconds)
    const tick = window.setInterval(() => {
      seconds -= 1
      setDashboardCountdown(seconds)
      if (seconds <= 0) {
        window.clearInterval(tick)
        goToCandidateDashboardAfterInterview(navigate)
      }
    }, 1000)
    return () => window.clearInterval(tick)
  }, [fromInterview, autoContinueDashboard, interview, navigate])

  if (user?.role === 'employer') {
    return <Navigate to="/employer/dashboard" replace />
  }

  if (reportLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <main className={styles.main} aria-busy="true">
            <p className="ds-sr-only" role="status">
              Loading your interview report…
            </p>
            <div className={styles.skeletonStack} aria-hidden="true">
              <span className={`ds-skeleton ${styles.skeletonTitle}`} />
              <span className={`ds-skeleton ${styles.skeletonBlock}`} />
              <span className={`ds-skeleton ${styles.skeletonBlock}`} />
            </div>
          </main>
        </div>
      </div>
    )
  }

  if (!interview) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <main className={styles.main}>
            <header className={styles.head}>
              <div>
                <h1>Interview report</h1>
              </div>
            </header>
            <div className="ds-empty">
              <span className="ds-empty__icon" aria-hidden="true">
                <HrIcon name="chart" size={20} />
              </span>
              <p className="ds-empty__title">No report yet</p>
              <p className="ds-empty__body">Complete your AI interview first to generate a career report.</p>
              <div className="ds-empty__actions">
                <Link to="/interview" className="ds-btn ds-btn--primary">
                  Start interview
                </Link>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <main className={styles.main}>
          {fromInterview ? (
            <div className={`ds-alert ds-alert--info ${styles.reportNotice}`} role="status">
              <div className={styles.reportNoticeBody}>
                <p>
                  {autoContinueDashboard
                    ? 'Your interview is complete. Review your report. We’ll open your dashboard shortly.'
                    : 'Your interview is complete. Review your report below, then continue to your dashboard.'}
                </p>
                {autoContinueDashboard && dashboardCountdown != null && dashboardCountdown > 0 && (
                  <p className={styles.reportNoticeMeta}>
                    Opening your dashboard in {dashboardCountdown}s…
                  </p>
                )}
              </div>
              {autoContinueDashboard && dashboardCountdown != null && dashboardCountdown > 0 && (
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary ds-btn--sm"
                  onClick={() => goToCandidateDashboardAfterInterview(navigate)}
                >
                  Go now
                </button>
              )}
            </div>
          ) : (
            <p className={styles.reportBack}>
              <Link to="/dashboard" className="ds-btn ds-btn--ghost ds-btn--sm">
                Back to dashboard
              </Link>
            </p>
          )}
          <CareerIntelligenceDashboard
            result={interview}
            candidateName={reportName}
            candidateRole={profile?.currentRole || interview.role}
            candidateExperience={profile?.totalExperience || interview.level}
            skills={profile?.skills ?? []}
            interviewSessionId={
              interview.sessionId ||
              (typeof sessionStorage !== 'undefined'
                ? sessionStorage.getItem('hireright.lastInterviewSessionId')
                : null)
            }
            onRetake={() => navigate('/interview')}
            onContinue={() => goToCandidateDashboardAfterInterview(navigate)}
          />
        </main>
      </div>
    </div>
  )
}

interface JobMatchRole {
  id: string
  logo: string
  logoColor: string
  logoBg: string
  title: string
  company: string
  location: string
  mode: string
  salary: string
  experience: string
  jobType: string
  badge: string
  badgeType: 'topPick' | 'new' | 'open'
  matchedSkills: string[]
  gapSkills: string[]
  posted: string
  applicants: string
  match: number
  minScore: number
  breakdown: {
    interviewFit: number
    resumeFit: number
    skillsFit: number
    experienceFit: number
  }
  youHave: string[]
  closeGap: string[]
  about: string
  bullets: string[]
  shareableCode?: string
  companySlug?: string
  postedAt?: string
  skillTags: string[]
}

function formatPostedAgo(iso?: string) {
  if (!iso) return 'Posted recently'
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return 'Posted recently'
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return `Posted ${date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })}`
}

function companyLogoStyle(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const hues = [245, 210, 165, 200, 280, 320]
  const hue = hues[Math.abs(hash) % hues.length]
  return {
    bg: `hsl(${hue} 55% 94%)`,
    color: `hsl(${hue} 45% 38%)`,
  }
}

export function JobsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const highlightJobId = searchParams.get('job')
  const [toast, setToast] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [locationFilter, setLocationFilter] = useState('Any')
  const [workModeFilter, setWorkModeFilter] = useState('Any')
  const [sortBy, setSortBy] = useState('Best match')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [jobScope, setJobScope] = useState<'matched' | 'all'>('matched')
  const [jobsListMeta, setJobsListMeta] = useState<{
    totalOpen?: number
    candidateRoleHints?: string[]
    personalized?: boolean
    message?: string
  }>({})
  const candidateEmail = getUser()?.email
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(() => readSavedJobIds(candidateEmail))
  const [hiddenJobIds, setHiddenJobIds] = useState<Set<string>>(() => readHiddenJobIds(candidateEmail))
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null)
  const applyInFlight = useRef(false)
  // Jobs already applied to (from the synced application list): the card shows "Applied" instead of a second apply.
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(
    () => new Set(getApplications().map((a) => a.jobId).filter((id): id is string => Boolean(id))),
  )
  const [interview, setInterview] = useState<InterviewResult | null>(() => getInterviewResult())

  const interviewOverall = resolveInterviewOverall(interview)
  const candidateScoreLabel =
    interviewOverall !== null ? String(interviewOverall) : 'not completed yet'
  const unlocked = interviewOverall !== null

  const [employerJobs, setEmployerJobs] = useState<JobMatchRole[]>([])
  const [jobsBoardState, setJobsBoardState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [jobsBoardError, setJobsBoardError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setJobsBoardState('loading')
      setJobsBoardError('')
      try {
        const pulled = await pullInterviewFromApi()
        if (!cancelled) setInterview(pulled ?? getInterviewResult())

        const sessionOk = await ensureApiSession()
        if (!sessionOk) {
          if (!cancelled) {
            setJobsBoardState('error')
            setJobsBoardError('Sign in as a candidate to see employer-posted roles.')
            setEmployerJobs([])
          }
          return
        }
        await pullProfileFromApi()
        void apiListApplications()
          .then((apps) => {
            if (cancelled) return
            saveApplications(apps)
            setAppliedJobIds(new Set(apps.map((a) => a.jobId).filter((id): id is string => Boolean(id))))
          })
          .catch(() => {
            /* the Applied badge falls back to the cached list */
          })
        const [listRes, forYouRes] = await Promise.all([
          fetchOpenJobs({ summary: true, scope: jobScope }),
          fetchOpenJobs({ summary: true, scope: 'matched', limit: 100, background: true }),
        ])
        if (cancelled) return
        setJobsListMeta({
          totalOpen: listRes.totalOpen ?? listRes.total,
          candidateRoleHints: listRes.candidateRoleHints,
          personalized: listRes.personalized,
          message: listRes.message,
        })
        const rawJobs = listRes.jobs ?? []
        const forYouJobs = forYouRes.jobs ?? []
        pruneStaleForYouNotifications(forYouJobs.map((j) => j.id))
        syncJobMatchNotifications(forYouJobs.map((j) => ({ id: j.id, title: j.title, company: j.company })))
        if (rawJobs.length === 0) {
          setEmployerJobs([])
          setJobsBoardState('ready')
          return
        }
        const ranked = rankPostedJobs(rawJobs)
        const mapped: JobMatchRole[] = ranked.map((j, idx) => {
          const raw = rawJobs.find((rj) => rj.id === j.id)
          const cleaned = sanitizeSkillsList(raw?.requiredSkills ?? [])
          const reqSkills = cleaned.length ? cleaned : ['Skills in job description']
          const logoStyle = companyLogoStyle(j.company)
          const jd = raw?.jobDescription || j.jobDescription || ''
          const jdBullets = jd
            .split(/\n/)
            .map((line) => line.replace(/^[\s•\-*]+/, '').trim())
            .filter((line) => line.length > 20)
            .slice(0, 3)
          return {
            id: j.id || `emp-${idx}`,
            logo: j.company.slice(0, 2).toUpperCase(),
            logoColor: logoStyle.color,
            logoBg: logoStyle.bg,
            title: j.title,
            company: j.company,
            location: j.location || 'Remote',
            mode: jobWorkMode(j.location),
            salary: 'Employer listed',
            experience: j.experienceLevel || raw?.experienceLevel || 'See job description',
            jobType: 'Full-time',
            badge: idx === 0 ? 'Top pick' : 'New',
            badgeType: idx === 0 ? 'topPick' : 'new',
            matchedSkills: reqSkills.slice(0, 2),
            gapSkills: reqSkills.slice(2, 4),
            posted: formatPostedAgo(raw?.createdAt),
            postedAt: raw?.createdAt,
            skillTags: reqSkills.slice(0, 10),
            applicants: 'Apply with your resume',
            match: j.match || 85,
            minScore: 70,
            breakdown: {
              interviewFit: Math.min(95, (j.match || 85) + 2),
              resumeFit: Math.min(95, (j.match || 85) - 1),
              skillsFit: Math.min(95, (j.match || 85) + 3),
              experienceFit: Math.min(95, (j.match || 85)),
            },
            youHave: reqSkills.slice(0, 3),
            closeGap: reqSkills.slice(3, 5),
            about: jd.slice(0, 600) || 'Role posted by an employer on HireRight.',
            bullets:
              jdBullets.length > 0
                ? jdBullets
                : ['Review the full description on the apply form.', 'Submit your resume to check how well it matches.'],
            shareableCode: j.shareableCode || raw?.shareableCode,
            companySlug: j.companySlug || raw?.companySlug,
          }
        })
        setEmployerJobs(mapped)
        setJobsBoardState('ready')
      } catch {
        if (!cancelled) {
          setJobsBoardState('error')
          setJobsBoardError('We could not load job openings. Please try again in a moment.')
          setEmployerJobs([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [jobScope])

  useEffect(() => {
    if (!highlightJobId) return
    if (employerJobs.some((j) => j.id === highlightJobId)) {
      setSelectedJobId(highlightJobId)
    }
  }, [highlightJobId, employerJobs])

  const allRoles = useMemo(() => employerJobs, [employerJobs])

  // Filter and sort (the visible filters apply in both scopes; "For you" itself is decided by the server)
  const jobFilters = { search: searchTerm, location: locationFilter, mode: workModeFilter }
  const filtersActive = hasActiveJobFilters(jobFilters)
  const locationOptions = useMemo(() => jobLocationOptions(allRoles), [allRoles])
  const filteredRoles = useMemo(
    () => filterJobBoard(allRoles, { search: searchTerm, location: locationFilter, mode: workModeFilter }, hiddenJobIds),
    [allRoles, searchTerm, locationFilter, workModeFilter, hiddenJobIds],
  )

  const sortedRoles = useMemo(() => {
    const list = [...filteredRoles]
    if (sortBy === 'Most recent') {
      list.sort((a, b) => {
        const ta = new Date(a.postedAt || 0).getTime()
        const tb = new Date(b.postedAt || 0).getTime()
        return tb - ta
      })
    } else {
      list.sort((a, b) => b.match - a.match)
    }
    return list
  }, [filteredRoles, sortBy])

  const visibleRoles = sortedRoles

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null
    return sortedRoles.find((j) => j.id === selectedJobId) || null
  }, [sortedRoles, selectedJobId])

  useEffect(() => {
    if (selectedJobId && !sortedRoles.some((j) => j.id === selectedJobId)) {
      setSelectedJobId(null)
    }
  }, [sortedRoles, selectedJobId])

  function buildResumeTextForApply() {
      const user = getUser()
      const profile = getProfile()
    const fromResume = profile?.resumeText?.trim() || ''
    if (fromResume.length >= 30) return fromResume.slice(0, 100_000)
    const parts = [
      `Candidate: ${resolveCandidateName(profile, user)}`,
      profile?.currentRole ? `Role: ${profile.currentRole}` : '',
      profile?.totalExperience ? `Experience: ${profile.totalExperience}` : '',
      profile?.experienceSummary || profile?.whoAreYou || '',
      profile?.keyStrengths ? `Strengths: ${profile.keyStrengths}` : '',
      profile?.skills?.length ? `Skills: ${profile.skills.join(', ')}` : '',
      interviewOverall !== null
        ? `AI interview score: ${interviewOverall}% (${interview?.role || 'Interview'})`
        : '',
    ].filter(Boolean)
    return parts.join('\n').slice(0, 100_000)
  }

  async function handleApply(job: JobMatchRole) {
    if (applyInFlight.current || appliedJobIds.has(job.id)) return
    applyInFlight.current = true
    setApplyingJobId(job.id)
    try {
      await applyToJob(job)
    } finally {
      applyInFlight.current = false
      setApplyingJobId(null)
    }
  }

  async function applyToJob(job: JobMatchRole) {
    if (!job.shareableCode) {
      setToast('This role is missing an apply link. Ask the employer to re-share the job.')
      window.setTimeout(() => setToast(''), 6000)
      return
    }
    const sessionOk = await ensureApiSession()
    if (!sessionOk) {
      navigate('/login', { state: { from: '/jobs' } })
      return
    }
    const user = getUser()
    const profile = getProfile()
    const resumeText = buildResumeTextForApply()
    const latestInterview = (await pullInterviewFromApi()) ?? getInterviewResult()
    setInterview(latestInterview)
    const overall = resolveInterviewOverall(latestInterview)
    if (overall === null) {
      setToast('Complete an AI interview before applying with your report.')
      window.setTimeout(() => setToast(''), 6000)
      return
    }
    if (resumeText.trim().length < 30) {
      setToast('Complete your profile or upload a resume before applying with your report.')
      window.setTimeout(() => setToast(''), 6000)
      return
    }
    try {
        await applyToPublicJob(
          job.shareableCode,
          {
          candidateName: resolveCandidateName(profile, user),
            candidateEmail: user?.email || '',
          candidatePhone: user?.phone || '',
          candidateRole: profile?.currentRole || interview?.role || '',
          experienceYears: profile?.totalExperience || interview?.level || '',
          resumeText,
          resumeName: profile?.resumeName || 'HireRighttt profile',
          attachInterviewReport: true,
          match: job.match,
          source: 'job_board',
        },
        job.companySlug || slugifyCompany(job.company),
      )
      const synced = await apiListApplications()
      saveApplications(synced)
      setAppliedJobIds((prev) => new Set([...prev, job.id, ...synced.map((a) => a.jobId).filter((id): id is string => Boolean(id))]))
      addNotification({
        kind: 'application',
        title: `Applied to ${job.title}`,
        body: `${job.company} received your application and AI score.`,
        href: '/applications',
      })
      setToast(`Applied to ${job.title}. Your report was sent to the employer.`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not submit your application.')
    } finally {
      window.setTimeout(() => setToast(''), 4000)
    }
  }

  function handleSave(job: JobMatchRole) {
    const next = new Set(savedJobIds)
    if (next.has(job.id)) {
      next.delete(job.id)
      setToast(`Removed ${job.title} from saved roles.`)
    } else {
      next.add(job.id)
      setToast(`Saved ${job.title} to your bookmarked roles.`)
    }
    setSavedJobIds(next)
    writeSavedJobIds(candidateEmail, next)
    window.setTimeout(() => setToast(''), 2500)
  }

  function handleNotForMe(job: JobMatchRole) {
    const next = new Set(hiddenJobIds)
    next.add(job.id)
    setHiddenJobIds(next)
    writeHiddenJobIds(candidateEmail, next)
    setSelectedJobId(null)
    setToast(`Hidden "${job.title}". It will not show in your list again.`)
    window.setTimeout(() => setToast(''), 2500)
  }

  function showHiddenJobs() {
    const next = new Set<string>()
    setHiddenJobIds(next)
    writeHiddenJobIds(candidateEmail, next)
  }

  const jobsHeadline =
    jobsBoardState === 'loading'
      ? 'Loading roles…'
      : sortedRoles.length === 0
        ? 'No jobs found'
        : `${sortedRoles.length} job${sortedRoles.length === 1 ? '' : 's'}`

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <motion.div
          className={styles.main}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.header className={styles.head} variants={fadeUp}>
            <div>
              <h1>Jobs</h1>
              <p>Open roles from employers on HireRighttt. Select a job to see details and apply.</p>
            </div>
          </motion.header>

          <motion.div className={styles.jobsToolbar} variants={fadeUp}>
            <div className={styles.jobsSearchWrap}>
              <HrIcon name="search" size={16} className={styles.jobsSearchIcon} />
              <input
                type="search"
                className={styles.jobsSearchInput}
                placeholder="Search by title, company or skill"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search jobs"
              />
            </div>
            <div className={styles.jobsToolbarFilters}>
              <select
                className={styles.select}
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                aria-label="Location"
              >
                <option value={ANY}>Any location</option>
                {locationOptions.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              <select
                className={styles.select}
                value={workModeFilter}
                onChange={(e) => setWorkModeFilter(e.target.value)}
                aria-label="Work mode"
              >
                <option value={ANY}>Any mode</option>
                <option value="Remote">Remote only</option>
              </select>
              <select
                className={styles.select}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort jobs"
              >
                <option value="Best match">Best match</option>
                <option value="Most recent">Most recent</option>
              </select>
            </div>
          </motion.div>

          <motion.div className={styles.jobsScopeRow} variants={fadeUp}>
            <div className={styles.segmented} role="group" aria-label="Which jobs to show">
              <button
                type="button"
                className={styles.segmentedItem}
                aria-pressed={jobScope === 'matched'}
                onClick={() => setJobScope('matched')}
              >
                For you
              </button>
              <button
                type="button"
                className={styles.segmentedItem}
                aria-pressed={jobScope === 'all'}
                onClick={() => setJobScope('all')}
              >
                All jobs
                {jobScope === 'all' && employerJobs.length > 0
                  ? ` (${employerJobs.length})`
                  : jobsListMeta.totalOpen != null
                    ? ` (${jobsListMeta.totalOpen})`
                    : ''}
              </button>
            </div>
            <p className={styles.jobsScopeMeta}>
              <span className={styles.jobsResultCount} aria-live="polite">
                {jobsHeadline}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {!unlocked
                  ? 'Complete interview to apply with your report'
                  : `Interview score ${candidateScoreLabel}/100`}
              </span>
            </p>
          </motion.div>

          {jobsBoardError ? (
            <div className={`ds-alert ds-alert--error ${styles.pageAlert}`} role="alert">
              {jobsBoardError}
            </div>
          ) : null}
          {!jobsBoardError && jobScope === 'matched' && jobsListMeta.message ? (
            <div className={`ds-alert ds-alert--info ${styles.pageAlert}`}>{jobsListMeta.message}</div>
          ) : null}

          {toast ? (
            <div className="ds-toast" role="status">
              {toast}
            </div>
          ) : null}

          {!unlocked && jobsBoardState === 'ready' && visibleRoles.length > 0 ? (
            <div className={`ds-alert ds-alert--info ${styles.pageAlert}`} role="status">
              <p>
                Take your 15-minute AI interview to apply with your report.{' '}
                <Link to="/interview" className={styles.jobsInlineCta}>
                  Start interview
                </Link>
              </p>
            </div>
          ) : null}

          <motion.div
            className={styles.jobsFeedList}
            variants={fadeUp}
            aria-busy={jobsBoardState === 'loading'}
          >
            {jobsBoardState === 'loading'
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={`sk-${i}`} className={`${styles.jobCard} ${styles.jobCardSkeleton}`} aria-hidden="true">
                    <span className={`ds-skeleton ${styles.skeletonTitle}`} />
                    <span className={`ds-skeleton ds-skeleton-line ${styles.skeletonShort}`} />
                    <span className="ds-skeleton ds-skeleton-line" />
                  </div>
                ))
              : null}

            {jobsBoardState === 'ready' && visibleRoles.length === 0 && !jobsBoardError ? (
              employerJobs.length > 0 ? (
                <div className="ds-empty">
                  <span className="ds-empty__icon" aria-hidden="true">
                    <HrIcon name="search" size={20} />
                  </span>
                  <p className="ds-empty__title">
                    {filtersActive ? 'No results match these filters' : 'You have hidden every role here'}
                  </p>
                  <p className="ds-empty__body">
                    {filtersActive
                      ? 'Clear the search, or set location and work mode to “Any” to see more roles.'
                      : 'Roles you marked “Not for me” are hidden. Show them again to review them.'}
                  </p>
                  <div className="ds-empty__actions">
                    {filtersActive ? (
                      <button
                        type="button"
                        className="ds-btn ds-btn--secondary"
                        onClick={() => {
                          setLocationFilter(ANY)
                          setWorkModeFilter(ANY)
                          setSearchTerm('')
                        }}
                      >
                        Clear filters
                      </button>
                    ) : null}
                    {hiddenJobIds.size > 0 ? (
                      <button type="button" className="ds-btn ds-btn--ghost" onClick={showHiddenJobs}>
                        Show hidden roles ({hiddenJobIds.size})
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="ds-empty">
                  <span className="ds-empty__icon" aria-hidden="true">
                    <HrIcon name="briefcase" size={20} />
                  </span>
                  <p className="ds-empty__title">No open roles yet</p>
                  <p className="ds-empty__body">
                    When employers post jobs on HireRighttt, they appear here. Complete your profile and
                    interview to apply with your AI report.
                  </p>
                  {jobScope === 'matched' && (jobsListMeta.totalOpen ?? 0) > 0 ? (
                    <div className="ds-empty__actions">
                      <button
                        type="button"
                        className="ds-btn ds-btn--secondary"
                        onClick={() => setJobScope('all')}
                      >
                        Browse all {jobsListMeta.totalOpen} jobs
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            ) : null}

            {visibleRoles.map((job) => {
              const isOpen = selectedJob?.id === job.id
              const isSaved = savedJobIds.has(job.id)
              const locationLine = job.mode ? `${job.mode} · ${job.location}` : job.location
              return (
                <article key={job.id} className={`${styles.jobCard} ${isOpen ? styles.jobCardOpen : ''}`}>
                  <button
                    type="button"
                    className={styles.jobCardHit}
                    onClick={() => setSelectedJobId(isOpen ? null : job.id)}
                    aria-expanded={isOpen}
                  >
                    <span className={styles.jobLogo} aria-hidden="true">
                      {job.logo}
                    </span>
                    <span className={styles.jobCardHeadline}>
                      <h2 className={styles.jobTitle}>{job.title}</h2>
                      <span className={styles.jobCompanyRow}>
                        <span className={styles.jobCompany}>{job.company}</span>
                        {unlocked ? (
                          <span className="ds-pill ds-pill--success">{job.match}% profile match</span>
                        ) : null}
                      </span>
                      <span className={styles.jobMetaRow}>
                        <span className={styles.jobMetaItem}>
                          <HrIcon name="briefcase" size={16} />
                          {job.experience}
                        </span>
                        {/* Jobs have no salary field yet: show pay only when the employer actually listed it. */}
                        {job.salary && job.salary !== 'Employer listed' ? (
                          <span className={styles.jobMetaItem}>
                            <span className={styles.jobRupee} aria-hidden="true">
                              ₹
                            </span>
                            {job.salary}
                          </span>
                        ) : null}
                        <span className={styles.jobMetaItem}>
                          <HrIcon name="map-pin" size={16} />
                          {locationLine}
                        </span>
                      </span>
                      {job.skillTags.length > 0 ? (
                        <span className={styles.jobSkillsLine}>{job.skillTags.join(' · ')}</span>
                      ) : null}
                    </span>
                  </button>

                  <div className={styles.jobCardFoot}>
                    <span className={styles.jobPosted}>{job.posted}</span>
                    <div className={styles.jobCardFootActions}>
                      <button
                        type="button"
                        className="ds-btn ds-btn--ghost ds-btn--sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedJobId(job.id)
                        }}
                      >
                        View role
                      </button>
                      <button
                        type="button"
                        className={`ds-btn ds-btn--ghost ds-btn--sm ${isSaved ? styles.jobSaveActive : styles.jobSave}`}
                        aria-pressed={isSaved}
                        aria-label={`${isSaved ? 'Saved' : 'Save'}: ${job.title} at ${job.company}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSave(job)
                        }}
                      >
                        <HrIcon name="star" size={14} />
                        {isSaved ? 'Saved' : 'Save'}
                      </button>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className={styles.jobExpand}>
                      <p className={styles.jobAbout}>{job.about}</p>
                      {job.bullets.length > 0 ? (
                        <ul className={styles.jobBullets}>
                          {job.bullets.map((b, idx) => (
                            <li key={idx}>{b}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className={styles.jobExpandActions}>
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          onClick={() => handleNotForMe(job)}
                        >
                          Not for me
                        </button>
                        {appliedJobIds.has(job.id) ? (
                          <Link to="/applications" className="ds-btn ds-btn--secondary">
                            Applied · View application
                          </Link>
                        ) : (
                        <button
                          type="button"
                          className="ds-btn ds-btn--primary"
                          disabled={applyingJobId !== null}
                          aria-busy={applyingJobId === job.id}
                          onClick={() => void handleApply(job)}
                        >
                          {applyingJobId === job.id ? (
                            <>
                              <span className="ds-spinner" aria-hidden="true" />
                              Applying…
                            </>
                          ) : unlocked ? (
                            'Apply with my report'
                          ) : (
                            'Take interview to apply'
                          )}
                        </button>
                        )}
                      </div>
                      <p className={styles.jobApplyNote}>
                        Applying shares your HireRighttt interview report and resume with this employer.
                      </p>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

function profileSkillsToList(skills: string[] | undefined) {
  const names = (skills ?? []).map((s) => s.trim()).filter(Boolean)
  return names.map((name) => ({ name, level: 'Good' as const }))
}

type ProfileSectionHeaderProps = {
  title: string
  subtitle?: string
  editing: boolean
  saving: boolean
  editLabel: string
  editTestId: string
  doneTestId: string
  cancelTestId: string
  savingTestId: string
  onEdit: () => void
  onDone: () => void
  onCancel: () => void
}

function ProfileSectionHeader({
  title,
  subtitle,
  editing,
  saving,
  editLabel,
  editTestId,
  doneTestId,
  cancelTestId,
  savingTestId,
  onEdit,
  onDone,
  onCancel,
}: ProfileSectionHeaderProps) {
  return (
    <>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionHeaderText}>
          <h2 className={styles.cardTitle}>{title}</h2>
          {subtitle ? <p className={styles.cardSub}>{subtitle}</p> : null}
        </div>
        <div className={styles.sectionHeaderActions}>
          {!editing ? (
            <button
              type="button"
              className="ds-btn ds-btn--secondary ds-btn--sm"
              data-testid={editTestId}
              onClick={onEdit}
              disabled={saving}
            >
              {editLabel}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="ds-btn ds-btn--ghost ds-btn--sm"
                data-testid={cancelTestId}
                onClick={onCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--secondary ds-btn--sm"
                data-testid={doneTestId}
                onClick={() => void onDone()}
                disabled={saving}
                aria-busy={saving}
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
      {saving ? (
        <p className={`ds-alert ds-alert--info ${styles.savingNotice}`} data-testid={savingTestId} role="status">
          <span className="ds-spinner" aria-hidden="true" />
          Updating, please wait…
        </p>
      ) : null}
    </>
  )
}

export function ProfilePage() {
  const navigate = useNavigate()
  const profileLocation = useLocation()
  useEffect(() => {
    const section = profileLocation.hash.slice(1)
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' })
  }, [profileLocation.hash])
  const user = getUser()
  const [liveProfile, setLiveProfile] = useState(() => getProfile())
  const profile = liveProfile
  const interview = getInterviewResult()
  const [profileLoading, setProfileLoading] = useState(true)

  const [toast, setToast] = useState('')
  const resumeFileInputRef = useRef<HTMLInputElement>(null)
  const [resumeReplaceStatus, setResumeReplaceStatus] = useState<
    'idle' | 'updating' | 'updated'
  >('idle')
  const [resumeReplaceError, setResumeReplaceError] = useState('')

  useEffect(() => {
    if (resumeReplaceStatus !== 'updated') return
    const t = window.setTimeout(() => setResumeReplaceStatus('idle'), 2000)
    return () => window.clearTimeout(t)
  }, [resumeReplaceStatus])

  async function handleResumeFilePicked(file: File) {
    setResumeReplaceError('')
    setResumeReplaceStatus('updating')
    try {
      const extract = await parseResumeFile(file)
      const outcome = await replaceResumeViaApi(file, extract)
      if (!outcome.ok) {
        setResumeReplaceStatus('idle')
        setResumeReplaceError(outcome.error)
        return
      }
      const userEmail = getUser()?.email
      if (userEmail) {
        localStorage.setItem(profileKey(userEmail), JSON.stringify(outcome.profile))
        localStorage.removeItem(interviewResultKey(userEmail))
      }
      setLiveProfile(outcome.profile)
      setFullName(resolveCandidateName(outcome.profile, getUser()))  // the new resume's name
      window.dispatchEvent(new Event('hireright-auth'))  // nav / menus pick up the new name
      setSkillsList(profileSkillsToList(outcome.profile.skills))
      setTargetRole(outcome.profile.currentRole || targetRole)
      setExperience(outcome.profile.totalExperience || experience)
      setResumeReplaceStatus('updated')
    } catch (err) {
      setResumeReplaceStatus('idle')
      setResumeReplaceError(
        err instanceof Error ? err.message : 'Could not update your résumé.',
      )
    } finally {
      if (resumeFileInputRef.current) resumeFileInputRef.current.value = ''
    }
  }

  // Form state initialized from the candidate profile
  const profileExtras = profile as
    | (typeof profile & { currentCompanyTitle?: string; highestEducation?: string; contactPhone?: string; linkedin?: string; github?: string; portfolio?: string; jobTypes?: { fullTime: boolean; contract: boolean; internship: boolean } })
    | null

  // The name is read from the resume (shown read-only); see lib/candidateName.ts.
  const [fullName, setFullName] = useState(() => resolveCandidateName(profile, user))
  const [email] = useState(user?.email || '')
  const [phone, setPhone] = useState(user?.phone || profileExtras?.contactPhone || '')
  const [city, setCity] = useState(profile?.currentLocation || '')

  const [targetRole, setTargetRole] = useState(profile?.currentRole || '')
  const [experience, setExperience] = useState(profile?.totalExperience || '')
  const [companyTitle, setCompanyTitle] = useState(
    profileExtras?.currentCompanyTitle || '',
  )
  const [highestEducation, setHighestEducation] = useState(
    profileExtras?.highestEducation || '',
  )

  const [basicsEditing, setBasicsEditing] = useState(false)
  const [basicsSaving, setBasicsSaving] = useState(false)
  const [basicsDraftBackup, setBasicsDraftBackup] = useState({
    fullName: resolveCandidateName(profile, user),
    phone: user?.phone || profileExtras?.contactPhone || '',
    city: profile?.currentLocation || '',
  })

  const [roleEditing, setRoleEditing] = useState(false)
  const [roleSaving, setRoleSaving] = useState(false)
  const [roleDraftBackup, setRoleDraftBackup] = useState({
    targetRole: profile?.currentRole || '',
    experience: profile?.totalExperience || '',
    companyTitle: profileExtras?.currentCompanyTitle || '',
    highestEducation: profileExtras?.highestEducation || '',
  })

  const [newSkillInput, setNewSkillInput] = useState('')
  const [skillsList, setSkillsList] = useState<Array<{ name: string; level: 'Strong' | 'Good' | 'Basic' }>>(
    () => profileSkillsToList(profile?.skills),
  )
  const [skillsEditing, setSkillsEditing] = useState(false)
  const [skillsSaving, setSkillsSaving] = useState(false)
  const [skillsDraftBackup, setSkillsDraftBackup] = useState<
    Array<{ name: string; level: 'Strong' | 'Good' | 'Basic' }>
  >([])

  const [expectedCtc, setExpectedCtc] = useState(profile?.salaryExpectation || '')
  const [noticePeriod, setNoticePeriod] = useState(profile?.noticePeriod || '')
  const [prefLocations, setPrefLocations] = useState(
    profile?.preferredLocations && profile.preferredLocations.length > 0
      ? profile.preferredLocations.join(', ')
      : ''
  )

  const [workModes, setWorkModes] = useState({ remote: profile?.workMode?.includes('Remote') ?? false, hybrid: profile?.workMode?.includes('Hybrid') ?? false, onsite: profile?.workMode?.includes('On-site') ?? false })
  const [jobTypes, setJobTypes] = useState(profileExtras?.jobTypes ?? { fullTime: false, contract: false, internship: false })

  const [linkedin, setLinkedin] = useState(profileExtras?.linkedin || '')
  const [github, setGithub] = useState(profileExtras?.github || '')
  const [portfolio, setPortfolio] = useState(profileExtras?.portfolio || '')

  const [visibleToEmployers, setVisibleToEmployers] = useState(() => isVisibleToEmployers(profile))
  const [emailAlerts, setEmailAlerts] = useState(() => getAccountPrefs().emailMatchAlerts)
  const [exportingData, setExportingData] = useState(false)

  /** Puts the saved profile back into every form field (initial load and the bottom "Cancel"). */
  function applyProfileToForm(next: ReturnType<typeof getProfile>) {
    setVisibleToEmployers(isVisibleToEmployers(next))
    setEmailAlerts(getAccountPrefs().emailMatchAlerts)
    if (next) {
      const extras = next as typeof next & {
        currentCompanyTitle?: string
        highestEducation?: string
        contactPhone?: string
        linkedin?: string
        github?: string
        portfolio?: string
        jobTypes?: { fullTime: boolean; contract: boolean; internship: boolean }
      }
      setFullName(accountDisplayName(getUser()) || resolveCandidateName(next, getUser()))
      setPhone(getUser()?.phone || extras.contactPhone || '')
      setCity(next.currentLocation || '')
      setTargetRole(next.currentRole || '')
      setExperience(next.totalExperience || '')
      setCompanyTitle(extras.currentCompanyTitle || '')
      setHighestEducation(extras.highestEducation || '')
      setSkillsList(profileSkillsToList(next.skills))
      setExpectedCtc(next.salaryExpectation || '')
      setNoticePeriod(next.noticePeriod || '')
      setPrefLocations(
        next.preferredLocations?.length ? next.preferredLocations.join(', ') : '',
      )
      setWorkModes({
        remote: next.workMode?.includes('Remote') ?? false,
        hybrid: next.workMode?.includes('Hybrid') ?? false,
        onsite: next.workMode?.includes('On-site') ?? false,
      })
      setJobTypes(extras.jobTypes ?? { fullTime: false, contract: false, internship: false })
      setLinkedin(extras.linkedin || '')
      setGithub(extras.github || '')
      setPortfolio(extras.portfolio || '')
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setProfileLoading(true)
      await syncSessionFromApi()
      const remote = await pullProfileFromApi()
      if (cancelled) return
      const next = remote ?? getProfile()
      setLiveProfile(next)
      applyProfileToForm(next)
      setProfileLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email])

  const profileMissing = missingProfileFields(profile, user)
  const completionPct = profileCompletionPercent(profile, user)
  const profileUpdatedLabel = formatProfileDate(profile?.updatedAt)

  function handleAddSkill() {
    const trimmed = newSkillInput.trim()
    if (!trimmed || skillsSaving) return
    if (skillsList.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setToast('Skill already in your list')
      setTimeout(() => setToast(''), 2000)
      return
    }
    setSkillsList((prev) => prev.concat([{ name: trimmed, level: 'Good' }]))
    setNewSkillInput('')
    setToast(`Added skill "${trimmed}"`)
    setTimeout(() => setToast(''), 2000)
  }

  function handleRemoveSkill(name: string) {
    if (skillsSaving) return
    setSkillsList((prev) => prev.filter((s) => s.name !== name))
  }

  function startSkillsEdit() {
    setSkillsDraftBackup(skillsList)
    setSkillsEditing(true)
  }

  function cancelSkillsEdit() {
    setSkillsList(skillsDraftBackup)
    setSkillsEditing(false)
    setNewSkillInput('')
  }

  function currentSkillNames() {
    return skillsList
      .map((s) => s.name.trim())
      .filter(Boolean)
  }

  function buildMergedProfile(skillNames: string[]) {
    const trimmedName = resolveCandidateName(profile, user) || fullName.trim()
    return {
      ...(profile || {}),
      fullName: trimmedName,
      name: trimmedName,
      contactPhone: phone.trim(),
      whoAreYou: profile?.whoAreYou || '',
      whatDrivesYou: profile?.whatDrivesYou || '',
      keyStrengths: profile?.keyStrengths || '',
      currentRole: targetRole.trim(),
      totalExperience: experience,
      currentLocation: city.trim(),
      currentCompanyTitle: companyTitle.trim(),
      highestEducation: highestEducation.trim(),
      noticePeriod: noticePeriod,
      skills: skillNames,
      experienceSummary: profile?.experienceSummary || '',
      workExperiences: profile?.workExperiences || [],
      achievements: profile?.achievements || [],
      metrics: profile?.metrics || [],
      awards: profile?.awards || [],
      certifications: profile?.certifications || [],
      selfRating: profile?.selfRating || 4,
      preferredRoles: profile?.preferredRoles?.length ? profile.preferredRoles : [targetRole.trim()],
      preferredLocations: prefLocations
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      workMode: [workModes.remote && 'Remote', workModes.hybrid && 'Hybrid', workModes.onsite && 'On-site'].filter(Boolean).join(', '),
      linkedin: linkedin.trim(), github: github.trim(), portfolio: portfolio.trim(), jobTypes,
      salaryExpectation: expectedCtc,
      profileVisibility: profileVisibilityFor(visibleToEmployers),
      interviewNotes: profile?.interviewNotes || '',
      resumeFile: null,
      resumeText: profile?.resumeText || '',
      resumeName: profile?.resumeName ?? null,
      resumeUrl: profile?.resumeUrl ?? null,
      resumeStoragePath: profile?.resumeStoragePath ?? null,
    }
  }

  async function persistProfileToNeon(options: {
    setSaving: (value: boolean) => void
    skillNames: string[]
    successMessage: string
    errorMessage: string
    onSuccess: () => void
  }) {
    options.setSaving(true)
    try {
      const sessionOk = await ensureApiSession()
      if (!sessionOk) {
        throw new Error('Sign in again to save your profile.')
      }
      const mergedProfile = buildMergedProfile(options.skillNames)
      const saved = await apiSaveProfile({ ...mergedProfile, completedSteps: profile?.completedSteps ?? 5 })
      localStorage.setItem(profileKey(user?.email), JSON.stringify(saved.profile))
      setLiveProfile(saved.profile as ReturnType<typeof getProfile>)
      saveAccountPrefs({
        ...getAccountPrefs(),
        emailMatchAlerts: emailAlerts,
        profileVisibleToEmployers: visibleToEmployers,
      })
      options.onSuccess()
      setToast(options.successMessage)
      setTimeout(() => setToast(''), 3000)
    } catch (err) {
      setToast(err instanceof Error ? err.message : options.errorMessage)
      setTimeout(() => setToast(''), 4000)
    } finally {
      options.setSaving(false)
    }
  }

  function startBasicsEdit() {
    setBasicsDraftBackup({ fullName, phone, city })
    setBasicsEditing(true)
  }

  function cancelBasicsEdit() {
    setFullName(basicsDraftBackup.fullName)
    setPhone(basicsDraftBackup.phone)
    setCity(basicsDraftBackup.city)
    setBasicsEditing(false)
  }

  async function handleDoneBasicsEdit() {
    if (basicsSaving) return
    if (!fullName.trim() || !city.trim()) {
      setToast('Full name and city are required.')
      setTimeout(() => setToast(''), 2500)
      return
    }
    await persistProfileToNeon({
      setSaving: setBasicsSaving,
      skillNames: currentSkillNames(),
      successMessage: 'Basics updated successfully.',
      errorMessage: 'Could not update basics. Try again.',
      onSuccess: () => setBasicsEditing(false),
    })
  }

  function startRoleEdit() {
    setRoleDraftBackup({ targetRole, experience, companyTitle, highestEducation })
    setRoleEditing(true)
  }

  function cancelRoleEdit() {
    setTargetRole(roleDraftBackup.targetRole)
    setExperience(roleDraftBackup.experience)
    setCompanyTitle(roleDraftBackup.companyTitle)
    setHighestEducation(roleDraftBackup.highestEducation)
    setRoleEditing(false)
  }

  async function handleDoneRoleEdit() {
    if (roleSaving) return
    if (!targetRole.trim()) {
      setToast('Target role is required.')
      setTimeout(() => setToast(''), 2500)
      return
    }
    await persistProfileToNeon({
      setSaving: setRoleSaving,
      skillNames: currentSkillNames(),
      successMessage: 'Role and experience updated successfully.',
      errorMessage: 'Could not update role and experience. Try again.',
      onSuccess: () => setRoleEditing(false),
    })
  }

  async function handleDoneSkillsEdit() {
    if (skillsSaving) return
    const skillNames = currentSkillNames()
    if (!skillNames.length) {
      setToast('Add at least one skill before saving.')
      setTimeout(() => setToast(''), 2500)
      return
    }
    await persistProfileToNeon({
      setSaving: setSkillsSaving,
      skillNames,
      successMessage: 'Skills updated successfully.',
      errorMessage: 'Could not update skills. Try again.',
      onSuccess: () => {
        setSkillsList(skillNames.map((name) => ({ name, level: 'Good' as const })))
        setSkillsEditing(false)
        setNewSkillInput('')
      },
    })
  }

  async function handleSaveProfile() {
    if (basicsSaving) return
    await persistProfileToNeon({
      setSaving: setBasicsSaving,
      skillNames: currentSkillNames(),
      successMessage: 'Profile and preferences saved successfully.',
      errorMessage: 'Could not save your profile. Please try again.',
      onSuccess: () => {},
    })
  }
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <motion.div
          className={styles.main}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.header className={styles.head} variants={fadeUp}>
            <div>
              <h1>{fullName || 'Your profile'}</h1>
              <p>
                {profileLoading
                  ? 'Loading your saved profile…'
                  : profileUpdatedLabel
                    ? `Employers and job matches use this information. Last updated ${profileUpdatedLabel}.`
                    : 'Employers and job matches use this information from your account.'}
                {!profileLoading && completionPct < 100
                  ? ` ${completionPct}% complete. Finish only the sections marked below.`
                  : ''}
              </p>
            </div>
          </motion.header>

          {profileMissing.length > 0 && !profileLoading ? (
            <div className={`ds-alert ds-alert--info ${styles.pageAlert}`} role="status">
              <div>
                <p className={styles.alertTitle}>Still needed for better matches</p>
                <ul className={styles.missingList}>
                  {profileMissing.map((item) => (
                    <li key={item.label}>
                      <Link to={profileCheckHref(item)} className={styles.inlineLink}>
                        {item.label}
                      </Link>
                      {!item.required ? <span className={styles.optional}> (optional)</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {toast ? (
            <div className="ds-toast" role="status">
              {toast}
            </div>
          ) : null}

          <section className={styles.profileRegion} aria-labelledby="profile-details-heading">
            <h2 id="profile-details-heading" className="ds-sr-only">
              Profile details
            </h2>
            <div className={styles.profileSectionStack}>
              {/* Card 1: Basics */}
              <section id="basics" className={styles.card} aria-busy={basicsSaving}>
                <ProfileSectionHeader
                  title="Basics"
                  editing={basicsEditing}
                  saving={basicsSaving}
                  editLabel="Edit basics"
                  editTestId="basics-edit-btn"
                  doneTestId="basics-done-btn"
                  cancelTestId="basics-cancel-btn"
                  savingTestId="basics-saving-notice"
                  onEdit={startBasicsEdit}
                  onDone={handleDoneBasicsEdit}
                  onCancel={cancelBasicsEdit}
                />
                <div className={`${styles.formGrid} ${basicsSaving ? styles.formBusy : ''}`}>
                  <div className={styles.field}>
                    <label htmlFor="pf-full-name">Full name</label>
                    <input
                      id="pf-full-name"
                      type="text"
                      className={styles.input}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      readOnly
                      title="Your name is taken from your resume. Upload an updated resume to change it."
                      aria-readonly="true"
                      disabled={basicsSaving}
                      autoComplete="name"
                      data-testid="basics-full-name"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-email">Email</label>
                    <input
                      id="pf-email"
                      type="email"
                      className={styles.input}
                      value={email}
                      readOnly
                      tabIndex={-1}
                      data-testid="basics-email"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-phone">Phone</label>
                    <input
                      id="pf-phone"
                      type="tel"
                      className={styles.input}
                      value={basicsEditing ? phone : formatPhoneForDisplay(phone)}
                      onChange={(e) => setPhone(e.target.value)}
                      readOnly={!basicsEditing}
                      disabled={basicsSaving}
                      autoComplete="tel"
                      data-testid="basics-phone"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-current-city">Current city</label>
                    <input
                      id="pf-current-city"
                      type="text"
                      className={styles.input}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      readOnly={!basicsEditing}
                      disabled={basicsSaving}
                      data-testid="basics-city"
                    />
                  </div>
                </div>
              </section>

              {/* Card 2: Role and experience */}
              <section id="role" className={styles.card} aria-busy={roleSaving}>
                <ProfileSectionHeader
                  title="Role and experience"
                  editing={roleEditing}
                  saving={roleSaving}
                  editLabel="Edit role and experience"
                  editTestId="role-edit-btn"
                  doneTestId="role-done-btn"
                  cancelTestId="role-cancel-btn"
                  savingTestId="role-saving-notice"
                  onEdit={startRoleEdit}
                  onDone={handleDoneRoleEdit}
                  onCancel={cancelRoleEdit}
                />
                <div className={`${styles.formGrid} ${roleSaving ? styles.formBusy : ''}`}>
                  <div className={styles.field}>
                    <label htmlFor="pf-target-role">Target role</label>
                    <input
                      id="pf-target-role"
                      type="text"
                      className={styles.input}
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      readOnly={!roleEditing}
                      disabled={roleSaving}
                      data-testid="role-target"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-total-experience">Total experience</label>
                    <select
                      id="pf-total-experience"
                      className={styles.select}
                      value={experience}
                      onChange={(e) => setExperience(e.target.value)}
                      disabled={!roleEditing || roleSaving}
                      data-testid="role-experience"
                    >
                      {/* Same ranges the resume parser writes, so a parsed "5 – 8 Years" is shown (and saved) as is. */}
                      {experience && !(EXPERIENCE_RANGE_LABELS as readonly string[]).includes(experience) ? (
                        <option value={experience}>{experience}</option>
                      ) : null}
                      {!experience ? <option value="">Select a range</option> : null}
                      {EXPERIENCE_RANGE_LABELS.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-current-company-and-title">Current company and title</label>
                    <input
                      id="pf-current-company-and-title"
                      type="text"
                      className={styles.input}
                      value={companyTitle}
                      onChange={(e) => setCompanyTitle(e.target.value)}
                      readOnly={!roleEditing}
                      disabled={roleSaving}
                      data-testid="role-company-title"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-highest-education">Highest education</label>
                    <input
                      id="pf-highest-education"
                      type="text"
                      className={styles.input}
                      value={highestEducation}
                      onChange={(e) => setHighestEducation(e.target.value)}
                      readOnly={!roleEditing}
                      disabled={roleSaving}
                      data-testid="role-education"
                    />
                  </div>
                </div>
              </section>

              {/* Card 3: Skills */}
              <section id="skills" className={styles.card} aria-busy={skillsSaving}>
                <ProfileSectionHeader
                  title="Skills"
                  subtitle={`${skillsList.length} on file`}
                  editing={skillsEditing}
                  saving={skillsSaving}
                  editLabel="Edit skills"
                  editTestId="skills-edit-btn"
                  doneTestId="skills-done-btn"
                  cancelTestId="skills-cancel-btn"
                  savingTestId="skills-saving-notice"
                  onEdit={startSkillsEdit}
                  onDone={handleDoneSkillsEdit}
                  onCancel={cancelSkillsEdit}
                />

                <div className={`${styles.cardBody} ${skillsSaving ? styles.formBusy : ''}`}>
                  {!skillsList.length && !skillsEditing ? (
                    <p className={styles.muted}>
                      No skills saved yet. Edit skills to add what matches your target roles.
                    </p>
                  ) : null}
                  {skillsList.length ? (
                    <ul className={styles.tagList}>
                      {skillsList.map((skill) => (
                        <li
                          key={skill.name}
                          className={styles.tag}
                          data-testid={`skill-pill-${skill.name.replace(/\s+/g, '-')}`}
                        >
                          {skill.name}
                          <span className={styles.tagLevel}>{skill.level}</span>
                          {skillsEditing && !skillsSaving && (
                            <button
                              type="button"
                              className={styles.tagRemove}
                              aria-label={`Remove ${skill.name}`}
                              onClick={() => handleRemoveSkill(skill.name)}
                            >
                              <HrIcon name="close" size={14} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {skillsEditing && !skillsSaving && (
                    <div className={styles.field}>
                      <label htmlFor="pf-add-skill">Add a skill</label>
                      <div className={styles.inlineInputRow}>
                        <input
                          id="pf-add-skill"
                          type="text"
                          className={styles.input}
                          placeholder="For example: Docker"
                          value={newSkillInput}
                          onChange={(e) => setNewSkillInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleAddSkill()
                            }
                          }}
                          data-testid="skills-add-input"
                        />
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary"
                          onClick={handleAddSkill}
                          data-testid="skills-add-btn"
                        >
                          Add skill
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Card 4: Résumé */}
              <section id="resume" className={styles.card} aria-busy={resumeReplaceStatus === 'updating'}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionHeaderText}>
                    <h2 className={styles.cardTitle}>Résumé</h2>
                  </div>
                </div>
                <input
                  ref={resumeFileInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className={styles.hiddenInput}
                  aria-label="Choose a résumé file"
                  tabIndex={-1}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleResumeFilePicked(file)
                  }}
                />

                <div className={styles.cardBody}>
                  {profile?.resumeName ? (
                    <div className={styles.resumeRow}>
                      <div className={styles.resumeFile}>
                        <span className={styles.fileBadge} aria-hidden="true">
                          <HrIcon name="document" size={16} />
                        </span>
                        <div className={styles.resumeFileDetails}>
                          <span className={styles.resumeFileName}>{profile.resumeName}</span>
                          <span className={styles.resumeFileMeta}>
                            {resumeReplaceStatus === 'updating'
                              ? 'Updating résumé…'
                              : resumeReplaceStatus === 'updated'
                                ? 'Updated résumé'
                                : profileUpdatedLabel
                                  ? `Updated ${profileUpdatedLabel}`
                                  : 'On file in your account'}
                            {resumeReplaceStatus === 'idle' && profile.resumeText
                              ? ' · Text extracted for interviews'
                              : ''}
                          </span>
                        </div>
                      </div>
                      <div className={styles.resumeActions}>
                        {profile.resumeUrl ? (
                          <a
                            href={profile.resumeUrl}
                            className="ds-btn ds-btn--ghost ds-btn--sm"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="ds-btn ds-btn--secondary ds-btn--sm"
                          disabled={resumeReplaceStatus === 'updating'}
                          aria-busy={resumeReplaceStatus === 'updating'}
                          onClick={() => {
                            // The server deletes the interview score, report and recordings when the résumé changes.
                            if (
                              interview &&
                              !window.confirm(
                                'Replacing your résumé resets your AI interview score and report. You will need to take the interview again. Continue?',
                              )
                            ) {
                              return
                            }
                            resumeFileInputRef.current?.click()
                          }}
                        >
                          {resumeReplaceStatus === 'updating' ? 'Updating…' : 'Replace'}
                        </button>
                      </div>
                      {resumeReplaceError ? (
                        <p className={styles.fieldError} role="alert">
                          {resumeReplaceError}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="ds-empty ds-empty--plain">
                      <span className="ds-empty__icon" aria-hidden="true">
                        <HrIcon name="upload" size={20} />
                      </span>
                      <p className="ds-empty__title">No résumé on file yet</p>
                      <p className="ds-empty__body">
                        Upload one so employers and AI interviews can use your background.
                      </p>
                      <div className="ds-empty__actions">
                        <Link to="/onboarding" className="ds-btn ds-btn--secondary">
                          Upload résumé
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Card 5: Job preferences */}
              <section id="preferences" className={styles.card}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionHeaderText}>
                    <h2 className={styles.cardTitle}>Job preferences</h2>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.field}>
                    <label htmlFor="pf-expected-ctc-lpa">Expected CTC (LPA)</label>
                    <input
                      id="pf-expected-ctc-lpa"
                      type="text"
                      inputMode="decimal"
                      className={styles.input}
                      value={expectedCtc}
                      onChange={(e) => setExpectedCtc(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-notice-period">Notice period</label>
                    <select
                      id="pf-notice-period"
                      className={styles.select}
                      value={noticePeriod}
                      onChange={(e) => setNoticePeriod(e.target.value)}
                    >
                      <option value="Immediate">Immediate</option>
                      <option value="15 days">15 days</option>
                      <option value="30 days">30 days</option>
                      <option value="60 days">60 days</option>
                      <option value="90 days">90 days</option>
                    </select>
                  </div>
                  <div className={`${styles.field} ${styles.fieldWide}`}>
                    <label htmlFor="pf-preferred-locations">Preferred locations</label>
                    <input
                      id="pf-preferred-locations"
                      type="text"
                      className={styles.input}
                      value={prefLocations}
                      onChange={(e) => setPrefLocations(e.target.value)}
                      aria-describedby="pf-preferred-locations-help"
                    />
                    <p id="pf-preferred-locations-help" className={styles.helpText}>
                      Separate cities with commas.
                    </p>
                  </div>
                </div>

                <div className={styles.fieldsetRow}>
                  <fieldset className={styles.fieldset}>
                    <legend>Work mode</legend>
                    <div className={styles.checkGroup}>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={workModes.remote}
                          onChange={(e) => setWorkModes((prev) => ({ ...prev, remote: e.target.checked }))}
                        />
                        <span>Remote</span>
                      </label>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={workModes.hybrid}
                          onChange={(e) => setWorkModes((prev) => ({ ...prev, hybrid: e.target.checked }))}
                        />
                        <span>Hybrid</span>
                      </label>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={workModes.onsite}
                          onChange={(e) => setWorkModes((prev) => ({ ...prev, onsite: e.target.checked }))}
                        />
                        <span>On-site</span>
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className={styles.fieldset}>
                    <legend>Job type</legend>
                    <div className={styles.checkGroup}>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={jobTypes.fullTime}
                          onChange={(e) => setJobTypes((prev) => ({ ...prev, fullTime: e.target.checked }))}
                        />
                        <span>Full-time</span>
                      </label>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={jobTypes.contract}
                          onChange={(e) => setJobTypes((prev) => ({ ...prev, contract: e.target.checked }))}
                        />
                        <span>Contract</span>
                      </label>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={jobTypes.internship}
                          onChange={(e) => setJobTypes((prev) => ({ ...prev, internship: e.target.checked }))}
                        />
                        <span>Internship</span>
                      </label>
                    </div>
                  </fieldset>
                </div>
              </section>

              {/* Card 6: Links */}
              <section id="links" className={styles.card}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionHeaderText}>
                    <h2 className={styles.cardTitle}>Links</h2>
                  </div>
                </div>
                <div className={styles.formGrid}>
                  <div className={styles.field}>
                    <label htmlFor="pf-linkedin">LinkedIn</label>
                    <input
                      id="pf-linkedin"
                      type="text"
                      inputMode="url"
                      className={styles.input}
                      value={linkedin}
                      onChange={(e) => setLinkedin(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-github">GitHub</label>
                    <input
                      id="pf-github"
                      type="text"
                      inputMode="url"
                      className={styles.input}
                      value={github}
                      onChange={(e) => setGithub(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pf-portfolio">Portfolio</label>
                    <input
                      id="pf-portfolio"
                      type="text"
                      inputMode="url"
                      className={styles.input}
                      value={portfolio}
                      onChange={(e) => setPortfolio(e.target.value)}
                    />
                  </div>
                </div>
              </section>

              {/* Card 7: Privacy and consent */}
              <section id="privacy" className={styles.card}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionHeaderText}>
                    <h2 className={styles.cardTitle}>Privacy and consent</h2>
                  </div>
                </div>

                <div className={styles.cardBody}>
                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={visibleToEmployers}
                      onChange={(e) => setVisibleToEmployers(e.target.checked)}
                    />
                    <span className={styles.checkText}>
                      <span className={styles.checkTitle}>Visible to employers</span>
                      <span className={styles.checkHelp}>
                        Employers can find your profile and score in search.
                      </span>
                    </span>
                  </label>

                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={emailAlerts}
                      onChange={(e) => setEmailAlerts(e.target.checked)}
                    />
                    <span className={styles.checkText}>
                      <span className={styles.checkTitle}>Email me about new matches and updates</span>
                      <span className={styles.checkHelp}>At most one email a day.</span>
                    </span>
                  </label>

                  <div className={styles.dangerBtnRow}>
                    <button
                      type="button"
                      className="ds-btn ds-btn--secondary"
                      disabled={exportingData}
                      aria-busy={exportingData || undefined}
                      onClick={() => {
                        if (exportingData) return
                        setExportingData(true)
                        void downloadMyData()
                          .then(() => setToast('Your data was downloaded as a JSON file.'))
                          .catch((err: unknown) =>
                            setToast(err instanceof Error ? err.message : 'Could not export your data. Try again.'),
                          )
                          .finally(() => {
                            setExportingData(false)
                            setTimeout(() => setToast(''), 3000)
                          })
                      }}
                    >
                      {exportingData ? 'Preparing…' : 'Download my data'}
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn--danger-ghost"
                      onClick={() => {
                        if (
                          window.confirm(
                            'Account deletion is handled by our support team. Open the contact form with a deletion request?',
                          )
                        ) {
                          navigate(accountDeletionRequestPath(user?.email))
                        }
                      }}
                    >
                      Delete my account
                    </button>
                  </div>
                </div>
              </section>

              {/* Bottom actions */}
              <div className={styles.profileBottomBar}>
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => {
                    applyProfileToForm(profile)
                    setBasicsEditing(false)
                    setRoleEditing(false)
                    if (skillsEditing) cancelSkillsEdit()
                    setToast('Unsaved changes discarded.')
                    setTimeout(() => setToast(''), 2000)
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn--primary"
                  onClick={() => void handleSaveProfile()}
                  disabled={basicsSaving}
                  aria-busy={basicsSaving}
                >
                  Save changes
                </button>
              </div>
            </div>
          </section>

          {/* Career report, shown once an interview is taken */}
          {interview && (
            <section className={styles.reportRegion} aria-labelledby="profile-report-heading">
              <header className={styles.reportRegionHead}>
                <div>
                  <h2 id="profile-report-heading" className={styles.sectionTitle}>
                    Your interview report
                  </h2>
                  <p className={styles.sectionSub}>
                    Your latest AI interview results, with the full question-by-question breakdown. Employers
                    see this report when you apply.
                  </p>
                </div>
              </header>
              <CareerIntelligenceDashboard
                embedded
                result={interview}
                candidateName={fullName || 'Candidate'}
                candidateRole={profile?.currentRole ?? interview.role}
                candidateExperience={profile?.totalExperience ?? interview.level}
                skills={profile?.skills ?? []}
                interviewSessionId={
                  interview.sessionId ||
                  (typeof sessionStorage !== 'undefined'
                    ? sessionStorage.getItem('hireright.lastInterviewSessionId')
                    : null)
                }
                onRetake={() => {
                  window.location.href = '/interview'
                }}
              />
            </section>
          )}
        </motion.div>
      </div>
    </div>
  )
}

export function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([])
  const [appsLoading, setAppsLoading] = useState(true)
  const [appsError, setAppsError] = useState('')
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null)
  const interview = getInterviewResult()

  useEffect(() => {
    markNotificationsReadWhere((n) => n.kind === 'application' || n.kind === 'status' || n.href === '/applications')
    let cancelled = false
    void (async () => {
      setAppsLoading(true)
      setAppsError('')
      try {
        const sessionOk = await ensureApiSession()
        if (!sessionOk) {
          if (!cancelled) {
            setApps(getApplications())
            setAppsError('Sign in to load applications from your account.')
          }
          return
        }
        const remote = await apiListApplications()
        if (!cancelled) {
          setApps(remote)
          saveApplications(remote)
        }
      } catch (err) {
        if (!cancelled) {
          setApps(getApplications())
          setAppsError(err instanceof Error ? err.message : 'Could not load applications.')
        }
      } finally {
        if (!cancelled) setAppsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleWithdraw(id: string) {
    const target = apps.find((a) => a.id === id)
    const label = target ? `${target.title} at ${target.company}` : 'this application'
    if (!window.confirm(`Withdraw ${label}? You can apply again later if the role is still open.`)) return
    setWithdrawingId(id)
    try {
      await ensureApiSession()
      const next = await apiWithdrawApplication(id)
      setApps(next)
      saveApplications(next)
    } catch {
      const next = getApplications().filter((a) => a.id !== id)
      saveApplications(next)
      setApps(next)
    } finally {
      setWithdrawingId(null)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <motion.div
          className={styles.main}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.header className={styles.head} variants={fadeUp}>
            <div>
              <h1>My applications</h1>
              <p>Track every role you applied to. Status updates from employers show up here automatically.</p>
            </div>
            <Link to="/jobs" className="ds-btn ds-btn--secondary">
              Find more roles
            </Link>
          </motion.header>

          {appsError ? (
            <div className={`ds-alert ds-alert--error ${styles.pageAlert}`} role="alert">
              {appsError}
            </div>
          ) : null}

          {appsLoading ? (
            <div className={styles.listCard} aria-busy="true">
              <p className="ds-sr-only" role="status">
                Loading your applications…
              </p>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={`sk-${i}`} className={styles.appRow} aria-hidden="true">
                  <div className={styles.appRowMain}>
                    <span className={`ds-skeleton ds-skeleton-line ${styles.skeletonMid}`} />
                    <span className={`ds-skeleton ds-skeleton-line ${styles.skeletonShort}`} />
                  </div>
                </div>
              ))}
            </div>
          ) : apps.length === 0 ? (
            <motion.div className="ds-empty" variants={fadeUp}>
              <span className="ds-empty__icon" aria-hidden="true">
                <HrIcon name="briefcase" size={20} />
              </span>
              <p className="ds-empty__title">No applications yet</p>
              <p className="ds-empty__body">
                {interview
                  ? 'Browse ranked matches and apply with your AI score.'
                  : 'Complete your AI interview first, then apply to unlocked roles.'}
              </p>
              <div className="ds-empty__actions">
                <Link to={interview ? '/jobs' : '/interview'} className="ds-btn ds-btn--primary">
                  {interview ? 'Browse jobs' : 'Start interview'}
                </Link>
              </div>
            </motion.div>
          ) : (
            <motion.ul className={styles.listCard} variants={fadeUp} aria-label="Your applications">
              {apps.map((app) => {
                const jobRemoved = app.jobStatus === 'deleted'
                const status = jobRemoved
                  ? { label: 'Job removed', tone: 'neutral' }
                  : app.status === 'Offer'
                    ? { label: 'Offer', tone: 'success' }
                    : app.status === 'Interview'
                      ? { label: 'Interview', tone: 'brand' }
                      : app.status === 'In Review'
                        ? { label: 'In review', tone: 'warning' }
                        : { label: app.status, tone: 'neutral' }
                return (
                  <li key={app.id} className={styles.appRow}>
                    <div className={styles.appRowMain}>
                      <h2 className={styles.appRowTitle}>{app.title}</h2>
                      <p className={styles.appRowSub}>
                        {app.company} · {app.location}
                        {app.roleTrack ? ` · ${app.roleTrack}` : ''}
                        {app.experienceLevel ? ` · ${app.experienceLevel}` : ''}
                      </p>
                      {jobRemoved ? (
                        <p className={styles.appRowNote} role="status">
                          {app.jobDeletedMessage ||
                            'This job was removed by the employer. You can withdraw this application.'}
                        </p>
                      ) : null}
                    </div>
                    <span className={`ds-pill ds-pill--dot ds-pill--${status.tone} ${styles.appStatus}`}>
                      {status.label}
                    </span>
                    <span className={styles.appDate}>
                      <span className={styles.appCellLabel}>Applied </span>
                      {formatProfileDate(app.appliedAt) ?? '—'}
                    </span>
                    <span className={styles.appScore}>
                      {app.interviewScore != null ? (
                        <>
                          <strong>{app.interviewScore}</strong>
                          <span className={styles.appScoreUnit}>/100</span>
                          <span className={styles.appScoreLabel}>interview</span>
                        </>
                      ) : (
                        <>
                          <strong>{app.match}%</strong>
                          <span className={styles.appScoreLabel}>match</span>
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      className={`ds-btn ds-btn--secondary ds-btn--sm ${styles.appAction}`}
                      disabled={withdrawingId === app.id}
                      aria-busy={withdrawingId === app.id}
                      aria-label={`Withdraw application for ${app.title} at ${app.company}`}
                      onClick={() => void handleWithdraw(app.id)}
                    >
                      {withdrawingId === app.id ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  </li>
                )
              })}
            </motion.ul>
          )}
        </motion.div>
      </div>
    </div>
  )
}
