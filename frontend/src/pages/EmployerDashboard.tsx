import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { VideoProctorTimeline } from '../components/VideoProctorTimeline'
import { getUser, type EmployerApplicant, type EmployerJob } from '../lib/store'
import { HrIcon } from '../components/HrIcon'
import { JobApplicantsPanel } from '../components/JobApplicantsPanel'
import { InviteCandidatesPanel } from '../components/InviteCandidatesPanel'
import { CandidateSearchBar, HighlightText } from '../components/CandidateSearchBar'
import {
  candidateScore,
  matchesQuickFilter,
  needsIntegrityReview,
  searchCandidates,
  type CandidateQuickFilter,
  type CandidateSort,
} from '../lib/candidateSearch'
import { apiHealth, fetchMailStatus } from '../lib/api'
import { ensureApiSession } from '../lib/apiSession'
import { buildApplyUrl } from '../lib/jobLink'
import {
  filterJobSeekerCandidates,
  hasHireRightReport,
  hasResumeContent,
  mapApplicantStatusToApi,
  mapOrgCandidate,
  mapVendorApplicant,
  resumeDisplayLabel,
  vendorJobToEmployerJob,
} from '../lib/employerCandidateUtils'
import {
  EmployerCandidateDocumentModal,
  type EmployerDocumentKind,
} from '../components/EmployerCandidateDocumentModal'
import {
  DEFAULT_JOB_ROLE,
  JOB_ROLE_GROUPS,
  suggestRoleFromTitle,
} from '../data/jobRoles'
import {
  createVendorJob,
  deleteVendorJob,
  markVendorJobDeletedForCandidates,
  fetchEmployerApplicationAlerts,
  fetchJobApplicants,
  fetchOrganizationCandidates,
  fetchVendorJobs,
  patchApplicantStatus,
  sendApplicantInterviewInvite,
} from '../lib/vendorApi'
import { syncEmployerApplicationNotifications } from '../lib/employerApplicationNotifications'
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

function formatShortDate(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A score as a plain number with a small coloured dot: green 75+, amber 50+, red below. */
function ScoreBadge({ value, label = 'Interview score' }: { value: number; label?: string }) {
  const rounded = Math.round(value)
  const tone = rounded >= 75 ? styles.toneGood : rounded >= 50 ? styles.toneMid : styles.toneLow
  return (
    <span className={styles.score} title={label}>
      <span className={`${styles.scoreDot} ${tone}`} aria-hidden="true" />
      {rounded}
      <span className={styles.scoreMax}>/100</span>
    </span>
  )
}

type CandidatesDirectoryTableProps = {
  rows: EmployerApplicant[]
  emptyTitle: string
  emptyBody: string
  /** Current search text: used to highlight matches and to explain an empty result. */
  query?: string
  onClearSearch?: () => void
  onViewDocument: (kind: EmployerDocumentKind, applicant: EmployerApplicant) => void
}

/** Same layout as /employer/candidates — name, role, experience, resume, HireRight report. */
function CandidatesDirectoryTable({
  rows,
  emptyTitle,
  emptyBody,
  query = '',
  onClearSearch,
  onViewDocument,
}: CandidatesDirectoryTableProps) {
  return (
    <table className={`${styles.candidatesTable} ${styles.stackOnPhone}`}>
      <thead>
        <tr>
          <th scope="col" style={{ width: '30%' }}>Candidate</th>
          <th scope="col" style={{ width: '16%' }}>Role</th>
          <th scope="col" style={{ width: '12%' }}>Experience</th>
          <th scope="col" style={{ width: '20%' }}>Resume</th>
          <th scope="col" style={{ width: '22%' }}>HireRighttt report</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5}>
              <div className={styles.emptyState}>
                {query.trim() ? (
                  <>
                    <h3>No candidates match “{query.trim()}”</h3>
                    <p>
                      Try fewer words, a different spelling, or search by a skill or role. Every word you type must
                      appear on the candidate.
                    </p>
                    {onClearSearch ? (
                      <button type="button" className={styles.btnSecondary} onClick={onClearSearch}>
                        Clear search
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <h3>{emptyTitle}</h3>
                    <p>{emptyBody}</p>
                  </>
                )}
              </div>
            </td>
          </tr>
        ) : (
          rows.map((cand) => {
            const initials = getInitials(cand.candidateName)
            const resumeLabel = resumeDisplayLabel(cand)
            const resumeReady = hasResumeContent(cand)
            const reportReady = hasHireRightReport(cand)
            const score = candidateScore(cand)

            return (
              <tr key={cand.id}>
                <td className={styles.directoryNameCell}>
                  <div className={styles.candidateCell}>
                    <div className={styles.avatar} aria-hidden="true">{initials}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.candidateName}>
                        <HighlightText text={cand.candidateName} query={query} />
                      </div>
                      <div className={styles.candidateContact}>
                        <HighlightText text={cand.candidateEmail} query={query} />
                        {cand.candidatePhone ? <> · <HighlightText text={cand.candidatePhone} query={query} /></> : null}
                      </div>
                    </div>
                  </div>
                </td>
                <td data-label="Role">
                  {cand.role ? (
                    <span className={styles.roleTag}>
                      <HighlightText text={cand.role} query={query} />
                    </span>
                  ) : (
                    <span className={styles.docMuted}>—</span>
                  )}
                </td>
                <td data-label="Experience">
                  <span className={styles.experienceText}>{cand.experienceYears || '—'}</span>
                </td>
                <td data-label="Resume">
                  {resumeReady ? (
                    <button
                      type="button"
                      className={styles.docLinkBtn}
                      onClick={() => onViewDocument('resume', cand)}
                    >
                      <HrIcon name="document" size={14} />
                      {resumeLabel}
                    </button>
                  ) : (
                    <span className={styles.docMuted}>No resume</span>
                  )}
                </td>
                <td data-label="Report">
                  {reportReady ? (
                    <span className={styles.reportCell}>
                      {score !== null ? <ScoreBadge value={score} label="Overall interview score" /> : null}
                      <button
                        type="button"
                        className={styles.docLinkBtn}
                        style={{ whiteSpace: 'nowrap' }}
                        onClick={() => onViewDocument('report', cand)}
                      >
                        View report
                      </button>
                    </span>
                  ) : (
                    <span className={styles.pill}>No interview yet</span>
                  )}
                </td>
              </tr>
            )
          })
        )}
      </tbody>
    </table>
  )
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

  // Filters State
  const [searchFilter, setSearchFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [jobFilter, setJobFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')
  const [scoreFilter, setScoreFilter] = useState('')
  const [integrityFilter, setIntegrityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [quickFilter, setQuickFilter] = useState<CandidateQuickFilter>('all')
  const [sortMode, setSortMode] = useState<CandidateSort>('best_match')
  const [showMoreFilters, setShowMoreFilters] = useState(false)

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
  const [newJobRoleTrack, setNewJobRoleTrack] = useState(DEFAULT_JOB_ROLE)
  const [newJobExp, setNewJobExp] = useState('3-5 years')
  const [newJobLocation, setNewJobLocation] = useState('Hyderabad / Remote')
  const [newJobDescription, setNewJobDescription] = useState('')
  const [newJobSkills, setNewJobSkills] = useState('')
  const [portalSyncNote, setPortalSyncNote] = useState('')
  const seenApplicationAlertIdsRef = useRef(new Set<string>())

  const [jobRosterOpen, setJobRosterOpen] = useState<{ jobId: string; title: string } | null>(
    null,
  )
  const [jobRosterLoading, setJobRosterLoading] = useState(false)
  const [jobRosterRows, setJobRosterRows] = useState<EmployerApplicant[]>([])

  const [inviteStart, setInviteStart] = useState('')
  const [inviteDuration, setInviteDuration] = useState(60)
  // How long an invite link stays open after its start time (server setting INVITE_JOIN_WINDOW_MINUTES).
  const [joinWindowMinutes, setJoinWindowMinutes] = useState(15)
  useEffect(() => {
    let alive = true
    void fetchMailStatus().then((s) => {
      if (alive && typeof s.inviteJoinWindowMinutes === 'number') setJoinWindowMinutes(s.inviteJoinWindowMinutes)
    })
    return () => {
      alive = false
    }
  }, [])
  const [inviteFeedback, setInviteFeedback] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)

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
      setJobs([])
      return
    }
    const sessionOk = await ensureApiSession()
    if (loadSeq !== jobsLoadSeqRef.current) return
    if (!sessionOk) {
      setJobs([])
      return
    }
    const { jobs: remoteJobs } = await fetchVendorJobs()
    if (loadSeq !== jobsLoadSeqRef.current) return
    const mapped = remoteJobs.map((j) => vendorJobToEmployerJob(j, user.email))
    setJobs(mapped)
    void refreshJobCountsForJobs(mapped, loadSeq)
  }

  async function loadOrgCandidatesFromApi(
    filters?: {
      name?: string
      job?: string
      keywords?: string
    },
    opts?: { background?: boolean },
  ) {
    const { candidates } = await fetchOrganizationCandidates(filters, opts)
    const jobSeekers = filterJobSeekerCandidates(candidates)
    setApplicants(jobSeekers.map((c) => normalizeApplicant(mapOrgCandidate(c))))
    setPortalSyncNote(`${jobSeekers.length} candidate profiles available.`)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!user || user.role !== 'employer') return
      setPortalLoading(true)
      try {
        await loadJobsFromApi()
        if (cancelled) return
        if (isCandidatesView) {
          await loadOrgCandidatesFromApi()
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[employer-dashboard] load failed', err)
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

  useEffect(() => {
    if (!user || user.role !== 'employer') return
    let cancelled = false

    async function pollApplicationAlerts() {
      try {
        await ensureApiSession()
        const { alerts } = await fetchEmployerApplicationAlerts()
        if (cancelled) return
        syncEmployerApplicationNotifications(alerts)
        const fresh = alerts.filter((a) => !seenApplicationAlertIdsRef.current.has(a.id))
        if (fresh.length) {
          fresh.forEach((a) => seenApplicationAlertIdsRef.current.add(a.id))
          for (const alert of fresh) {
            try {
              const { total, applicants: roster } = await fetchJobApplicants(alert.jobId, { background: true })
              setJobCounts((prev) => ({ ...prev, [alert.jobId]: total ?? roster.length }))
            } catch {
              /* ignore per-job refresh errors */
            }
          }
          if (isCandidatesView) {
            void loadOrgCandidatesFromApi(undefined, { background: true })
          }
        }
      } catch {
        /* polling is best-effort */
      }
    }

    void pollApplicationAlerts()
    const interval = window.setInterval(() => void pollApplicationAlerts(), 30000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [user?.email, user?.role, isCandidatesView])

  const showCandidateTable = isCandidatesView

  function handleClearFilters() {
    setQuickFilter('all')
    setSortMode('best_match')
    setSearchFilter('')
    setRoleFilter('')
    setJobFilter('')
    setExpFilter('')
    setScoreFilter('')
    setIntegrityFilter('')
    setStatusFilter('')
  }

  const hasActiveFilters = Boolean(
    searchFilter || roleFilter || jobFilter || expFilter || scoreFilter || integrityFilter || statusFilter
  )

  const moreFilterCount = [roleFilter, jobFilter, expFilter, scoreFilter, integrityFilter, statusFilter].filter(Boolean).length

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

  const advancedFiltered = useMemo(() => {
    return applicants.filter((app) => {
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
        const integ =
          app.integrityStatus ??
          (app.interviewResult?.integrity?.proctoring?.status === 'FLAGGED' ||
          (app.interviewResult?.integrity?.faceViolations ?? 0) > 0
            ? 'pending'
            : 'verified')
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
  }, [applicants, roleFilter, jobFilter, expFilter, scoreFilter, integrityFilter, statusFilter])

  // Ranked multi-word search (name, email, phone, role, skills, resume text) + quick filter + sort.
  const filteredApplicants = useMemo(
    () => searchCandidates(advancedFiltered, { query: searchFilter, quick: quickFilter, sort: sortMode }),
    [advancedFiltered, searchFilter, quickFilter, sortMode],
  )

  const quickCounts = useMemo<Record<CandidateQuickFilter, number>>(
    () => ({
      all: advancedFiltered.length,
      interviewed: advancedFiltered.filter((c) => matchesQuickFilter(c, 'interviewed')).length,
      not_interviewed: advancedFiltered.filter((c) => matchesQuickFilter(c, 'not_interviewed')).length,
      score_70: advancedFiltered.filter((c) => matchesQuickFilter(c, 'score_70')).length,
      review: advancedFiltered.filter((c) => needsIntegrityReview(c)).length,
    }),
    [advancedFiltered],
  )

  async function handleStatusChange(id: string, newStatus: EmployerApplicant['status']) {
    setApplicants((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a)),
    )
    try {
      await ensureApiSession()
      if (await apiHealth()) {
        await patchApplicantStatus(id, mapApplicantStatusToApi(newStatus))
      }
    } catch (err) {
      console.warn('[employer-dashboard] status sync failed', err)
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault()
    const jd = newJobDescription.trim()
    const title = newJobTitle.trim()
    const location = newJobLocation.trim()
    const roleTrack = newJobRoleTrack.trim()
    const experienceLevel = newJobExp.trim()
    if (!title || !roleTrack || !experienceLevel || !location || jd.length < 30) {
      return
    }
    const requiredSkills = newJobSkills
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const company = user?.companyName || 'TechCitta Solutions'
    const createdByEmail = user?.email || 'employer@hireright.com'

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
    setPortalSyncNote(`Creating “${title}”…`)

    try {
      await ensureApiSession()
      if (!(await apiHealth())) {
        throw new Error('We cannot create this job right now. Please try again shortly.')
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
      setShowCreateJobModal(false)
      setNewJobTitle('')
      setNewJobDescription('')
      setNewJobSkills('')
      setNewJobRoleTrack(DEFAULT_JOB_ROLE)
      setNewJobExp('3-5 years')
      setNewJobLocation('Hyderabad / Remote')
      setPortalSyncNote(`Job “${created.title}” published. Share the link to collect applicants.`)
    } catch (err) {
      console.warn('[employer-dashboard] create job failed', err)
      setJobs((prev) => prev.filter((j) => j.id !== optimisticId))
      setJobCounts((prev) => {
        const next = { ...prev }
        delete next[optimisticId]
        return next
      })
      setPortalSyncNote('')
    }
  }

  async function handleDeleteJob(job: EmployerJob) {
    if (isOptimisticJobId(job.id) || deletingJobId) return
    const ok = window.confirm(
      `Delete “${job.title}”?\n\nThis removes the job posting from your account. Application links for this opening will stop working.`,
    )
    if (!ok) return

    setDeletingJobId(job.id)
    setPortalSyncNote('')

    try {
      await ensureApiSession()
      if (!(await apiHealth())) {
        throw new Error('We cannot delete this job right now. Please try again shortly.')
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
      console.warn('[employer-dashboard] delete job failed', err)
    } finally {
      setDeletingJobId(null)
    }
  }

  async function openJobApplicantsRoster(job: EmployerJob) {
    if (isOptimisticJobId(job.id)) return
    setJobRosterOpen({ jobId: job.id, title: job.title })
    setJobRosterLoading(true)
    setJobRosterRows([])
    try {
      await ensureApiSession()
      const { applicants, total } = await fetchJobApplicants(job.id)
      setJobRosterRows(applicants.map((a) => normalizeApplicant(mapVendorApplicant(a))))
      setJobCounts((prev) => ({ ...prev, [job.id]: total ?? applicants.length }))
    } catch (err) {
      console.warn('[employer-dashboard] load applicants failed', err)
      setJobRosterRows([])
    } finally {
      setJobRosterLoading(false)
    }
  }

  function closeJobApplicantsRoster() {
    setJobRosterOpen(null)
    setJobRosterRows([])
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


  const companyName = user?.companyName || 'Your organisation'
  const descLength = newJobDescription.trim().length

  return (
    <div className={styles.pageBleed}>
    <div className={styles.page}>
      <div className={styles.shell}>
        {isCandidatesView ? (
          <header className={styles.pageHeader}>
            <div>
              <h1 className={styles.pageTitle}>Candidates</h1>
              <p className={styles.pageSub}>
                Applicants, shared interviews and job seekers who completed an AI interview on HireRighttt.
              </p>
            </div>
          </header>
        ) : (
          <>
            <header className={styles.pageHeader}>
              <div>
                <h1 className={styles.pageTitle}>Jobs</h1>
                <p className={styles.pageSub}>
                  {companyName} · Create private openings, share each apply link and review applicants’ AI
                  interview scores.
                </p>
              </div>
              {jobs.length > 0 || portalLoading ? (
                <div className={styles.pageActions}>
                  <button type="button" className={styles.btnPrimary} onClick={() => setShowCreateJobModal(true)}>
                    <HrIcon name="plus" size={16} /> Create job
                  </button>
                </div>
              ) : null}
            </header>

            {portalSyncNote && (
              <p className={styles.syncNote} role="status">
                {portalSyncNote}
              </p>
            )}

            <section className={styles.panel} aria-labelledby="jobs-heading">
              <div className={styles.panelHeader}>
                <div>
                  <h2 id="jobs-heading" className={styles.panelTitle}>
                    Job openings
                  </h2>
                  <p className={styles.panelSub}>
                    {portalLoading && jobs.length === 0
                      ? 'Loading your openings…'
                      : `${jobs.length} opening${jobs.length === 1 ? '' : 's'} · each has its own apply link`}
                  </p>
                </div>
              </div>

              {jobs.length === 0 && portalLoading && (
                <div className={styles.jobsSkeleton} role="status" aria-label="Loading job openings">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={styles.jobSkeletonCard}>
                      <span className="ds-skeleton ds-skeleton-line" style={{ width: '40%' }} />
                      <span className="ds-skeleton ds-skeleton-line" style={{ width: '25%' }} />
                    </div>
                  ))}
                </div>
              )}

              {jobs.length === 0 && !portalLoading && (
                <div className={`ds-empty ${styles.jobsEmpty}`}>
                  <span className="ds-empty__icon" aria-hidden="true">
                    <HrIcon name="briefcase" size={20} />
                  </span>
                  <p className="ds-empty__title">No job openings yet</p>
                  <p className="ds-empty__body">Create an opening and share the link with candidates.</p>
                  <div className="ds-empty__actions">
                    <button type="button" className={styles.btnPrimary} onClick={() => setShowCreateJobModal(true)}>
                      <HrIcon name="plus" size={16} /> Create job
                    </button>
                  </div>
                </div>
              )}

              {jobs.length > 0 && (
                <div className={styles.tableScroll}>
                  <table className={`${styles.dataTable} ${styles.jobsTable} ${styles.stackOnPhone}`}>
                    <thead>
                      <tr>
                        <th scope="col">Job</th>
                        <th scope="col">Apply link</th>
                        <th scope="col" className={styles.numCol}>
                          Applicants
                        </th>
                        <th scope="col">Created</th>
                        <th scope="col">
                          <span className="ds-sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => {
                        const count = jobCounts[job.id] ?? 0
                        const isCopied = copiedCode === job.shareableCode
                        const isSelected = selectedJobId === job.id
                        const isPending = isOptimisticJobId(job.id)
                        const isDeleting = deletingJobId === job.id
                        const rowClass = [
                          isSelected ? styles.rowSelected : '',
                          isPending ? styles.rowPending : '',
                          isDeleting ? styles.rowDeleting : '',
                        ]
                          .filter(Boolean)
                          .join(' ')

                        return (
                          <tr
                            key={job.id}
                            className={rowClass || undefined}
                            aria-busy={isDeleting}
                            data-testid={isDeleting ? 'job-card-deleting' : undefined}
                          >
                            <td className={styles.jobCell}>
                              {isDeleting ? (
                                <p className={styles.deletingNotice} role="status">
                                  Deleting…
                                </p>
                              ) : null}
                              <button
                                type="button"
                                className={styles.jobTitleBtn}
                                disabled={isPending || isDeleting}
                                onClick={() => void openJobApplicantsRoster(job)}
                              >
                                {job.title}
                              </button>
                              <div className={styles.jobMeta}>
                                <span>{job.roleTrack}</span>
                                <span className={styles.jobMetaSep} aria-hidden="true">·</span>
                                <span>{job.experienceLevel}</span>
                                <span className={styles.jobMetaSep} aria-hidden="true">·</span>
                                <span>{job.location}</span>
                              </div>
                            </td>
                            <td data-label="Apply link">
                              <div className={styles.linkBox}>
                                <span
                                  className={styles.linkUrl}
                                  title={isPending ? undefined : buildApplyUrl(job.company, job.shareableCode)}
                                >
                                  {isPending
                                    ? 'Generating shareable link…'
                                    : buildApplyUrl(job.company, job.shareableCode)}
                                </span>
                                <button
                                  type="button"
                                  className={`${styles.copyBtn} ${isCopied ? styles.copyBtnDone : ''}`}
                                  disabled={isPending || isDeleting}
                                  onClick={() => handleCopyLink(job)}
                                  aria-label={`Copy apply link for ${job.title}`}
                                >
                                  <HrIcon name={isCopied ? 'check' : 'link'} size={12} />
                                  {isCopied ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                            </td>
                            <td data-label="Applicants" className={styles.numCol}>
                              <button
                                type="button"
                                className={styles.countBtn}
                                disabled={isPending || isDeleting}
                                onClick={() => void openJobApplicantsRoster(job)}
                                aria-label={`View ${count} applicants for ${job.title}`}
                              >
                                {count}
                              </button>
                            </td>
                            <td data-label="Created">
                              <span className={styles.mutedCell}>{formatShortDate(job.createdAt)}</span>
                            </td>
                            <td className={styles.rowActions}>
                              <button
                                type="button"
                                className={`${styles.btnSecondary} ${styles.btnSm}`}
                                disabled={isPending || isDeleting}
                                onClick={() => void openJobApplicantsRoster(job)}
                              >
                                View applicants
                              </button>
                              <button
                                type="button"
                                className={`${styles.btnDanger} ${styles.btnSm}`}
                                disabled={isPending || isDeleting}
                                onClick={() => void handleDeleteJob(job)}
                                aria-label={`Delete job ${job.title}`}
                              >
                                {isDeleting ? 'Deleting…' : 'Delete'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {showCandidateTable && (
        <>
        <CandidateSearchBar
          query={searchFilter}
          onQuery={setSearchFilter}
          quick={quickFilter}
          onQuick={setQuickFilter}
          sort={sortMode}
          onSort={setSortMode}
          shown={filteredApplicants.length}
          total={applicants.length}
          counts={quickCounts}
          moreOpen={showMoreFilters}
          moreActiveCount={moreFilterCount}
          onToggleMore={() => setShowMoreFilters((v) => !v)}
          onReset={handleClearFilters}
        />

        {/* Advanced filters (role, job, experience, score, integrity, status) stay one click away */}
        {showMoreFilters && (
        <motion.section
          className={styles.filterBarCard}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          aria-labelledby="more-filters-title"
        >
          <div className={styles.filterCardHeader}>
            <div>
              <h2 id="more-filters-title" className={styles.filterCardTitle}>More filters</h2>
              <p className={styles.filterCardSubtitle}>
                Narrow the list by job, role, experience, score, integrity or status.
              </p>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                className={`${styles.btnGhost} ${styles.btnSm}`}
                onClick={handleClearFilters}
                title="Clear all filters"
              >
                <HrIcon name="close" size={13} /> Reset filters
              </button>
            )}
          </div>

          <div className={styles.filterGrid}>
            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-job">
                Job opening
              </label>
              <input
                id="filter-job"
                type="text"
                className={styles.filterInputField}
                placeholder="Search job title…"
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-role">
                Role track
              </label>
              <input
                id="filter-role"
                type="text"
                className={styles.filterInputField}
                placeholder="Search role…"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-exp">
                Experience level
              </label>
              <input
                id="filter-exp"
                type="text"
                className={styles.filterInputField}
                placeholder="e.g. Senior, Mid, 3+ yrs"
                value={expFilter}
                onChange={(e) => setExpFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-score">
                AI interview score
              </label>
              <input
                id="filter-score"
                type="text"
                className={styles.filterInputField}
                placeholder="e.g. 80, 90%"
                value={scoreFilter}
                onChange={(e) => setScoreFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-integrity">
                Proctor integrity
              </label>
              <input
                id="filter-integrity"
                type="text"
                className={styles.filterInputField}
                placeholder="e.g. Verified, Pending"
                value={integrityFilter}
                onChange={(e) => setIntegrityFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>

            <div className={styles.filterFieldGroup}>
              <label className={styles.filterFieldLabel} htmlFor="filter-status">
                Application status
              </label>
              <input
                id="filter-status"
                type="text"
                className={styles.filterInputField}
                placeholder="e.g. Shortlisted, New"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchCandidatesClick()
                }}
              />
            </div>
          </div>

          <div className={styles.filterCardFooter}>
            {hasActiveFilters ? (
              <span className={styles.filterStatusText}>
                <span className={styles.filterCountPill}>
                  {activeFilterCount} active filter{activeFilterCount > 1 ? 's' : ''}
                </span>
                Showing matching candidates
              </span>
            ) : (
              <span className={styles.filterHintText}>Results update as you type.</span>
            )}

            <div className={styles.filterFooterRight}>
              {hasActiveFilters && (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={handleClearFilters}
                  title="Clear all filters"
                >
                  <HrIcon name="close" size={14} /> Clear filters
                </button>
              )}
              <button type="button" className={styles.btnPrimary} onClick={handleSearchCandidatesClick}>
                <HrIcon name="search" size={16} /> Show results
              </button>
            </div>
          </div>
        </motion.section>
        )}

        <InviteCandidatesPanel jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} />

        <section id="candidates-section" className={styles.panel} aria-labelledby="candidates-heading">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="candidates-heading" className={styles.panelTitle}>
                {isCandidatesView
                  ? 'All candidates'
                  : selectedJobTitle
                    ? `Interviews · ${selectedJobTitle}`
                    : 'Candidates'}
              </h2>
              {!isCandidatesView && (
                <p className={styles.panelSub}>
                  Showing {filteredApplicants.length} of {applicants.length} candidates
                </p>
              )}
            </div>

            <div className={styles.pageActions}>
              {!isCandidatesView && (
                <button type="button" className={`${styles.btnGhost} ${styles.btnSm}`} onClick={handleClearFilters}>
                  Clear filters
                </button>
              )}
              <button
                type="button"
                className={`${styles.btnSecondary} ${styles.btnSm}`}
                onClick={() => setShowCreateJobModal(true)}
              >
                <HrIcon name="plus" size={14} /> Add candidate
              </button>
            </div>
          </div>

          <div className={styles.tableContainer}>
            {isCandidatesView ? (
              <CandidatesDirectoryTable
                rows={filteredApplicants}
                emptyTitle="No candidates yet"
                emptyBody="No matching profiles yet. Try search or wait for candidates to complete interviews."
                query={searchFilter}
                onClearSearch={() => setSearchFilter('')}
                onViewDocument={(kind, applicant) => setDocumentViewer({ kind, applicant })}
              />
            ) : (
            <table className={`${styles.candidatesTable} ${styles.candidatesTableWide}`}>
              <thead>
                <tr>
                  <th scope="col" style={{ width: '22%' }}>Candidate</th>
                  <th scope="col" style={{ width: '13%' }}>Role</th>
                  <th scope="col" style={{ width: '16%' }}>Target job</th>
                  <th scope="col" style={{ width: '9%' }}>Experience</th>
                  <th scope="col" style={{ width: '12%' }}>AI score</th>
                  <th scope="col" style={{ width: '14%' }}>Integrity</th>
                  <th scope="col" style={{ width: '10%' }}>Status</th>
                  <th scope="col" style={{ width: '10%' }}>
                    <span className="ds-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredApplicants.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className={styles.emptyState}>
                        <h3>No candidates yet</h3>
                        <p>No applicants or interviews linked to this job yet. Share the apply link.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredApplicants.map((cand) => {
                    const initials = getInitials(cand.candidateName)
                    const score = cand.aiScore ?? cand.interviewResult?.overall

                    const integ =
                      cand.integrityStatus ??
                      (cand.interviewResult?.integrity?.proctoring?.status === 'FLAGGED' ||
                      (cand.interviewResult?.integrity?.faceViolations ?? 0) > 0
                        ? 'pending'
                        : 'verified')
                    const proctorFlagCount =
                      cand.interviewResult?.integrity?.proctoring?.counts?.total ??
                      cand.interviewResult?.integrity?.logs?.length ??
                      0

                    return (
                      <tr key={cand.id}>
                        <td>
                          <div className={styles.candidateCell}>
                            <div className={styles.avatar} aria-hidden="true">{initials}</div>
                            <div>
                              <div className={styles.candidateName}>{cand.candidateName}</div>
                              <div className={styles.candidateContact}>
                                {cand.candidateEmail} · {cand.candidatePhone}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.roleTag}>{cand.role || '—'}</span>
                        </td>
                        <td>
                          <div className={styles.targetJobTitle}>{cand.jobTitle}</div>
                          <div className={styles.targetJobCompany}>{cand.company}</div>
                        </td>
                        <td>
                          <span className={styles.experienceText}>{cand.experienceYears}</span>
                        </td>
                        <td>
                          {score != null ? (
                            <ScoreBadge value={score} label="Overall fit" />
                          ) : (
                            <span className={styles.pill}>No interview yet</span>
                          )}
                        </td>
                        <td>
                          {integ === 'verified' && (
                            <span className={`${styles.integrityText} ${styles.integrityVerified}`}>
                              <HrIcon name="shield-check" size={14} /> Verified candidate
                            </span>
                          )}
                          {integ === 'pending' && (
                            <span className={`${styles.integrityText} ${styles.integrityPending}`}>
                              <HrIcon name="shield-check" size={14} /> Verification pending
                              {proctorFlagCount > 0 ? (
                                <span className={styles.proctorFlagBadge}>
                                  {proctorFlagCount} flag{proctorFlagCount === 1 ? '' : 's'}
                                </span>
                              ) : null}
                            </span>
                          )}
                          {integ === 'unverified' && (
                            <span className={`${styles.integrityText} ${styles.integrityUnverified}`}>
                              <HrIcon name="close" size={13} /> Not verified
                            </span>
                          )}
                        </td>
                        <td>
                          <select
                            className={styles.statusDropdown}
                            value={cand.status}
                            aria-label={`Status for ${cand.candidateName}`}
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
                        <td>
                          <button
                            type="button"
                            className={styles.inspectBtn}
                            onClick={() => setSelectedApplicant(cand)}
                          >
                            View report
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
            )}
          </div>
        </section>
        </>
        )}

        {/* Create job modal */}
        {showCreateJobModal && (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="create-job-title">
            <form className={styles.modal} onSubmit={handleCreateJob}>
              <div className={styles.modalHeader}>
                <div>
                  <h2 id="create-job-title">Create job</h2>
                  <p className={styles.modalSub}>
                    A private opening with its own apply link. Applicants get an AI interview based on this
                    description and their resume.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setShowCreateJobModal(false)}
                  aria-label="Close"
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.formGroup}>
                  <label htmlFor="employer-job-title">Job title</label>
                  <input
                    id="employer-job-title"
                    type="text"
                    required
                    placeholder="e.g. Senior Frontend Developer"
                    value={newJobTitle}
                    onChange={(e) => setNewJobTitle(e.target.value)}
                    onBlur={() => {
                      const suggested = suggestRoleFromTitle(newJobTitle)
                      if (suggested) setNewJobRoleTrack(suggested)
                    }}
                  />
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label htmlFor="employer-job-role-track">Role</label>
                    <select
                      id="employer-job-role-track"
                      required
                      value={newJobRoleTrack}
                      onChange={(e) => setNewJobRoleTrack(e.target.value)}
                    >
                      {JOB_ROLE_GROUPS.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.roles.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label htmlFor="employer-job-experience">Years of experience</label>
                    <select
                      id="employer-job-experience"
                      required
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
                  <label htmlFor="employer-job-location">Location</label>
                  <input
                    id="employer-job-location"
                    type="text"
                    required
                    placeholder="Hyderabad / Remote"
                    value={newJobLocation}
                    onChange={(e) => setNewJobLocation(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="employer-job-description">Job description</label>
                  <textarea
                    id="employer-job-description"
                    required
                    minLength={30}
                    aria-describedby="employer-job-description-hint"
                    placeholder="Paste the requirements and expectations for this role."
                    value={newJobDescription}
                    onChange={(e) => setNewJobDescription(e.target.value)}
                  />
                  <span
                    id="employer-job-description-hint"
                    className={`${styles.fieldHint} ${descLength >= 30 ? styles.fieldHintOk : ''}`}
                  >
                    {descLength >= 30
                      ? `${descLength} characters`
                      : `At least 30 characters (${descLength}/30)`}
                  </span>
                </div>

                <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                  <label htmlFor="employer-job-skills">Required skills (optional)</label>
                  <input
                    id="employer-job-skills"
                    type="text"
                    aria-describedby="employer-job-skills-hint"
                    placeholder="React, TypeScript, System Design"
                    value={newJobSkills}
                    onChange={(e) => setNewJobSkills(e.target.value)}
                  />
                  <span id="employer-job-skills-hint" className={styles.fieldHint}>
                    Separate skills with commas.
                  </span>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setShowCreateJobModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary}>
                  Create job and get link
                </button>
              </div>
            </form>
          </div>
        )}

        {jobRosterOpen && (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="job-roster-title">
            <div className={`${styles.modal} ${styles.modalWide}`}>
              <div className={styles.modalHeader}>
                <div>
                  <h2 id="job-roster-title">Applicants · {jobRosterOpen.title}</h2>
                  <p className={styles.modalSub}>
                    Everyone who applied from the job board or your shared link, scored against this job.
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

              <div className={styles.modalBody}>
                <JobApplicantsPanel
                  rows={jobRosterRows}
                  loading={jobRosterLoading}
                  onViewDocument={(kind, applicant) => setDocumentViewer({ kind, applicant })}
                  onOpenApplicant={(applicant) => setSelectedApplicant(applicant)}
                />
              </div>

              <div className={styles.modalFooter}>
                <button type="button" className={styles.btnSecondary} onClick={closeJobApplicantsRoster}>
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

        {/* Applicant detail: summary first, then scheduling, then the evidence */}
        {selectedApplicant && (
          <div
            className={styles.modalOverlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="applicant-report-title"
          >
            <div className={`${styles.modal} ${styles.modalReport}`}>
              <div className={styles.modalHeader}>
                <div>
                  <h2 id="applicant-report-title">{selectedApplicant.candidateName}</h2>
                  <p className={styles.modalSub}>
                    AI assessment report · Applied for {selectedApplicant.jobTitle}
                    {selectedApplicant.company ? ` (${selectedApplicant.company})` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setSelectedApplicant(null)}
                  aria-label="Close report"
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div className={styles.modalBody}>
                <section className={styles.summaryGrid} aria-label="Summary">
                  <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>Interview score</span>
                    <span className={styles.summaryValue}>
                      {selectedApplicant.aiScore ?? selectedApplicant.interviewResult?.overall ?? '—'}
                      {selectedApplicant.interviewResult?.overall != null ? '%' : ''}
                    </span>
                    {(selectedApplicant.atsScore != null || selectedApplicant.jdMatchScore != null) && (
                      <dl className={styles.subScores}>
                        <div>
                          <dt>ATS</dt>
                          <dd>{selectedApplicant.atsScore ?? '—'}%</dd>
                        </div>
                        <div>
                          <dt>JD match</dt>
                          <dd>{selectedApplicant.jdMatchScore ?? '—'}%</dd>
                        </div>
                      </dl>
                    )}
                    {selectedApplicant.primarySkills && selectedApplicant.primarySkills.length > 0 && (
                      <p className={styles.keySkills}>
                        <span>Key skills: </span>
                        {selectedApplicant.primarySkills.join(', ')}
                      </p>
                    )}
                  </div>

                  <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel} style={{ marginBottom: 10 }}>
                      Candidate details
                    </span>
                    <dl className={styles.detailList}>
                      <div>
                        <dt>Email</dt>
                        <dd>{selectedApplicant.candidateEmail || '—'}</dd>
                      </div>
                      <div>
                        <dt>Phone</dt>
                        <dd>{selectedApplicant.candidatePhone || '—'}</dd>
                      </div>
                      <div>
                        <dt>Experience</dt>
                        <dd>{selectedApplicant.experienceYears || '—'}</dd>
                      </div>
                    </dl>
                  </div>
                </section>

                <section className={styles.invitePanel} aria-labelledby="invite-schedule-title">
                  <h3 id="invite-schedule-title">Schedule an AI interview</h3>
                  <p className={styles.inviteHint}>
                    The candidate gets an email with a link. It opens at the start time and they can join for the
                    next {joinWindowMinutes} minutes. Ava uses their resume and this job description to personalise
                    the questions.
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
                      className={styles.btnPrimary}
                      disabled={inviteLoading}
                      onClick={() => void handleSendInterviewInvite()}
                    >
                      {inviteLoading ? 'Sending…' : 'Send invite'}
                    </button>
                  </div>
                  {inviteFeedback && (
                    <p className={styles.inviteFeedback} role="status">
                      {inviteFeedback}
                    </p>
                  )}
                </section>

                {selectedApplicant.interviewResult && (
                  <section className={styles.reportSection} aria-labelledby="answers-title">
                    <h3 id="answers-title" className={styles.reportSectionTitle}>
                      Answers and scores
                      <span className={styles.reportSectionMeta}>
                        Overall interview score {selectedApplicant.interviewResult.overall ?? '—'}%
                      </span>
                    </h3>
                    {selectedApplicant.interviewResult.answers?.length ? (
                      <ol className={styles.answerList}>
                        {selectedApplicant.interviewResult.answers.map((ans, idx) => (
                          <li key={idx} className={styles.answerItem}>
                            <p className={styles.answerQuestion}>
                              Q{idx + 1}. {ans.question}
                            </p>
                            <p className={styles.answerText}>“{ans.answer}”</p>
                            <div className={styles.answerMeta}>
                              <span>
                                Score <strong>{ans.score}%</strong>
                              </span>
                              <span>
                                Words <strong>{ans.wordCount}</strong>
                              </span>
                              <span>
                                Keywords <strong>{ans.keywordsHit?.join(', ') || 'N/A'}</strong>
                              </span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    <div style={{ marginTop: 20 }}>
                      <VideoProctorTimeline
                        sessionId={selectedApplicant.interviewResult.sessionId}
                        candidateEmail={selectedApplicant.candidateEmail}
                        logs={selectedApplicant.interviewResult.integrity?.logs}
                        proctoring={selectedApplicant.interviewResult.integrity?.proctoring}
                      />
                    </div>
                  </section>
                )}

                {selectedApplicant.resumeText && (
                  <section className={styles.reportSection} aria-labelledby="resume-summary-title">
                    <h3 id="resume-summary-title" className={styles.reportSectionTitle}>
                      Extracted resume summary
                    </h3>
                    <div className={styles.resumeBox}>{selectedApplicant.resumeText}</div>
                  </section>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setSelectedApplicant(null)}
                >
                  Close report
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
