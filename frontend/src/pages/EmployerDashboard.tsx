import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { VideoProctorTimeline } from '../components/VideoProctorTimeline'
import { Score } from '../components/Score'
import { handleDialogKeyDown, useDialogFocus } from '../components/useDialog'
import { getUser, type EmployerApplicant, type EmployerJob } from '../lib/store'
import { HrIcon } from '../components/HrIcon'
import { JobApplicantsPanel } from '../components/JobApplicantsPanel'
import { InviteCandidatesPanel } from '../components/InviteCandidatesPanel'
import { ApplicantsSearch } from '../components/applicants/ApplicantsSearch'
import { patchApplicantRows } from '../components/applicants/applicantJobs'
import { candidateScore } from '../lib/candidateSearch'
import { fetchMailStatus } from '../lib/api'
import { ensureApiSession } from '../lib/apiSession'
import { buildApplyUrl } from '../lib/jobLink'
import {
  filterJobSeekerCandidates,
  mapOrgCandidate,
  mapVendorApplicant,
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
import { readJobDescriptionFile } from '../lib/jobDescriptionImport'
import {
  createVendorJob,
  updateVendorJob,
  deleteVendorJob,
  markVendorJobDeletedForCandidates,
  fetchJobApplicants,
  fetchOrganizationCandidates,
  fetchVendorJobs,
  sendApplicantInterviewInvite,
  type EmployerApplicationAlert,
} from '../lib/vendorApi'
import { subscribeEmployerApplicationAlerts } from '../lib/employerAlertsFeed'
import { mapWithConcurrency } from '../lib/concurrency'
import { JobLifecycleActions, JobStatusBadge } from '../components/jobs/JobLifecycle'
import { jobEditPatch, validateJobEdit } from '../components/jobs/jobStatusRules'
import type { VendorJob } from '../lib/vendorApi'
import { StatTiles } from '../components/StatTiles'
import { jobApplicantStats } from '../lib/jobApplicantStats'
import styles from './EmployerDashboard.module.css'

/** Marks a create-job field that was filled from the uploaded job description (it stays editable). */
function FilledFromDocTag({ show }: { show: boolean }) {
  return show ? <span className={styles.filledTag}>From document · editable</span> : null
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

/** One error panel for a failed load, with a way to try again. Replaces the empty state. */
function LoadErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={`ds-alert ds-alert--error ${styles.loadError}`} role="alert">
      <span>{message}</span>
      <button type="button" className={`${styles.btnSecondary} ${styles.btnSm}`} onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

export function EmployerDashboard() {
  const location = useLocation()
  const navigate = useNavigate()
  // ?jobId= is how a job is opened. The applications search rewrites that to ?job= when filters change.
  const selectedJobId = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('jobId') || params.get('job') || ''
  }, [location.search])
  const showJobApplications = Boolean(selectedJobId) && location.pathname.startsWith('/employer/jobs')
  const isCandidatesView = showJobApplications

  useEffect(() => {
    if (location.hash === '#candidates' || location.hash === '#candidate-list') {
      const el = document.getElementById('candidates-section')
      el?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [location])

  const user = getUser()
  const [jobs, setJobs] = useState<EmployerJob[]>([])
  const [applicants, setApplicants] = useState<EmployerApplicant[]>([])
  const jobStats = useMemo(() => jobApplicantStats(applicants, selectedJobId), [applicants, selectedJobId])
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({})
  const [portalLoading, setPortalLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  // Modals
  // The dashboard's "Create job" links here with { createJob: true } so the modal is open on arrival.
  const [showCreateJobModal, setShowCreateJobModal] = useState(
    () => Boolean((location.state as { createJob?: boolean } | null)?.createJob),
  )
  const [creatingJob, setCreatingJob] = useState(false)
  const [createJobError, setCreateJobError] = useState('')
  // Edit job reuses the Create job dialog and its fields (incl. the document import), filled from the job.
  const [editingJob, setEditingJob] = useState<EmployerJob | null>(null)
  const [pendingDeleteJob, setPendingDeleteJob] = useState<EmployerJob | null>(null)
  const [deleteJobError, setDeleteJobError] = useState('')

  useEffect(() => {
    if (!(location.state as { createJob?: boolean } | null)?.createJob) return
    setShowCreateJobModal(true)
    // Drop the flag so a refresh or Back does not reopen the modal.
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])
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
  const [jobDocName, setJobDocName] = useState('')
  /** Presentation only: which create-job fields the last imported document filled (shown as tags). */
  const [jobDocFilled, setJobDocFilled] = useState<string[]>([])
  const [jobDocError, setJobDocError] = useState('')
  const [jobDocReading, setJobDocReading] = useState(false)
  const [jobDocDragging, setJobDocDragging] = useState(false)
  const jobDocInputRef = useRef<HTMLInputElement>(null)
  const [portalSyncNote, setPortalSyncNote] = useState('')
  const seenApplicationAlertIdsRef = useRef(new Set<string>())

  const [jobRosterOpen, setJobRosterOpen] = useState<{ jobId: string; title: string } | null>(
    null,
  )
  const [jobRosterLoading] = useState(false)
  const [jobRosterNotice, setJobRosterNotice] = useState('')
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

  // A new applicant starts with a clean invite form.
  const selectedApplicantId = selectedApplicant?.id
  useEffect(() => {
    setInviteStart('')
    setInviteDuration(60)
    setInviteFeedback('')
  }, [selectedApplicantId])

  /** Ignore in-flight job list fetches after optimistic create/delete. */
  const jobsLoadSeqRef = useRef(0)

  function bumpJobsLoadGeneration() {
    jobsLoadSeqRef.current += 1
  }

  async function refreshJobCountsForJobs(
    mapped: EmployerJob[],
    loadSeq: number,
    knownCounts: Record<string, number> = {},
  ) {
    const counts: Record<string, number> = {}
    const toFetch: EmployerJob[] = []
    for (const job of mapped) {
      if (isOptimisticJobId(job.id)) counts[job.id] = 0
      else if (typeof knownCounts[job.id] === 'number') counts[job.id] = knownCounts[job.id]
      else toFetch.push(job)
    }
    // Older APIs do not send applicantCount: fetch the missing counts, a few at a time instead of one by one.
    await mapWithConcurrency(toFetch, 4, async (job) => {
      if (loadSeq !== jobsLoadSeqRef.current) return
      try {
        const { total, applicants } = await fetchJobApplicants(job.id)
        counts[job.id] = total ?? applicants.length
      } catch {
        counts[job.id] = 0
      }
    })
    if (loadSeq !== jobsLoadSeqRef.current) return
    setJobCounts((prev) => ({ ...prev, ...counts }))
  }

  /** Loads the job list. Applicant counts are only needed on the Jobs page, not the candidate directory. */
  async function loadJobsFromApi({ withCounts }: { withCounts: boolean }) {
    if (!user || user.role !== 'employer') return
    const loadSeq = ++jobsLoadSeqRef.current
    const { jobs: remoteJobs } = await fetchVendorJobs()
    if (loadSeq !== jobsLoadSeqRef.current) return
    const mapped = remoteJobs.map((j) => vendorJobToEmployerJob(j, user.email))
    setJobs(mapped)
    if (!withCounts) return
    const knownCounts: Record<string, number> = {}
    for (const j of remoteJobs) {
      if (typeof j.applicantCount === 'number') knownCounts[j.id] = j.applicantCount
    }
    void refreshJobCountsForJobs(mapped, loadSeq, knownCounts)
  }

  async function loadOrgCandidatesFromApi(
    filters?: {
      name?: string
      job?: string
      keywords?: string
    },
    opts?: { background?: boolean },
  ) {
    const { candidates } = await fetchOrganizationCandidates({ ...filters, scope: 'org' }, opts)
    const jobSeekers = filterJobSeekerCandidates(candidates)
    setApplicants(jobSeekers.map((c) => normalizeApplicant(mapOrgCandidate(c))))
    // No "N profiles available" note: the list's own count says it, and on a job page the org-wide total was
    // misleading (24 shown above a job with 12 applicants). The note is kept for real outcomes (job saved/closed).
    setPortalSyncNote('')
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!user || user.role !== 'employer') return
      setPortalLoading(true)
      setLoadError('')
      try {
        // The session check is itself an API request, so no separate /api/health ping first.
        if (!(await ensureApiSession())) {
          throw new Error('Could not reach the server. Check your connection and try again.')
        }
        if (cancelled) return
        // Jobs (for the invite panel) and candidates load side by side on the directory.
        await Promise.all([
          loadJobsFromApi({ withCounts: !isCandidatesView }),
          isCandidatesView ? loadOrgCandidatesFromApi() : null,
        ])
      } catch (err) {
        if (!cancelled) {
          console.warn('[employer-dashboard] load failed', err)
          setLoadError(
            isCandidatesView
              ? 'We could not load your applicants. If the wait was long, the server may still be waking up — try again in a moment.'
              : 'We could not load your job openings. Check your connection and try again.',
          )
        }
      } finally {
        if (!cancelled) setPortalLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.role, isCandidatesView, reloadKey])

  useEffect(() => {
    if (!user || user.role !== 'employer') return
    let cancelled = false
    // The page's initial load already fetched every job's count and the roster, so the first batch
    // of alerts only marks what exists now; only alerts that arrive later trigger a refresh.
    let seeded = false

    async function onApplicationAlerts(alerts: EmployerApplicationAlert[]) {
      if (cancelled) return
      const fresh = alerts.filter((a) => !seenApplicationAlertIdsRef.current.has(a.id))
      fresh.forEach((a) => seenApplicationAlertIdsRef.current.add(a.id))
      if (!seeded) {
        seeded = true
        return
      }
      if (!fresh.length) return
      for (const jobId of new Set(fresh.map((a) => a.jobId))) {
        try {
          const { total, applicants: roster } = await fetchJobApplicants(jobId, { background: true })
          if (cancelled) return
          setJobCounts((prev) => ({ ...prev, [jobId]: total ?? roster.length }))
        } catch {
          /* ignore per-job refresh errors */
        }
      }
      if (isCandidatesView && !cancelled) {
        void loadOrgCandidatesFromApi(undefined, { background: true })
      }
    }

    // Shared with the nav bell: one request every 30 s for both.
    const unsubscribe = subscribeEmployerApplicationAlerts((alerts) => void onApplicationAlerts(alerts))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [user?.email, user?.role, isCandidatesView])

  const inviteJobs = useMemo(() => jobs.map((j) => ({ id: j.id, title: j.title })), [jobs])
  // "Invite to interview" (email interview links) opens in a dialog from the Applicants header.
  // The dashboard's "Send AI interview links" links here with { inviteDialog: true }: open it on arrival.
  const [showInviteDialog, setShowInviteDialog] = useState(
    () => Boolean((location.state as { inviteDialog?: boolean } | null)?.inviteDialog),
  )
  useEffect(() => {
    if (!(location.state as { inviteDialog?: boolean } | null)?.inviteDialog) return
    setShowInviteDialog(true)
    // Drop the flag (keep the search) so a refresh or Back does not reopen the dialog.
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, [location.state, location.pathname, location.search, navigate])
  const closeInviteDialog = useCallback(() => setShowInviteDialog(false), [])
  const inviteDialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(showInviteDialog, inviteDialogRef, 'field')
  const updateApplicant = useCallback((id: string, patch: Partial<EmployerApplicant>) => {
    setApplicants((prev) => patchApplicantRows(prev, id, patch))
  }, [])

  function openCreateJob() {
    setCreateJobError('')
    setJobDocError('')
    setShowCreateJobModal(true)
  }

  function closeCreateJob() {
    if (creatingJob || jobDocReading) return
    setShowCreateJobModal(false)
    setJobDocDragging(false)
    if (editingJob) {
      setEditingJob(null)
      resetJobForm()
    }
  }

  function resetJobForm() {
    setNewJobTitle('')
    setNewJobDescription('')
    setNewJobSkills('')
    setNewJobRoleTrack(DEFAULT_JOB_ROLE)
    setNewJobExp('3-5 years')
    setNewJobLocation('Hyderabad / Remote')
    setJobDocName('')
    setJobDocError('')
  }

  /** Open the job form on an existing job (from the jobs list or its applicants dialog). */
  function openEditJob(job: EmployerJob) {
    if (isOptimisticJobId(job.id) || creatingJob) return
    setJobRosterOpen(null)
    setEditingJob(job)
    setNewJobTitle(job.title)
    setNewJobRoleTrack(job.roleTrack || DEFAULT_JOB_ROLE)
    setNewJobExp(job.experienceLevel)
    setNewJobLocation(job.location)
    setNewJobDescription(job.jobDescription)
    setNewJobSkills(job.requiredSkills.join(', '))
    setJobDocName('')
    setJobDocError('')
    setCreateJobError('')
    setShowCreateJobModal(true)
  }

  async function handleEditJob(e: React.FormEvent) {
    e.preventDefault()
    const job = editingJob
    if (!job || creatingJob || jobDocReading) return
    const draft = {
      title: newJobTitle,
      roleTrack: newJobRoleTrack,
      experienceLevel: newJobExp,
      location: newJobLocation,
      jobDescription: newJobDescription,
      skills: newJobSkills,
    }
    const problem = validateJobEdit(draft)
    if (problem) {
      setCreateJobError(problem)
      return
    }
    const patch = jobEditPatch(job, draft)
    if (!Object.keys(patch).length) {
      setEditingJob(null)
      setShowCreateJobModal(false)
      resetJobForm()
      setPortalSyncNote('No changes to save.')
      return
    }
    setCreatingJob(true)
    setCreateJobError('')
    try {
      await ensureApiSession()
      const { job: saved, changed } = await updateVendorJob(job.id, patch)
      setEditingJob(null)
      setShowCreateJobModal(false)
      resetJobForm()
      applySavedJob(
        saved,
        changed.some((c) => c === 'jobDescription' || c === 'requiredSkills')
          ? `“${saved.title}” saved. New interviews use the updated description; completed interviews keep their questions.`
          : `“${saved.title}” saved.`,
      )
    } catch (err) {
      setCreateJobError(
        err instanceof Error && err.message ? `The job was not saved. ${err.message}` : 'The job was not saved. Please try again.',
      )
    } finally {
      setCreatingJob(false)
    }
  }

  function applyImportedJob(fileName: string, draft: Awaited<ReturnType<typeof readJobDescriptionFile>>) {
    setJobDocFilled(
      [
        draft.title ? 'title' : '',
        draft.location ? 'location' : '',
        draft.experienceLevel ? 'experience' : '',
        draft.skills.length ? 'skills' : '',
        draft.description ? 'description' : '',
      ].filter(Boolean),
    )
    if (draft.title) setNewJobTitle(draft.title)
    if (draft.location) setNewJobLocation(draft.location)
    if (draft.experienceLevel) setNewJobExp(draft.experienceLevel)
    if (draft.skills.length) setNewJobSkills(draft.skills.join(', '))
    setNewJobDescription(draft.description)
    const suggested = suggestRoleFromTitle(draft.title)
    if (suggested) setNewJobRoleTrack(suggested)
    setJobDocName(fileName)
    setJobDocError('')
  }

  async function importJobDocument(file: File | undefined) {
    if (!file || jobDocReading || creatingJob) return
    setJobDocReading(true)
    setJobDocError('')
    setJobDocName(file.name)
    try {
      applyImportedJob(file.name, await readJobDescriptionFile(file))
    } catch (err) {
      setJobDocName('')
      setJobDocError(err instanceof Error ? err.message : 'Could not read that document.')
    } finally {
      setJobDocReading(false)
      if (jobDocInputRef.current) jobDocInputRef.current.value = ''
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault()
    if (creatingJob) return
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

    setCreatingJob(true)
    setCreateJobError('')
    bumpJobsLoadGeneration()
    setJobs((prev) => [optimisticJob, ...prev])
    setJobCounts((prev) => ({ ...prev, [optimisticId]: 0 }))
    setPortalSyncNote(`Creating “${title}”…`)

    try {
      await ensureApiSession()
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
      setJobDocName('')
      setJobDocError('')
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
      setCreateJobError(
        err instanceof Error && err.message
          ? `The job was not created. ${err.message}`
          : 'The job was not created. Please try again.',
      )
    } finally {
      setCreatingJob(false)
    }
  }

  function requestDeleteJob(job: EmployerJob) {
    if (isOptimisticJobId(job.id) || deletingJobId) return
    setDeleteJobError('')
    setPendingDeleteJob(job)
  }

  function closeDeleteJob() {
    if (deletingJobId) return
    setPendingDeleteJob(null)
  }

  async function handleDeleteJob(job: EmployerJob) {
    if (isOptimisticJobId(job.id) || deletingJobId) return
    setDeletingJobId(job.id)
    setDeleteJobError('')
    setPortalSyncNote('')

    try {
      await ensureApiSession()
      await markVendorJobDeletedForCandidates(job.id)
      await deleteVendorJob(job.id)

      bumpJobsLoadGeneration()
      setJobs((prev) => prev.filter((j) => j.id !== job.id))
      setJobCounts((prev) => {
        const next = { ...prev }
        delete next[job.id]
        return next
      })
      setApplicants((prev) => prev.filter((a) => a.jobId !== job.id))
      setPendingDeleteJob(null)
      setPortalSyncNote(`Job “${job.title}” was deleted.`)
    } catch (err) {
      console.warn('[employer-dashboard] delete job failed', err)
      setDeleteJobError(
        err instanceof Error && err.message
          ? `The job was not deleted. ${err.message}`
          : 'The job was not deleted. Please try again.',
      )
    } finally {
      setDeletingJobId(null)
    }
  }

  /* While a job's applicant list is open, refresh it quietly so an interview a candidate just finished shows its
     report, score and rank without reopening the list. */
  const openRosterJobId = jobRosterOpen?.jobId
  useEffect(() => {
    if (!openRosterJobId) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void fetchJobApplicants(openRosterJobId, { background: true })
        .then(({ applicants, total }) => {
          if (cancelled) return
          setJobRosterRows(applicants.map((a) => normalizeApplicant(mapVendorApplicant(a))))
          setJobCounts((prev) => ({ ...prev, [openRosterJobId]: total ?? applicants.length }))
        })
        .catch(() => {
          /* keep the rows already shown */
        })
    }, 20_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [openRosterJobId])

  function openJobApplicantsRoster(job: EmployerJob) {
    if (isOptimisticJobId(job.id)) return
    navigate({ pathname: '/employer/jobs', search: `?jobId=${encodeURIComponent(job.id)}` })
  }

  /** A job saved by Edit / Close / Reopen / Unpublish: replace it in the list and say what happened. */
  function applySavedJob(saved: VendorJob, notice: string) {
    bumpJobsLoadGeneration()
    setJobs((prev) =>
      prev.map((j) => (j.id === saved.id ? vendorJobToEmployerJob(saved, j.createdByEmail || user?.email || '') : j)),
    )
    if (typeof saved.applicantCount === 'number') {
      setJobCounts((prev) => ({ ...prev, [saved.id]: saved.applicantCount as number }))
    }
    setJobRosterOpen((open) => (open && open.jobId === saved.id ? { ...open, title: saved.title } : open))
    setPortalSyncNote(notice)
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
    const start = new Date(inviteStart)
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 60_000) {
      setInviteFeedback('Choose a start time in the future.')
      return
    }
    if (!(inviteDuration >= 15 && inviteDuration <= 180)) {
      setInviteFeedback('Duration must be between 15 and 180 minutes.')
      return
    }
    if (inviteLoading) return
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


  const createJobDialogRef = useRef<HTMLFormElement>(null)
  const rosterDialogRef = useRef<HTMLDivElement>(null)
  const reportDialogRef = useRef<HTMLDivElement>(null)
  const deleteDialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(showCreateJobModal, createJobDialogRef, 'field')
  useDialogFocus(Boolean(pendingDeleteJob), deleteDialogRef)
  useDialogFocus(Boolean(jobRosterOpen), rosterDialogRef)
  useDialogFocus(Boolean(selectedApplicant), reportDialogRef)

  const companyName = user?.companyName || 'Your organisation'
  const descLength = newJobDescription.trim().length

  return (
    <div className={styles.pageBleed}>
    <div className={styles.page}>
      <div className={styles.shell}>
        {isCandidatesView ? (
          <header className={styles.pageHeader}>
            <div>
              <button type="button" className={styles.backLink} onClick={() => navigate('/employer/jobs')}>
                ← All jobs
              </button>
              <h1 className={styles.pageTitle}>
                {jobs.find((j) => j.id === selectedJobId)?.title ?? 'Applications'}
                {jobs.some((j) => j.id === selectedJobId) ? (
                  <JobStatusBadge inline status={jobs.find((j) => j.id === selectedJobId)?.status} />
                ) : null}
              </h1>
              <p className={styles.pageSub}>Everyone who applied to this job, with their interview results.</p>
              {portalSyncNote && !loadError ? (
                <p className={styles.syncNote} role="status">
                  {portalSyncNote}
                </p>
              ) : null}
            </div>
            <div className={styles.pageActions}>
              {(() => {
                const openJob = jobs.find((j) => j.id === selectedJobId)
                return openJob ? (
                  <JobLifecycleActions
                    job={openJob}
                    compact={false}
                    onEdit={openEditJob}
                    onChanged={(saved) => applySavedJob(saved, '')}
                    onNotice={(text) => setPortalSyncNote(text)}
                  />
                ) : null
              })()}
              <button type="button" className={styles.btnPrimary} onClick={() => setShowInviteDialog(true)}>
                <HrIcon name="calendar" size={16} /> Invite to interview
              </button>
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
              {jobs.length > 0 || portalLoading || loadError ? (
                <div className={styles.pageActions}>
                  <button type="button" className={styles.btnPrimary} onClick={openCreateJob}>
                    <HrIcon name="plus" size={16} /> Create job
                  </button>
                </div>
              ) : null}
            </header>

            {portalSyncNote && !loadError && (
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
                  {loadError ? null : (
                    <p className={styles.panelSub}>
                      {portalLoading && jobs.length === 0
                        ? 'Loading your openings…'
                        : `${jobs.length} opening${jobs.length === 1 ? '' : 's'} · each has its own apply link`}
                    </p>
                  )}
                </div>
              </div>

              {loadError && !portalLoading ? (
                <LoadErrorPanel message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
              ) : null}

              {jobs.length === 0 && portalLoading && (
                <div className={styles.jobsSkeleton} role="status" aria-label="Loading job openings">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={styles.jobSkeletonCard}>
                      <span className={`ds-skeleton ds-skeleton-line ${styles.jobSkeletonWide}`} />
                      <span className={`ds-skeleton ds-skeleton-line ${styles.jobSkeletonNarrow}`} />
                    </div>
                  ))}
                </div>
              )}

              {jobs.length === 0 && !portalLoading && !loadError && (
                <div className={`ds-empty ${styles.jobsEmpty}`}>
                  <span className="ds-empty__icon" aria-hidden="true">
                    <HrIcon name="briefcase" size={20} />
                  </span>
                  <p className="ds-empty__title">No job openings yet</p>
                  <p className="ds-empty__body">Create an opening and share the link with candidates.</p>
                  <div className="ds-empty__actions">
                    <button type="button" className={styles.btnPrimary} onClick={openCreateJob}>
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
                        <th scope="col" className={styles.numCol}>
                          Created
                        </th>
                        <th scope="col">
                          <span className="ds-sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => {
                        const count = jobCounts[job.id] ?? 0
                        const isCopied = copiedCode === job.shareableCode
                        const isPending = isOptimisticJobId(job.id)
                        const isDeleting = deletingJobId === job.id
                        const rowClass = [
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
                              {isPending ? null : <JobStatusBadge status={job.status} />}
                              <div className={styles.jobMeta}>
                                <span>{job.roleTrack}</span>
                                <span className={styles.jobMetaSep} aria-hidden="true">·</span>
                                <span>{job.experienceLevel}</span>
                                <span className={styles.jobMetaSep} aria-hidden="true">·</span>
                                <span>{job.location}</span>
                              </div>
                            </td>
                            <td data-label="Apply link">
                              <button
                                type="button"
                                className={`${styles.copyBtn} ${isCopied ? styles.copyBtnDone : ''}`}
                                disabled={isPending || isDeleting}
                                onClick={() => handleCopyLink(job)}
                                aria-label={`Copy apply link for ${job.title}`}
                                title={isPending ? 'Generating the apply link…' : buildApplyUrl(job.company, job.shareableCode)}
                              >
                                <HrIcon name={isCopied ? 'check' : 'link'} size={14} />
                                {isPending ? 'Generating…' : isCopied ? 'Copied' : 'Copy link'}
                              </button>
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
                            <td data-label="Created" className={styles.numCol}>
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
                              {/* One clear row action; Edit, status moves and Delete sit in the "⋯" menu. */}
                              {isPending ? null : (
                                <JobLifecycleActions
                                  job={job}
                                  variant="menu"
                                  disabled={isDeleting}
                                  deleting={isDeleting}
                                  onEdit={openEditJob}
                                  onDelete={requestDeleteJob}
                                  onChanged={(saved) => applySavedJob(saved, '')}
                                  onNotice={(text) => setPortalSyncNote(text)}
                                />
                              )}
                              {isDeleting ? (
                                <span className={styles.mutedCell} role="status">
                                  Deleting…
                                </span>
                              ) : null}
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

        {isCandidatesView && (
          <>
            {!loadError ? (
              <StatTiles
                stats={jobStats}
                label="Numbers for this job"
                totalLabel="Total applicants"
                totalHint="Applied to this job"
                loading={portalLoading && applicants.length === 0}
              />
            ) : null}
            <ApplicantsSearch
              mode="applications"
              applicants={applicants}
              jobs={inviteJobs}
              loading={portalLoading}
              error={loadError}
              onRetry={() => setReloadKey((k) => k + 1)}
              onUpdateApplicant={updateApplicant}
              onInviteByEmail={() => setShowInviteDialog(true)}
              savedStorageKey={user?.email ? `hireright.applicants.saved.${user.email.toLowerCase()}` : undefined}
            />
          </>
        )}

        {showInviteDialog && (
          <div
            className={styles.modalOverlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-dialog-title"
            onKeyDown={(e) => handleDialogKeyDown(e, closeInviteDialog)}
          >
            <div ref={inviteDialogRef} tabIndex={-1} className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <h2 id="invite-dialog-title">Invite to interview</h2>
                  <p className={styles.modalSub}>Email people a link that opens their AI interview directly.</p>
                </div>
                <button type="button" className={styles.closeBtn} onClick={closeInviteDialog} aria-label="Close">
                  <HrIcon name="close" size={16} />
                </button>
              </div>
              <div className={styles.modalBody}>
                <InviteCandidatesPanel jobs={inviteJobs} embedded defaultJobId={selectedJobId || undefined} />
              </div>
            </div>
          </div>
        )}

        {/* Create job modal */}
        {showCreateJobModal && (
          <div
            className={styles.modalOverlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-job-title"
            onKeyDown={(e) => handleDialogKeyDown(e, closeCreateJob)}
          >
            <form
              ref={createJobDialogRef}
              tabIndex={-1}
              className={`${styles.modal} ${styles.modalLg}`}
              onSubmit={editingJob ? handleEditJob : handleCreateJob}
            >
              <div className={styles.modalHeader}>
                <div>
                  <h2 id="create-job-title">{editingJob ? 'Edit job' : 'Create job'}</h2>
                  {editingJob ? (
                    <p className={styles.modalSub}>
                      Changes apply to new interviews. Interviews already completed keep the questions they were
                      asked. The apply link stays the same.
                    </p>
                  ) : (
                  <p className={styles.modalSub}>
                    Upload a PDF or Word file, or fill the fields below. Applicants get an AI interview based
                    on this description and their resume.
                  </p>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={closeCreateJob}
                  aria-label="Close"
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div className={styles.modalBody}>
                <div
                    className={`${styles.jdDrop} ${jobDocDragging ? styles.jdDropDragging : ''} ${
                      jobDocReading ? styles.jdDropBusy : ''
                    } ${jobDocName && !jobDocError && !jobDocReading ? styles.jdDropDone : ''}`}
                    aria-busy={jobDocReading || undefined}
                    onDragEnter={(e) => {
                      e.preventDefault()
                      setJobDocDragging(true)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setJobDocDragging(true)
                    }}
                    onDragLeave={() => setJobDocDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setJobDocDragging(false)
                      void importJobDocument(e.dataTransfer.files?.[0])
                    }}
                  >
                    <span className={styles.jdIcon} aria-hidden="true">
                      {jobDocReading ? <span className="ds-spinner" /> : <HrIcon name="upload" size={20} />}
                    </span>
                    <strong>{jobDocReading ? 'Reading the document…' : 'Drop a PDF or Word file'}</strong>
                    <span>Selectable text only. Scanned images are not read.</span>
                    <input
                      ref={jobDocInputRef}
                      id="employer-job-document"
                      className={styles.jdFileInput}
                      type="file"
                      aria-label="Job description PDF or Word file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      tabIndex={-1}
                      onChange={(e) => void importJobDocument(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      className={`${styles.btnSecondary} ${styles.btnSm}`}
                      disabled={jobDocReading || creatingJob}
                      onClick={() => jobDocInputRef.current?.click()}
                    >
                      Choose file
                    </button>
                    {jobDocName && !jobDocError && !jobDocReading ? (
                      <p className={styles.jdNote} role="status">
                        <HrIcon name="check" size={16} />
                        <span>
                          Filled from <strong>{jobDocName}</strong>. Check the details below, then{' '}
                          {editingJob ? 'save the changes' : 'create the job'}.
                        </span>
                      </p>
                    ) : null}
                    {jobDocError ? (
                      <p className={`ds-alert ds-alert--error ${styles.modalError}`} role="alert">
                        {jobDocError}
                      </p>
                    ) : null}
                  </div>

                <section className={styles.formSection} aria-labelledby="create-job-role">
                  <h3 id="create-job-role" className={styles.formSectionTitle}>Role</h3>
                <div className={styles.formGroup}>
                  <label htmlFor="employer-job-title">
                    Job title <FilledFromDocTag show={Boolean(jobDocName) && !jobDocError && !jobDocReading && jobDocFilled.includes('title')} />
                  </label>
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
                      {editingJob && !JOB_ROLE_GROUPS.some((g) => g.roles.includes(newJobRoleTrack)) ? (
                        <option value={newJobRoleTrack}>{newJobRoleTrack}</option>
                      ) : null}
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
                    <label htmlFor="employer-job-experience">
                      Years of experience <FilledFromDocTag show={Boolean(jobDocName) && !jobDocError && !jobDocReading && jobDocFilled.includes('experience')} />
                    </label>
                    <select
                      id="employer-job-experience"
                      required
                      value={newJobExp}
                      onChange={(e) => setNewJobExp(e.target.value)}
                    >
                      {editingJob && !['0-2 years', '3-5 years', '6+ years'].includes(newJobExp) ? (
                        <option value={newJobExp}>{newJobExp || 'Choose…'}</option>
                      ) : null}
                      <option value="0-2 years">0-2 years (Junior)</option>
                      <option value="3-5 years">3-5 years (Mid-Level)</option>
                      <option value="6+ years">6+ years (Senior / Lead)</option>
                    </select>
                  </div>
                </div>

                <div className={`${styles.formGroup} ${styles.formGroupLast}`}>
                  <label htmlFor="employer-job-location">
                    Location <FilledFromDocTag show={Boolean(jobDocName) && !jobDocError && !jobDocReading && jobDocFilled.includes('location')} />
                  </label>
                  <input
                    id="employer-job-location"
                    type="text"
                    required
                    placeholder="Hyderabad / Remote"
                    value={newJobLocation}
                    onChange={(e) => setNewJobLocation(e.target.value)}
                  />
                </div>
                </section>

                <section className={styles.formSection} aria-labelledby="create-job-description-heading">
                  <h3 id="create-job-description-heading" className={styles.formSectionTitle}>Description</h3>
                <div className={`${styles.formGroup} ${styles.formGroupLast}`}>
                  <label htmlFor="employer-job-description">
                    Job description <FilledFromDocTag show={Boolean(jobDocName) && !jobDocError && !jobDocReading && jobDocFilled.includes('description')} />
                  </label>
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
                    className={`${styles.fieldHint} ${styles.fieldHintCounter} ${descLength >= 30 ? styles.fieldHintOk : ''}`}
                  >
                    {descLength >= 30
                      ? `${descLength} characters`
                      : `At least 30 characters (${descLength}/30)`}
                  </span>
                </div>
                </section>

                <section className={styles.formSection} aria-labelledby="create-job-skills-heading">
                  <h3 id="create-job-skills-heading" className={styles.formSectionTitle}>Skills</h3>
                <div className={`${styles.formGroup} ${styles.formGroupLast}`}>
                  <label htmlFor="employer-job-skills">
                    Required skills <span className={styles.optionalText}>(optional)</span>{' '}
                    <FilledFromDocTag
                      show={Boolean(jobDocName) && !jobDocError && !jobDocReading && jobDocFilled.includes('skills')}
                    />
                  </label>
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
                </section>

                {createJobError ? (
                  <p className={`ds-alert ds-alert--error ${styles.modalError}`} role="alert">
                    {createJobError}
                  </p>
                ) : null}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={closeCreateJob}
                  disabled={creatingJob || jobDocReading}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={creatingJob || jobDocReading} aria-busy={creatingJob}>
                  {editingJob ? (creatingJob ? 'Saving…' : 'Save changes') : creatingJob ? 'Creating…' : 'Create job'}
                </button>
              </div>
            </form>
          </div>
        )}

        {pendingDeleteJob && (
          <div
            className={styles.modalOverlay}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-job-title"
            aria-describedby="delete-job-body"
            onKeyDown={(e) => handleDialogKeyDown(e, closeDeleteJob)}
          >
            <div ref={deleteDialogRef} tabIndex={-1} className={`${styles.modal} ${styles.modalSm}`}>
              <div className={styles.modalHeader}>
                <h2 id="delete-job-title">Delete “{pendingDeleteJob.title}”?</h2>
              </div>
              <div className={styles.modalBody}>
                <p id="delete-job-body" className={styles.modalSub}>
                  This removes the opening from your account. Its apply link stops working for candidates.
                </p>
                {deleteJobError ? (
                  <p className={`ds-alert ds-alert--error ${styles.modalError}`} role="alert">
                    {deleteJobError}
                  </p>
                ) : null}
              </div>
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={closeDeleteJob}
                  disabled={Boolean(deletingJobId)}
                  data-autofocus
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.btnDanger}
                  disabled={Boolean(deletingJobId)}
                  aria-busy={Boolean(deletingJobId)}
                  onClick={() => void handleDeleteJob(pendingDeleteJob)}
                >
                  {deletingJobId ? 'Deleting…' : 'Delete job'}
                </button>
              </div>
            </div>
          </div>
        )}

        {jobRosterOpen && (
          <div
            className={styles.modalOverlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-roster-title"
            onKeyDown={(e) =>
              handleDialogKeyDown(e, closeJobApplicantsRoster, Boolean(selectedApplicant || documentViewer))
            }
          >
            <div ref={rosterDialogRef} tabIndex={-1} className={`${styles.modal} ${styles.modalWide}`}>
              <div className={styles.modalHeader}>
                <div>
                  <h2 id="job-roster-title">
                    Applicants · {jobRosterOpen.title}
                    <JobStatusBadge inline status={jobs.find((j) => j.id === jobRosterOpen.jobId)?.status} />
                  </h2>
                  <p className={styles.modalSub}>
                    Everyone who applied from the job board or your shared link, scored against this job.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={closeJobApplicantsRoster}
                  aria-label="Close"
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div className={styles.modalBody}>
                {jobRosterNotice ? (
                  <p className={styles.syncNote} role="status">
                    {jobRosterNotice}
                  </p>
                ) : null}
                <JobApplicantsPanel
                  rows={jobRosterRows}
                  loading={jobRosterLoading}
                  onViewDocument={(kind, applicant) => setDocumentViewer({ kind, applicant })}
                  onOpenApplicant={(applicant) => setSelectedApplicant(applicant)}
                />
              </div>

              <div className={styles.modalFooter}>
                {(() => {
                  const rosterJob = jobs.find((j) => j.id === jobRosterOpen.jobId)
                  return rosterJob ? (
                    <JobLifecycleActions
                      job={rosterJob}
                      compact={false}
                      onEdit={openEditJob}
                      onChanged={(saved) => applySavedJob(saved, '')}
                      onNotice={(text) => {
                        setJobRosterNotice(text)
                        setPortalSyncNote(text)
                      }}
                    />
                  ) : null
                })()}
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
            onKeyDown={(e) => handleDialogKeyDown(e, () => setSelectedApplicant(null), Boolean(documentViewer))}
          >
            <div ref={reportDialogRef} tabIndex={-1} className={`${styles.modal} ${styles.modalReport}`}>
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
                  aria-label="Close"
                >
                  <HrIcon name="close" size={16} />
                </button>
              </div>

              <div className={styles.modalBody}>
                <section className={styles.summaryGrid} aria-label="Summary">
                  <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>Interview score</span>
                    <span className={styles.summaryValue}>
                      {candidateScore(selectedApplicant) !== null ? (
                        <Score value={candidateScore(selectedApplicant)!} label="Interview score" size="lg" />
                      ) : (
                        '—'
                      )}
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
                    <span className={`${styles.summaryLabel} ${styles.summaryLabelSpaced}`}>
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
                      // aria-disabled, not disabled: a disabled button drops focus to <body>, and Esc then no
                      // longer reached the dialog (it stayed open). handleSendInterviewInvite ignores repeat clicks.
                      aria-disabled={inviteLoading}
                      aria-busy={inviteLoading}
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
                        Overall interview score{' '}
                        {selectedApplicant.interviewResult.overall != null
                          ? `${selectedApplicant.interviewResult.overall}/100`
                          : '—'}
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
                                Score <strong>{ans.score}/100</strong>
                              </span>
                              <span>
                                Words <strong>{ans.wordCount}</strong>
                              </span>
                              <span>
                                Keywords <strong>{ans.keywordsHit?.join(', ') || '—'}</strong>
                              </span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    <div className={styles.proctorTimeline}>
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
                  Close
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
