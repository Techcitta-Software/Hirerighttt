import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { VideoProctorTimeline } from '../components/VideoProctorTimeline'
import { getUser, type EmployerApplicant, type EmployerJob } from '../lib/store'
import { HrIcon } from '../components/HrIcon'
import { SearchCandidatesPanel, type CandidateSearchQuery } from '../components/SearchCandidatesPanel'
import { apiHealth } from '../lib/api'
import { ensureApiSession } from '../lib/apiSession'
import { buildApplyUrl } from '../lib/jobLink'
import {
  filterJobSeekerCandidates,
  hasHireRightReport,
  hasResumeContent,
  mapApplicantStatusToApi,
  mapOrgCandidate,
  resumeDisplayLabel,
  vendorJobToEmployerJob,
} from '../lib/employerCandidateUtils'
import {
  EmployerCandidateDocumentModal,
  type EmployerDocumentKind,
} from '../components/EmployerCandidateDocumentModal'
import {
  createVendorJob,
  deleteVendorJob,
  markVendorJobDeletedForCandidates,
  fetchJobApplicants,
  fetchOrganizationCandidates,
  fetchVendorJobs,
  type VendorApplicant,
  patchApplicantStatus,
  sendApplicantInterviewInvite,
} from '../lib/vendorApi'
import styles from './EmployerDashboard.module.css'

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function slugifyCompanyName(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'company'
}

function isOptimisticJobId(id: string) {
  return id.startsWith('optimistic-')
}

function normalizeApplicant(row: EmployerApplicant): EmployerApplicant {
  return {
    ...row,
    candidateName: row.candidateName?.trim() || row.candidateEmail || 'Candidate',
    candidateEmail: row.candidateEmail?.trim() || '',
    candidatePhone: row.candidatePhone?.trim() || '',
    company: row.company?.trim() || '',
    jobTitle: row.jobTitle?.trim() || '',
    experienceYears: row.experienceYears?.trim() || '',
    status: row.status || 'New',
  }
}

interface EmployerDashboardProps {
  view?: 'dashboard' | 'candidates'
}

export function EmployerDashboard({ view }: EmployerDashboardProps = {}) {
  const location = useLocation()
  const isCandidatesView =
    view === 'candidates' ||
    location.pathname === '/employer/candidates' ||
    location.pathname === '/candidates'

  useEffect(() => {
    if (location.hash === '#candidates' || location.hash === '#candidate-list') {
      const el = document.getElementById('candidates-section')
      el?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [location])

  const user = getUser()
  const [jobs, setJobs] = useState<EmployerJob[]>([])
  const [applicants, setApplicants] = useState<EmployerApplicant[]>([])
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({})
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedJobTitle, setSelectedJobTitle] = useState('')
  const [portalLoading, setPortalLoading] = useState(true)
  const [portalError, setPortalError] = useState('')

  // Filters State
  const [searchFilter, setSearchFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [jobFilter, setJobFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')
  const [scoreFilter, setScoreFilter] = useState('')
  const [integrityFilter, setIntegrityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Modals
  const [showCreateJobModal, setShowCreateJobModal] = useState(false)
  const [selectedApplicant, setSelectedApplicant] = useState<EmployerApplicant | null>(null)
  const [documentViewer, setDocumentViewer] = useState<{
    kind: EmployerDocumentKind
    applicant: EmployerApplicant
  } | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
  // New Job Form State
  const [newJobTitle, setNewJobTitle] = useState('')
  const [newJobRoleTrack, setNewJobRoleTrack] = useState('Frontend Developer')
  const [newJobExp, setNewJobExp] = useState('3-5 years')
  const [newJobLocation, setNewJobLocation] = useState('Hyderabad / Remote')
  const [newJobDescription, setNewJobDescription] = useState('')
  const [newJobSkills, setNewJobSkills] = useState('React, TypeScript, Node.js')
  const [jobFormError, setJobFormError] = useState('')
  const [portalSyncNote, setPortalSyncNote] = useState('')

  const [jobRosterOpen, setJobRosterOpen] = useState<{ jobId: string; title: string } | null>(
    null,
  )
  const [jobRosterLoading, setJobRosterLoading] = useState(false)
  const [jobRosterError, setJobRosterError] = useState('')
  const [jobRosterRows, setJobRosterRows] = useState<VendorApplicant[]>([])

  const [inviteStart, setInviteStart] = useState('')
  const [inviteDuration, setInviteDuration] = useState(60)
  const [inviteFeedback, setInviteFeedback] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)

  // Advanced Search Candidates Query (Image 2)
  const [candidateSearchQuery, setCandidateSearchQuery] = useState<CandidateSearchQuery | null>(null)

  /** Ignore in-flight job list fetches after optimistic create/delete. */
  const jobsLoadSeqRef = useRef(0)

  function bumpJobsLoadGeneration() {
    jobsLoadSeqRef.current += 1
  }

  async function refreshJobCountsForJobs(mapped: EmployerJob[], loadSeq: number) {
    const counts: Record<string, number> = {}
    for (const job of mapped) {
      if (loadSeq !== jobsLoadSeqRef.current) return
      if (isOptimisticJobId(job.id)) {
        counts[job.id] = 0
        continue
      }
      try {
        const { total, applicants } = await fetchJobApplicants(job.id)
        counts[job.id] = total ?? applicants.length
      } catch {
        counts[job.id] = 0
      }
    }
    if (loadSeq !== jobsLoadSeqRef.current) return
    setJobCounts((prev) => ({ ...prev, ...counts }))
  }

  async function loadJobsFromApi() {
    if (!user || user.role !== 'employer') return
    const loadSeq = ++jobsLoadSeqRef.current
    const online = await apiHealth()
    if (loadSeq !== jobsLoadSeqRef.current) return
    if (!online) {
      setPortalError('API is offline. Start the backend (npm run dev:all) to load jobs from the database.')
      setJobs([])
      return
    }
    const sessionOk = await ensureApiSession()
    if (loadSeq !== jobsLoadSeqRef.current) return
    if (!sessionOk) {
      setPortalError('Could not authenticate with the API. Sign in again as an employer.')
      setJobs([])
      return
    }
    const { jobs: remoteJobs } = await fetchVendorJobs()
    if (loadSeq !== jobsLoadSeqRef.current) return
    const mapped = remoteJobs.map((j) => vendorJobToEmployerJob(j, user.email))
    setJobs(mapped)
    void refreshJobCountsForJobs(mapped, loadSeq)
  }

  async function loadOrgCandidatesFromApi(filters?: {
    name?: string
    job?: string
    keywords?: string
  }) {
    const { candidates } = await fetchOrganizationCandidates(filters)
    const jobSeekers = filterJobSeekerCandidates(candidates)
    setApplicants(jobSeekers.map((c) => normalizeApplicant(mapOrgCandidate(c))))
    setPortalSyncNote(`${jobSeekers.length} job seeker profile(s) loaded from the database.`)
    setPortalError('')
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!user || user.role !== 'employer') return
      setPortalLoading(true)
      setPortalError('')
      try {
        await loadJobsFromApi()
        if (cancelled) return
        if (isCandidatesView) {
          await loadOrgCandidatesFromApi()
        }
      } catch (err) {
        if (!cancelled) {
          setPortalError(err instanceof Error ? err.message : 'Could not load employer data from the API.')
          setJobs([])
          setApplicants([])
        }
      } finally {
        if (!cancelled) setPortalLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.role, isCandidatesView])

  const showCandidateTable = isCandidatesView

  function handleClearFilters() {
    setSearchFilter('')
    setRoleFilter('')
    setJobFilter('')
    setExpFilter('')
    setScoreFilter('')
    setIntegrityFilter('')
    setStatusFilter('')
    if (candidateSearchQuery) {
      setCandidateSearchQuery(null)
    }
  }

  const hasActiveFilters = Boolean(
    searchFilter || roleFilter || jobFilter || expFilter || scoreFilter || integrityFilter || statusFilter
  )

  const activeFilterCount = [
    searchFilter,
    roleFilter,
    jobFilter,
    expFilter,
    scoreFilter,
    integrityFilter,
    statusFilter,
  ].filter(Boolean).length

  function handleSearchCandidatesClick() {
    const el = document.getElementById('candidates-section')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const filteredApplicants = useMemo(() => {
    return applicants.filter((app) => {
      // Image 2 Search Candidates Panel filters
      if (candidateSearchQuery) {
        if (candidateSearchQuery.candidateName?.trim()) {
          const q = candidateSearchQuery.candidateName.trim().toLowerCase()
          const match =
            app.candidateName.toLowerCase().includes(q) ||
            app.candidateEmail.toLowerCase().includes(q)
          if (!match) return false
        }

        if (candidateSearchQuery.client?.trim()) {
          const q = candidateSearchQuery.client.trim().toLowerCase()
          const targetStr = [app.company, app.jobTitle, app.role, ...(app.primarySkills || [])].filter(Boolean).join(' ').toLowerCase()
          if (!targetStr.includes(q)) return false
        }

        const activeKeywords = candidateSearchQuery.keywords.filter((k) =>
          candidateSearchQuery.allMandatory ? true : k.isMandatory,
        )
        if (activeKeywords.length > 0) {
          const appText = `${app.role || ''} ${app.jobTitle} ${app.resumeName || ''}`.toLowerCase()
          const hasKeyword = activeKeywords.some((k) =>
            appText.includes(k.text.toLowerCase()),
          )
          if (!hasKeyword) return false
        }
      }

      // Search: name, email, or phone
      if (searchFilter.trim()) {
        const q = searchFilter.trim().toLowerCase()
        const matchesName = app.candidateName.toLowerCase().includes(q)
        const matchesEmail = app.candidateEmail.toLowerCase().includes(q)
        const matchesPhone = String(app.candidatePhone ?? '').toLowerCase().includes(q)
        if (!matchesName && !matchesEmail && !matchesPhone) return false
      }

      // Role text search
      if (roleFilter.trim()) {
        const q = roleFilter.trim().toLowerCase()
        if (!app.role?.toLowerCase().includes(q)) return false
      }

      // Target Job text search
      if (jobFilter.trim()) {
        const q = jobFilter.trim().toLowerCase()
        const matchesJob = app.jobTitle.toLowerCase().includes(q)
        const matchesCompany = app.company.toLowerCase().includes(q)
        if (!matchesJob && !matchesCompany) return false
      }

      // Experience text search
      if (expFilter.trim()) {
        const q = expFilter.trim().toLowerCase()
        if (!String(app.experienceYears ?? '').toLowerCase().includes(q)) return false
      }

      // Score text search
      if (scoreFilter.trim()) {
        const q = scoreFilter.trim().toLowerCase()
        const score = String(app.aiScore ?? app.interviewResult?.overall ?? '')
        if (!score.includes(q) && !`${score}%`.includes(q)) return false
      }

      // Integrity text search
      if (integrityFilter.trim()) {
        const q = integrityFilter.trim().toLowerCase()
        const integ = app.integrityStatus ?? (app.interviewResult?.integrity?.faceViolations ? 'pending' : 'verified')
        const label = integ === 'verified' ? 'verified candidate' : integ === 'pending' ? 'verification pending' : 'not verified'
        if (!label.includes(q) && !integ.includes(q)) return false
      }

      // Status text search
      if (statusFilter.trim()) {
        const q = statusFilter.trim().toLowerCase()
        if (!app.status.toLowerCase().includes(q)) return false
      }

      return true
    })
  }, [applicants, candidateSearchQuery, searchFilter, roleFilter, jobFilter, expFilter, scoreFilter, integrityFilter, statusFilter])

  async function handleStatusChange(id: string, newStatus: EmployerApplicant['status']) {
    setApplicants((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a)),
    )
    try {
      await ensureApiSession()
      if (await apiHealth()) {
        await patchApplicantStatus(id, mapApplicantStatusToApi(newStatus))
      }
    } catch {
      setPortalError('Status saved locally only — could not sync to the database.')
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault()
    const jd = newJobDescription.trim()
    const title = newJobTitle.trim()
    if (!title || jd.length < 30) {
      setJobFormError('Job title and description (min 30 characters) are required.')
      return
    }
    setJobFormError('')
    const requiredSkills = newJobSkills
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const company = user?.companyName || 'TechCitta Solutions'
    const createdByEmail = user?.email || 'employer@hireright.com'
    const location = newJobLocation.trim()
    const roleTrack = newJobRoleTrack
    const experienceLevel = newJobExp

    const optimisticId = `optimistic-${Date.now()}`
    const optimisticJob: EmployerJob = {
      id: optimisticId,
      title,
      company,
      companySlug: slugifyCompanyName(company),
      roleTrack,
      experienceLevel,
      location,
      jobDescription: jd,
      requiredSkills,
      createdByEmail,
      createdAt: new Date().toISOString(),
      shareableCode: 'pending',
    }

    bumpJobsLoadGeneration()
    setJobs((prev) => [optimisticJob, ...prev])
    setJobCounts((prev) => ({ ...prev, [optimisticId]: 0 }))
    setShowCreateJobModal(false)
    setNewJobTitle('')
    setNewJobDescription('')
    setNewJobSkills('React, TypeScript, Node.js')
    setPortalError('')
    setPortalSyncNote(`Creating “${title}”…`)

    try {
      await ensureApiSession()
      if (!(await apiHealth())) {
        throw new Error('API is offline. Start the backend to create jobs in the database.')
      }
      const { job } = await createVendorJob({
        title,
        jobDescription: jd,
        roleTrack,
        experienceLevel,
        location,
        requiredSkills,
        company,
      })
      const created = vendorJobToEmployerJob(job, createdByEmail)
      setJobs((prev) => prev.map((j) => (j.id === optimisticId ? created : j)))
      setJobCounts((prev) => {
        const next = { ...prev }
        delete next[optimisticId]
        next[created.id] = next[created.id] ?? 0
        return next
      })
      setPortalSyncNote(`Job “${created.title}” saved to the database. Share the link to collect applicants.`)
    } catch (err) {
      setJobs((prev) => prev.filter((j) => j.id !== optimisticId))
      setJobCounts((prev) => {
        const next = { ...prev }
        delete next[optimisticId]
        return next
      })
      setShowCreateJobModal(true)
      setNewJobTitle(title)
      setNewJobDescription(jd)
      setNewJobRoleTrack(roleTrack)
      setNewJobExp(experienceLevel)
      setNewJobLocation(location)
      setNewJobSkills(requiredSkills.join(', '))
      setJobFormError(err instanceof Error ? err.message : 'Could not create job in the database.')
      setPortalSyncNote('')
    }
  }

  async function handleDeleteJob(job: EmployerJob) {
    if (isOptimisticJobId(job.id) || deletingJobId) return
    const ok = window.confirm(
      `Delete “${job.title}”?\n\nThis removes the job posting from your dashboard and the database. Application links for this opening will stop working.`,
    )
    if (!ok) return

    setDeletingJobId(job.id)
    setPortalError('')
    setPortalSyncNote('')

    try {
      await ensureApiSession()
      if (!(await apiHealth())) {
        throw new Error('API is offline. Start the backend to delete jobs from the database.')
      }
      await markVendorJobDeletedForCandidates(job.id)
      await deleteVendorJob(job.id)

      bumpJobsLoadGeneration()
      setJobs((prev) => prev.filter((j) => j.id !== job.id))
      setJobCounts((prev) => {
        const next = { ...prev }
        delete next[job.id]
        return next
      })
      if (selectedJobId === job.id) {
        setSelectedJobId(null)
        setSelectedJobTitle('')
        setApplicants([])
      } else {
        setApplicants((prev) => prev.filter((a) => a.jobId !== job.id))
      }
      setPortalSyncNote(`Job “${job.title}” was deleted.`)
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Could not delete job.')
    } finally {
      setDeletingJobId(null)
    }
  }

  function applicantDisplayScore(app: VendorApplicant): string {
    const data = app.data || {}
    const fromInterview =
      typeof data.interviewScore === 'number'
        ? data.interviewScore
        : typeof (data.interviewResult as { overall?: number } | undefined)?.overall === 'number'
          ? (data.interviewResult as { overall: number }).overall
          : null
    if (fromInterview != null) return `${fromInterview}%`
    if (typeof data.atsScore === 'number') return `${data.atsScore}% ATS`
    return '—'
  }

  async function openJobApplicantsRoster(job: EmployerJob) {
    if (isOptimisticJobId(job.id)) return
    setJobRosterOpen({ jobId: job.id, title: job.title })
    setJobRosterLoading(true)
    setJobRosterError('')
    setJobRosterRows([])
    try {
      await ensureApiSession()
      const { applicants, total } = await fetchJobApplicants(job.id)
      setJobRosterRows(applicants)
      setJobCounts((prev) => ({ ...prev, [job.id]: total ?? applicants.length }))
    } catch (err) {
      setJobRosterError(err instanceof Error ? err.message : 'Could not load applicants.')
    } finally {
      setJobRosterLoading(false)
    }
  }

  function closeJobApplicantsRoster() {
    setJobRosterOpen(null)
    setJobRosterRows([])
    setJobRosterError('')
  }

  async function handleCopyLink(job: EmployerJob) {
    const url = buildApplyUrl(job.company, job.shareableCode)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.prompt('Copy this application link', url)
    }
    setCopiedCode(job.shareableCode)
    window.setTimeout(() => setCopiedCode(null), 2500)
  }

  async function handleSendInterviewInvite() {
    if (!selectedApplicant || !inviteStart.trim()) {
      setInviteFeedback('Choose a scheduled start date and time.')
      return
    }
    setInviteLoading(true)
    setInviteFeedback('')
    try {
      await ensureApiSession()
      const { invite } = await sendApplicantInterviewInvite(selectedApplicant.id, {
        scheduledStart: new Date(inviteStart).toISOString(),
        durationMinutes: inviteDuration,
      })
      if (invite.emailSent) {
        setInviteFeedback('Interview invite email sent to the candidate.')
      } else if (invite.emailError) {
        setInviteFeedback(
          `Email failed: ${invite.emailError} Invite link: ${invite.inviteUrl}`,
        )
      } else if (invite.smtpConfigured) {
        setInviteFeedback(`Invite created. Share link: ${invite.inviteUrl}`)
      } else {
        setInviteFeedback(`Invite link: ${invite.inviteUrl} (SMTP not configured on server).`)
      }
    } catch (err) {
      setInviteFeedback(err instanceof Error ? err.message : 'Could not send invite.')
    } finally {
      setInviteLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <SiteNav />

      <div className={styles.shell}>
        {portalLoading && (
          <p className={styles.portalSyncNote} role="status">
            Loading from database…
          </p>
        )}
        {portalError ? (
          <p className={styles.portalSyncNote} role="alert">
            {portalError}
          </p>
        ) : null}
        {isCandidatesView && (
          <>
            <motion.div className={styles.heroCard} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className={styles.heroTitle}>Search HireRight candidates</h1>
              <p className={styles.heroDesc}>
                Everyone here comes from your database — applicants, shared interviews, and job seekers
                who completed an AI interview on HireRight.
              </p>
            </motion.div>

            <SearchCandidatesPanel
              embedded
              initialQuery={candidateSearchQuery}
              onSearch={(query) => {
                setCandidateSearchQuery(query)
                if (query.candidateName?.trim()) {
                  setSearchFilter(query.candidateName.trim())
                }
              }}
              onClear={() => {
                setCandidateSearchQuery(null)
                setSearchFilter('')
              }}
            />
          </>
        )}
        {!isCandidatesView && (
          <>
            {/* Top Hero Section */}
            <motion.div
              className={styles.heroCard}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <span className={styles.heroBadge}>
                <HrIcon name="building" size={13} /> EMPLOYER & RECRUITER PORTAL ·{' '}
                {user?.companyName || 'TECHCITTA SOLUTIONS'}
              </span>
              <h1 className={styles.heroTitle}>Employer AI Hiring Studio</h1>
              <p className={styles.heroDesc}>
                Create exclusive private job openings, generate unique assessment links, and
                inspect candidates AI interview scores & video assessments.
              </p>
            </motion.div>

            {/* Private Job Openings Management Section (Image 1) */}
            <motion.div
              className={styles.jobsSection}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.03 }}
            >
              <div className={styles.jobsHeader}>
                <h3 className={styles.jobsTitle}>
                  <HrIcon name="briefcase" size={20} /> Active Job Openings &amp; Shareable Assessment Links
                </h3>
                <button
                  type="button"
                  className={styles.createJobBtn}
                  onClick={() => setShowCreateJobModal(true)}
                >
                  <HrIcon name="plus" size={14} /> Create New Job Opening
                </button>
              </div>

              <div className={styles.jobsGrid}>
                {jobs.length === 0 && !portalLoading && (
                  <p className={styles.portalSyncNote}>
                    No jobs in the database yet. Create an opening and share the link with candidates.
                  </p>
                )}
                {jobs.map((job) => {
                  const count = jobCounts[job.id] ?? 0
                  const isCopied = copiedCode === job.shareableCode
                  const isSelected = selectedJobId === job.id
                  const isPending = isOptimisticJobId(job.id)
                  const isDeleting = deletingJobId === job.id

                  return (
                    <div
                      key={job.id}
                      className={`${styles.jobCard} ${isSelected ? styles.jobCardSelected : ''} ${isPending ? styles.jobCardPending : ''} ${isDeleting ? styles.jobCardDeleting : ''}`}
                      aria-busy={isDeleting}
                      data-testid={isDeleting ? 'job-card-deleting' : undefined}
                    >
                      <div>
                        {isDeleting ? (
                          <p className={styles.jobDeletingNotice} role="status">
                            Deleting…
                          </p>
                        ) : null}
                        <h4 className={styles.jobCardTitle}>{job.title}</h4>
                        <div className={styles.jobCardMeta}>
                          <span className={styles.metaBadge}>{job.roleTrack}</span>
                          <span className={styles.metaBadge}>{job.experienceLevel}</span>
                          <span className={styles.metaBadge}>{job.location}</span>
                        </div>

                        <div className={styles.linkBox}>
                          <span className={styles.linkUrl}>
                            {isPending
                              ? 'Generating shareable link…'
                              : buildApplyUrl(job.company, job.shareableCode)}
                          </span>
                          <button
                            type="button"
                            className={styles.copyBtn}
                            disabled={isPending || isDeleting}
                            onClick={() => handleCopyLink(job)}
                          >
                            {isCopied ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      </div>

                      <div className={styles.jobFooter}>
                        <button
                          type="button"
                          className={styles.rosterCountBtn}
                          disabled={isPending || isDeleting}
                          onClick={() => void openJobApplicantsRoster(job)}
                          aria-label={`View ${count} applicants for ${job.title}`}
                        >
                          {count} in roster
                        </button>
                        <div className={styles.jobFooterActions}>
                          <button
                            type="button"
                            className={styles.inspectBtn}
                            disabled={isPending || isDeleting}
                            onClick={() => void openJobApplicantsRoster(job)}
                          >
                            View applicants →
                          </button>
                          <button
                            type="button"
                            className={styles.deleteJobBtn}
                            disabled={isPending || isDeleting}
                            onClick={() => void handleDeleteJob(job)}
                            aria-label={`Delete job ${job.title}`}
                          >
                            {isDeleting ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>

            {portalSyncNote && (
              <p className={styles.portalSyncNote} role="status">
                {portalSyncNote}
              </p>
            )}
          </>
        )}

        {showCandidateTable && (
        <>
        {/* Refined Candidate Filters Card (matches SearchCandidatesPanel design) */}
        <motion.div
          className={styles.filterBarCard}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.04 }}
        >
          {/* Header */}
          <div className={styles.filterCardHeader}>
            <div>
              <h3 className={styles.filterCardTitle}>Filter Candidates</h3>
              <p className={styles.filterCardSubtitle}>
                Filter applicants and AI-interviewed talent across contact info, role, experience, evaluation scores, or status.
              </p>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                className={styles.filterTopClearBtn}
                onClick={handleClearFilters}
                title="Clear all filters"
              >
                <HrIcon name="close" size={13} /> Reset filters
              </button>
            )}
          </div>

          {/* Structured Fields Grid */}
          <div className={styles.filterGrid}>
            {/* Candidate Search (Name, Email, Phone) */}
            <div className={`${styles.filterFieldGroup} ${styles.filterSpan2}`}>
              <label className={styles.filterFieldLabel} htmlFor="filter-candidate">
                Candidate contact or name
              </label>
              <div className={styles.filterInputWrap}>
                <span className={styles.filterInputIcon}>
                  <HrIcon name="search" size={16} />
                </span>
                <input
                  id="filter-candidate"
                  type="text"
                  className={`${styles.filterInputField} ${styles.filterInputFieldWithIcon}`}
                  placeholder="Search name, email, or phone..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearchCandidatesClick()
                  }}
                />
              </div>
            </div>

            {/* Target Job Search */}
            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-job">
                Job opening
              </label>
              <input
                id="filter-job"
                type="text"
                className={styles.filterInputField}
                placeholder="Search job title..."
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            {/* Role Search */}
            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-role">
                Role track
              </label>
              <input
                id="filter-role"
                type="text"
                className={styles.filterInputField}
                placeholder="Search role..."
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            {/* Experience Search */}
            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-exp">
                Experience level
              </label>
              <input
                id="filter-exp"
                type="text"
                className={styles.filterInputField}
                placeholder="e.g. Senior, Mid, 3+ yrs..."
                value={expFilter}
                onChange={(e) => setExpFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            {/* AI Score Search */}
            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-score">
                AI interview score
              </label>
              <input
                id="filter-score"
                type="text"
                className={styles.filterInputField}
                placeholder="e.g. 80, 90%..."
                value={scoreFilter}
                onChange={(e) => setScoreFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            {/* Integrity Search */}
            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-integrity">
                Proctor integrity
              </label>
              <input
                id="filter-integrity"
                type="text"
                className={styles.filterInputField}
                placeholder="e.g. Clean, High..."
                value={integrityFilter}
                onChange={(e) => setIntegrityFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            {/* Status Search */}
            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-status">
                Application status
              </label>
              <input
                id="filter-status"
                type="text"
                className={styles.filterInputField}
                placeholder="e.g. Shortlisted, Screened..."
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>
          </div>

          {/* Action Footer with Search candidates button at bottom right */}
          <div className={styles.filterCardFooter}>
            <div className={styles.filterFooterLeft}>
              {hasActiveFilters ? (
                <span className={styles.filterStatusText}>
                  <span className={styles.filterCountPill}>
                    {activeFilterCount} active filter{activeFilterCount > 1 ? 's' : ''}
                  </span>
                  Showing matching candidates
                </span>
              ) : (
                <span className={styles.filterHintText}>
                  Type criteria above or click Search Candidates to view matching records
                </span>
              )}
            </div>

            <div className={styles.filterFooterRight}>
              {hasActiveFilters && (
                <button
                  type="button"
                  className={styles.filterClearBtn}
                  onClick={handleClearFilters}
                  title="Clear all filters"
                >
                  <HrIcon name="close" size={14} /> Clear filters
                </button>
              )}
              <button
                type="button"
                className={styles.filterSearchBtn}
                onClick={handleSearchCandidatesClick}
              >
                <HrIcon name="search" size={16} /> Search candidates
              </button>
            </div>
          </div>
        </motion.div>

        {/* Candidates Section Card (Image 2) */}
        <motion.div
          id="candidates-section"
          className={styles.candidatesCard}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
        >
          <div className={styles.candidatesHeader}>
            <div className={styles.titleGroup}>
              <h2>
                {isCandidatesView
                  ? 'All candidates'
                  : selectedJobTitle
                    ? `Interviews · ${selectedJobTitle}`
                    : 'Candidates'}
              </h2>
              <div className={styles.countText}>
                Showing {filteredApplicants.length} of {applicants.length} from database
              </div>
            </div>

            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.clearFiltersBtn}
                onClick={handleClearFilters}
              >
                Clear filters
              </button>
              <button
                type="button"
                className={styles.addCandidateBtn}
                onClick={() => setShowCreateJobModal(true)}
              >
                + Add candidate
              </button>
            </div>
          </div>

          {/* Candidates Table */}
          <div className={styles.tableContainer}>
            <table
              className={`${styles.candidatesTable}${isCandidatesView ? '' : ` ${styles.candidatesTableWide}`}`}
            >
              <thead>
                <tr>
                  {isCandidatesView ? (
                    <>
                      <th style={{ width: '28%' }}>NAME</th>
                      <th style={{ width: '20%' }}>ROLE</th>
                      <th style={{ width: '16%' }}>EXPERIENCE</th>
                      <th style={{ width: '22%' }}>RESUME</th>
                      <th style={{ width: '24%' }}>REPORT ON HIRERIGHTTT</th>
                    </>
                  ) : (
                    <>
                      <th style={{ width: '22%' }}>CANDIDATE ▲</th>
                      <th style={{ width: '13%' }}>ROLE</th>
                      <th style={{ width: '16%' }}>TARGET JOB</th>
                      <th style={{ width: '9%' }}>EXPERIENCE</th>
                      <th style={{ width: '14%' }}>AI SCORE & FIT</th>
                      <th style={{ width: '12%' }}>INTEGRITY</th>
                      <th style={{ width: '10%' }}>STATUS</th>
                      <th style={{ width: '11%' }}>ACTIONS</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredApplicants.length === 0 ? (
                  <tr>
                    <td colSpan={isCandidatesView ? 5 : 8}>
                      <div className={styles.emptyState}>
                        <h3>No candidates in database</h3>
                        <p>
                          {isCandidatesView
                            ? 'No matching profiles yet. Try search or wait for candidates to complete interviews.'
                            : 'No applicants or interviews linked to this job yet. Share the apply link.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredApplicants.map((cand) => {
                    const initials = getInitials(cand.candidateName)
                    const score = cand.aiScore ?? cand.interviewResult?.overall
                    const scoreStyle =
                      score == null
                        ? styles.scoreAmber
                        : score >= 85
                          ? styles.scoreGreen
                          : score >= 70
                            ? styles.scorePurple
                            : styles.scoreAmber

                    const integ = cand.integrityStatus ?? (cand.interviewResult?.integrity?.faceViolations ? 'pending' : 'verified')

                    if (isCandidatesView) {
                      const resumeLabel = resumeDisplayLabel(cand)
                      const resumeReady = hasResumeContent(cand)
                      const reportReady = hasHireRightReport(cand)

                      return (
                        <tr key={cand.id}>
                          <td>
                            <div className={styles.candidateCell}>
                              <div className={styles.avatar}>{initials}</div>
                              <div>
                                <div className={styles.candidateName}>{cand.candidateName}</div>
                                <div className={styles.candidateContact}>
                                  {cand.candidateEmail}
                                  {cand.candidatePhone ? ` · ${cand.candidatePhone}` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={styles.roleTag}>{cand.role || '—'}</span>
                          </td>
                          <td>
                            <span className={styles.experienceText}>
                              {cand.experienceYears || '—'}
                            </span>
                          </td>
                          <td>
                            {resumeReady ? (
                              <button
                                type="button"
                                className={styles.docLinkBtn}
                                onClick={() => setDocumentViewer({ kind: 'resume', applicant: cand })}
                              >
                                <HrIcon name="document" size={14} />
                                {resumeLabel}
                              </button>
                            ) : (
                              <span className={styles.docMuted}>No resume</span>
                            )}
                          </td>
                          <td>
                            {reportReady ? (
                              <button
                                type="button"
                                className={styles.docLinkBtn}
                                onClick={() => setDocumentViewer({ kind: 'report', applicant: cand })}
                              >
                                <HrIcon name="sparkle" size={14} />
                                View HireRighttt report
                              </button>
                            ) : (
                              <span className={styles.docMuted}>No interview yet</span>
                            )}
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={cand.id}>
                        {/* CANDIDATE */}
                        <td>
                          <div className={styles.candidateCell}>
                            <div className={styles.avatar}>{initials}</div>
                            <div>
                              <div className={styles.candidateName}>{cand.candidateName}</div>
                              <div className={styles.candidateContact}>
                                {cand.candidateEmail} · {cand.candidatePhone}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* ROLE */}
                        <td>
                          <span className={styles.roleTag}>{cand.role || '—'}</span>
                        </td>

                        {/* TARGET JOB */}
                        <td>
                              <div className={styles.targetJobTitle}>{cand.jobTitle}</div>
                              <div className={styles.targetJobCompany}>{cand.company}</div>
                            </td>

                            {/* EXPERIENCE */}
                            <td>
                              <span className={styles.experienceText}>{cand.experienceYears}</span>
                            </td>

                            {/* AI SCORE & FIT */}
                            <td>
                              <span className={`${styles.scorePill} ${scoreStyle}`}>
                                {score != null ? `✦ ${score}% Overall Fit` : 'No interview yet'}
                              </span>
                            </td>

                            {/* INTEGRITY */}
                            <td>
                              {integ === 'verified' && (
                                <span className={`${styles.integrityText} ${styles.integrityVerified}`}>
                                  <HrIcon name="shield-check" size={14} /> Verified Candidate
                                </span>
                              )}
                              {integ === 'pending' && (
                                <span className={`${styles.integrityText} ${styles.integrityPending}`}>
                                  <HrIcon name="shield-check" size={14} /> Verification pending
                                </span>
                              )}
                              {integ === 'unverified' && (
                                <span className={`${styles.integrityText} ${styles.integrityUnverified}`}>
                                  <HrIcon name="close" size={13} /> Not verified
                                </span>
                              )}
                            </td>

                            {/* STATUS */}
                            <td>
                              <select
                                className={styles.statusDropdown}
                                value={cand.status}
                                onChange={(e) =>
                                  handleStatusChange(
                                    cand.id,
                                    e.target.value as EmployerApplicant['status'],
                                  )
                                }
                              >
                                <option value="New">New</option>
                                <option value="Shortlisted">Shortlisted</option>
                                <option value="Interviewing">Interviewing</option>
                                <option value="Rejected">Rejected</option>
                              </select>
                            </td>

                            {/* ACTIONS */}
                            <td>
                              <button
                                type="button"
                                className={styles.inspectBtn}
                                onClick={() => setSelectedApplicant(cand)}
                              >
                                Inspect AI Report →
                              </button>
                            </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
        </>
        )}

        {/* Create Job Opening Modal */}
        {showCreateJobModal && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2>
                  <HrIcon name="plus" size={18} /> Create Private Job Opening
                </h2>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setShowCreateJobModal(false)}
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateJob}>
                <div className={styles.formGroup}>
                  <label>Job Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Senior Frontend Developer"
                    value={newJobTitle}
                    onChange={(e) => setNewJobTitle(e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className={styles.formGroup}>
                    <label>Role Track</label>
                    <select
                      value={newJobRoleTrack}
                      onChange={(e) => setNewJobRoleTrack(e.target.value)}
                    >
                      <option value="Frontend Developer">Frontend Developer</option>
                      <option value="Full Stack Engineer">Full Stack Engineer</option>
                      <option value="Backend Engineer">Backend Engineer</option>
                      <option value="QA Engineer">QA Engineer</option>
                      <option value="DevOps Engineer">DevOps Engineer</option>
                      <option value="Product Manager">Product Manager</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Experience Level</label>
                    <select
                      value={newJobExp}
                      onChange={(e) => setNewJobExp(e.target.value)}
                    >
                      <option value="0-2 years">0-2 years (Junior)</option>
                      <option value="3-5 years">3-5 years (Mid-Level)</option>
                      <option value="6+ years">6+ years (Senior / Lead)</option>
                    </select>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label>Location</label>
                  <input
                    type="text"
                    placeholder="Hyderabad / Remote"
                    value={newJobLocation}
                    onChange={(e) => setNewJobLocation(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Job Description</label>
                  <textarea
                    required
                    minLength={30}
                    placeholder="Paste job description requirements and expectations (min 30 characters)..."
                    value={newJobDescription}
                    onChange={(e) => setNewJobDescription(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Required skills (comma-separated)</label>
                  <input
                    type="text"
                    placeholder="React, TypeScript, System Design"
                    value={newJobSkills}
                    onChange={(e) => setNewJobSkills(e.target.value)}
                  />
                </div>

                {jobFormError && (
                  <p className={styles.formError} role="alert">
                    {jobFormError}
                  </p>
                )}

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setShowCreateJobModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className={styles.submitBtn}>
                    Generate Shareable Job Link →
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {jobRosterOpen && (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="job-roster-title">
            <div className={styles.modal} style={{ maxWidth: '720px' }}>
              <div className={styles.modalHeader}>
                <div>
                  <h2 id="job-roster-title">
                    <HrIcon name="briefcase" size={18} /> Applicants · {jobRosterOpen.title}
                  </h2>
                  <p className={styles.rosterModalSub}>
                    Loaded from the database for this job posting.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={closeJobApplicantsRoster}
                  aria-label="Close applicants list"
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              {jobRosterLoading ? (
                <p className={styles.portalSyncNote} role="status">
                  Loading applicants…
                </p>
              ) : null}
              {jobRosterError ? (
                <p className={styles.formError} role="alert">
                  {jobRosterError}
                </p>
              ) : null}

              {!jobRosterLoading && !jobRosterError ? (
                <div className={styles.rosterTableWrap}>
                  <table className={styles.rosterTable}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Experience</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobRosterRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className={styles.rosterEmpty}>
                            No applications yet. Share the job link so candidates can apply with their
                            report.
                          </td>
                        </tr>
                      ) : (
                        jobRosterRows.map((app) => (
                          <tr key={app.id}>
                            <td>{app.data.candidateName || app.candidateEmail}</td>
                            <td>
                              {app.data.candidateRole ||
                                app.data.roleTrack ||
                                (app.data.interviewResult as { role?: string } | undefined)?.role ||
                                '—'}
                            </td>
                            <td>{app.data.experienceYears || '—'}</td>
                            <td>{applicantDisplayScore(app)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className={styles.modalFooter}>
                <button type="button" className={styles.cancelBtn} onClick={closeJobApplicantsRoster}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {documentViewer && (
          <EmployerCandidateDocumentModal
            kind={documentViewer.kind}
            applicant={documentViewer.applicant}
            onClose={() => setDocumentViewer(null)}
          />
        )}

        {/* Detailed Applicant AI Evaluation Report Modal */}
        {selectedApplicant && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal} style={{ maxWidth: '780px' }}>
              <div className={styles.modalHeader}>
                <div>
                  <h2>
                    <HrIcon name="document" size={18} /> {selectedApplicant.candidateName} — AI Assessment Report
                  </h2>
                  <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '4px' }}>
                    Applied for {selectedApplicant.jobTitle} ({selectedApplicant.company})
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setSelectedApplicant(null)}
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>CANDIDATE DETAILS</div>
                  <div style={{ marginTop: '6px', fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>{selectedApplicant.candidateName}</div>
                  <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '2px' }}>{selectedApplicant.candidateEmail}</div>
                  <div style={{ fontSize: '0.85rem', color: '#475569' }}>Phone: {selectedApplicant.candidatePhone}</div>
                  <div style={{ fontSize: '0.85rem', color: '#475569' }}>Experience: {selectedApplicant.experienceYears}</div>
                </div>

                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>SCORES</div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#6036eb', marginTop: '2px' }}>
                    {selectedApplicant.aiScore ?? selectedApplicant.interviewResult?.overall ?? '—'}
                    {selectedApplicant.interviewResult?.overall != null ? '%' : ''}
                  </div>
                  {(selectedApplicant.atsScore != null || selectedApplicant.jdMatchScore != null) && (
                    <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: 6 }}>
                      ATS {selectedApplicant.atsScore ?? '—'}% · JD match{' '}
                      {selectedApplicant.jdMatchScore ?? '—'}%
                    </div>
                  )}
                  {selectedApplicant.primarySkills && selectedApplicant.primarySkills.length > 0 && (
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 8 }}>
                      Key skills: {selectedApplicant.primarySkills.join(', ')}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.invitePanel}>
                <h4>Schedule AI interview invite</h4>
                <p className={styles.inviteHint}>
                  Candidate receives an email (SMTP) with a link that opens at the scheduled start time.
                  Candidate gets an email with a link. They can join from the exact start time for 5
                  minutes (e.g. 2:00 AM–2:05 AM), then go straight into the interview. Ava uses their
                  resume and this job description for personalized questions.
                </p>
                <div className={styles.inviteRow}>
                  <label>
                    Start (local time)
                    <input
                      type="datetime-local"
                      value={inviteStart}
                      onChange={(e) => setInviteStart(e.target.value)}
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      min={15}
                      max={180}
                      value={inviteDuration}
                      onChange={(e) => setInviteDuration(Number(e.target.value) || 60)}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.submitBtn}
                    disabled={inviteLoading}
                    onClick={() => void handleSendInterviewInvite()}
                  >
                    {inviteLoading ? 'Sending…' : 'Send invite'}
                  </button>
                </div>
                {inviteFeedback && <p className={styles.inviteFeedback}>{inviteFeedback}</p>}
              </div>

              {selectedApplicant.resumeText && (
                <div className={styles.formGroup}>
                  <label>Extracted Resume Summary</label>
                  <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', fontSize: '0.85rem', color: '#334155', border: '1px solid #e2e8f0', lineHeight: 1.5 }}>
                    {selectedApplicant.resumeText}
                  </div>
                </div>
              )}

              {selectedApplicant.interviewResult && (
                <div>
                  <h4 style={{ margin: '18px 0 10px 0', color: '#0f172a', fontSize: '0.95rem', fontWeight: 700 }}>Category Breakdown</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {selectedApplicant.interviewResult.categories?.map((cat) => (
                      <div key={cat.label} style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '10px 14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, color: '#475569', fontSize: '0.85rem' }}>{cat.label}</span>
                        <span style={{ fontWeight: 800, color: '#4f46e5', fontSize: '0.95rem' }}>{cat.score}%</span>
                      </div>
                    ))}
                  </div>

                  <h4 style={{ margin: '20px 0 10px 0', color: '#0f172a', fontSize: '0.95rem', fontWeight: 700 }}>Candidate Answer Transcripts & Scores</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedApplicant.interviewResult.answers?.map((ans, idx) => (
                      <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '14px', borderRadius: '10px' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px', fontSize: '0.88rem' }}>
                          Q{idx + 1}: {ans.question}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#334155', fontStyle: 'italic', marginBottom: '6px' }}>
                          "{ans.answer}"
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b' }}>
                          <span>Score: <strong style={{ color: '#0f172a' }}>{ans.score}%</strong></span>
                          <span>Words: <strong style={{ color: '#0f172a' }}>{ans.wordCount}</strong></span>
                          <span>Keywords: <strong style={{ color: '#0f172a' }}>{ans.keywordsHit?.join(', ') || 'N/A'}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '20px' }}>
                    <VideoProctorTimeline sessionId={selectedApplicant.interviewResult.sessionId} logs={selectedApplicant.interviewResult.integrity?.logs} />
                  </div>
                </div>
              )}

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setSelectedApplicant(null)}
                >
                  Close Report
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <SiteFooter />
    </div>
  )
}
