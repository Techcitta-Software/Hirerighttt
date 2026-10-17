import { useEffect, useMemo, useState } from 'react'
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
  fetchJobCandidatesRoster,
  fetchOrganizationCandidates,
  fetchVendorJobs,
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
  const [showSearchPanel, setShowSearchPanel] = useState(false)

  // New Job Form State
  const [newJobTitle, setNewJobTitle] = useState('')
  const [newJobRoleTrack, setNewJobRoleTrack] = useState('Frontend Developer')
  const [newJobExp, setNewJobExp] = useState('3-5 years')
  const [newJobLocation, setNewJobLocation] = useState('Hyderabad / Remote')
  const [newJobDescription, setNewJobDescription] = useState('')
  const [newJobSkills, setNewJobSkills] = useState('React, TypeScript, Node.js')
  const [jobFormError, setJobFormError] = useState('')
  const [portalSyncNote, setPortalSyncNote] = useState('')

  const [inviteStart, setInviteStart] = useState('')
  const [inviteDuration, setInviteDuration] = useState(60)
  const [inviteFeedback, setInviteFeedback] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)

  // Advanced Search Candidates Query (Image 2)
  const [candidateSearchQuery, setCandidateSearchQuery] = useState<CandidateSearchQuery | null>(null)

  async function loadJobsFromApi() {
    if (!user || user.role !== 'employer') return
    const online = await apiHealth()
    if (!online) {
      setPortalError('API is offline. Start the backend (npm run dev:all) to load jobs from the database.')
      setJobs([])
      return
    }
    const sessionOk = await ensureApiSession()
    if (!sessionOk) {
      setPortalError('Could not authenticate with the API. Sign in again as an employer.')
      setJobs([])
      return
    }
    const { jobs: remoteJobs } = await fetchVendorJobs()
    const mapped = remoteJobs.map((j) => vendorJobToEmployerJob(j, user.email))
    setJobs(mapped)
    const counts: Record<string, number> = {}
    await Promise.all(
      mapped.map(async (job) => {
        try {
          const { total } = await fetchJobCandidatesRoster(job.id)
          counts[job.id] = total
        } catch {
          counts[job.id] = 0
        }
      }),
    )
    setJobCounts(counts)
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

  async function loadJobCandidatesFromApi(jobId: string) {
    const { candidates, job } = await fetchJobCandidatesRoster(jobId)
    const jobSeekers = filterJobSeekerCandidates(candidates)
    setApplicants(jobSeekers.map((c) => normalizeApplicant(mapOrgCandidate(c))))
    setSelectedJobId(jobId)
    setSelectedJobTitle(job.title)
    setPortalSyncNote(`${jobSeekers.length} job seeker(s) for “${job.title}” from the database.`)
    setPortalError('')
    setJobCounts((prev) => ({ ...prev, [jobId]: jobSeekers.length }))
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
        } else {
          setApplicants([])
          setSelectedJobId(null)
          setSelectedJobTitle('')
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

  async function runServerCandidateSearch(query: CandidateSearchQuery) {
    const keywords = query.keywords
      .filter((k) => query.allMandatory || k.isMandatory)
      .map((k) => k.text)
      .join(', ')
    try {
      setPortalLoading(true)
      await ensureApiSession()
      await loadOrgCandidatesFromApi({
        name: query.candidateName.trim() || undefined,
        job: query.client.trim() || undefined,
        keywords: keywords || undefined,
      })
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Candidate search failed.')
    } finally {
      setPortalLoading(false)
    }
  }

  const showCandidateTable = isCandidatesView || Boolean(selectedJobId)

  function handleClearFilters() {
    setSearchFilter('')
    setRoleFilter('')
    setJobFilter('')
    setExpFilter('')
    setScoreFilter('')
    setIntegrityFilter('')
    setStatusFilter('')
    setCandidateSearchQuery(null)
  }

  const filteredApplicants = useMemo(() => {
    return applicants.filter((app) => {
      // Image 2 Search Candidates Panel filters
      if (candidateSearchQuery) {
        if (candidateSearchQuery.candidateName.trim()) {
          const q = candidateSearchQuery.candidateName.trim().toLowerCase()
          const match =
            app.candidateName.toLowerCase().includes(q) ||
            app.candidateEmail.toLowerCase().includes(q)
          if (!match) return false
        }

        if (candidateSearchQuery.client.trim()) {
          const q = candidateSearchQuery.client.trim().toLowerCase()
          if (!String(app.company ?? '').toLowerCase().includes(q)) return false
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
    if (!newJobTitle.trim() || jd.length < 30) {
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

    try {
      await ensureApiSession()
      if (!(await apiHealth())) {
        setJobFormError('API is offline. Start the backend to create jobs in the database.')
        return
      }
      const { job } = await createVendorJob({
        title: newJobTitle.trim(),
        jobDescription: jd,
        roleTrack: newJobRoleTrack,
        experienceLevel: newJobExp,
        location: newJobLocation.trim(),
        requiredSkills,
        company,
      })
      const created = vendorJobToEmployerJob(job, createdByEmail)
      setJobs([created, ...jobs])
      setJobCounts((prev) => ({ ...prev, [created.id]: 0 }))
      setShowCreateJobModal(false)
      setNewJobTitle('')
      setNewJobDescription('')
      setNewJobSkills('React, TypeScript, Node.js')
      setPortalSyncNote(`Job “${created.title}” saved to the database. Share the link to collect applicants.`)
    } catch (err) {
      setJobFormError(err instanceof Error ? err.message : 'Could not create job in the database.')
    }
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
          <motion.div className={styles.heroCard} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className={styles.heroTitle}>Search HireRight candidates</h1>
            <p className={styles.heroDesc}>
              Everyone here comes from your database — applicants, shared interviews, and job seekers
              who completed an AI interview on HireRight.
            </p>
          </motion.div>
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

                  return (
                    <div
                      key={job.id}
                      className={`${styles.jobCard} ${isSelected ? styles.jobCardSelected : ''}`}
                    >
                      <div>
                        <h4 className={styles.jobCardTitle}>{job.title}</h4>
                        <div className={styles.jobCardMeta}>
                          <span className={styles.metaBadge}>{job.roleTrack}</span>
                          <span className={styles.metaBadge}>{job.experienceLevel}</span>
                          <span className={styles.metaBadge}>{job.location}</span>
                        </div>

                        <div className={styles.linkBox}>
                          <span className={styles.linkUrl}>
                            {buildApplyUrl(job.company, job.shareableCode)}
                          </span>
                          <button
                            type="button"
                            className={styles.copyBtn}
                            onClick={() => handleCopyLink(job)}
                          >
                            {isCopied ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      </div>

                      <div className={styles.jobFooter}>
                        <span>{count} in roster</span>
                        <button
                          type="button"
                          className={styles.inspectBtn}
                          onClick={() => void loadJobCandidatesFromApi(job.id)}
                        >
                          View interviews →
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>

            {selectedJobId && (
              <p className={styles.portalSyncNote}>
                Showing candidates for <strong>{selectedJobTitle}</strong>.{' '}
                <button
                  type="button"
                  className={styles.filterClearBtn}
                  onClick={() => {
                    setSelectedJobId(null)
                    setSelectedJobTitle('')
                    setApplicants([])
                    setPortalSyncNote('')
                  }}
                >
                  Clear job filter
                </button>
              </p>
            )}

            {portalSyncNote && (
              <p className={styles.portalSyncNote} role="status">
                {portalSyncNote}
              </p>
            )}
          </>
        )}

        {isCandidatesView && (
          <div className={styles.centerSearchBtnRow}>
            <button
              type="button"
              className={`${styles.centerSearchBtn} ${showSearchPanel ? styles.centerSearchBtnActive : ''}`}
              onClick={() => setShowSearchPanel((prev) => !prev)}
              title={showSearchPanel ? 'Hide search candidates panel' : 'Open search candidates panel'}
            >
              <HrIcon name="search" size={14} /> Search candidates
            </button>
          </div>
        )}

        {isCandidatesView && showSearchPanel && (
          <SearchCandidatesPanel
            onClose={() => setShowSearchPanel(false)}
            onSearch={(query) => {
              setCandidateSearchQuery(query)
              if (query.candidateName) {
                setSearchFilter(query.candidateName)
              }
              void runServerCandidateSearch(query)
              setShowSearchPanel(false)
            }}
            onClear={() => {
              setCandidateSearchQuery(null)
            }}
          />
        )}

        {showCandidateTable && (
        <>
        {/* IN BETWEEN: All-Column Search & Filter Row */}
        <motion.div
          className={styles.filterBarCard}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.04 }}
        >
          {/* Candidate Search (Name, Email, Phone) */}
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <HrIcon name="search" size={15} />
            </span>
            <input
              type="text"
              className={styles.filterSearchInput}
              placeholder="Search name, email or phone..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>

          {/* Role Search */}
          <input
            type="text"
            className={styles.filterColInput}
            placeholder="Search role..."
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          />

          {/* Target Job Search */}
          <input
            type="text"
            className={styles.filterColInput}
            placeholder="Search job..."
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
          />

          {/* Experience Search */}
          <input
            type="text"
            className={styles.filterColInput}
            placeholder="Search experience..."
            value={expFilter}
            onChange={(e) => setExpFilter(e.target.value)}
          />

          {/* AI Score Search */}
          <input
            type="text"
            className={styles.filterColInput}
            placeholder="Search score..."
            value={scoreFilter}
            onChange={(e) => setScoreFilter(e.target.value)}
          />

          {/* Integrity Search */}
          <input
            type="text"
            className={styles.filterColInput}
            placeholder="Search integrity..."
            value={integrityFilter}
            onChange={(e) => setIntegrityFilter(e.target.value)}
          />

          {/* Status Search */}
          <input
            type="text"
            className={styles.filterColInput}
            placeholder="Search status..."
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />

          {/* Clear Filters Button if any active */}
          {(searchFilter || roleFilter || jobFilter || expFilter || scoreFilter || integrityFilter || statusFilter) && (
            <button
              type="button"
              className={styles.filterClearBtn}
              onClick={handleClearFilters}
              title="Clear all filters"
            >
              <HrIcon name="close" size={13} /> Clear
            </button>
          )}
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
                      <th style={{ width: '26%' }}>NAME</th>
                      <th style={{ width: '18%' }}>ROLE</th>
                      <th style={{ width: '14%' }}>EXPERIENCE</th>
                      <th style={{ width: '20%' }}>RESUME</th>
                      <th style={{ width: '22%' }}>REPORT ON HIRERIGHTTT</th>
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
                    <VideoProctorTimeline logs={selectedApplicant.interviewResult.integrity?.logs} />
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
