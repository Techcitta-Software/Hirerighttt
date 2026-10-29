import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { fadeUp, staggerContainer } from '../motion/variants'
import {
  addNotification,

  firstName,
  getApplications,
  getInterviewResult,
  type Application,
  type InterviewResult,
  getProfile,
  getUser,
  markNotificationsReadWhere,
  rankPostedJobs,
  resolveInterviewOverall,
  saveApplications,
  profileKey,
  interviewResultKey,

} from '../lib/store'
import { pullInterviewFromApi, pullProfileFromApi, syncSessionFromApi } from '../lib/apiSync'
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
import { syncJobMatchNotifications } from '../lib/jobMatchNotifications'
import { slugifyCompany } from '../lib/jobLink'
import { HrIcon } from '../components/HrIcon'
import styles from './AppPages.module.css'

export { DashboardPage } from './CandidateDashboard'

/** Full scorecard + PDF download (`/dashboard/report`). */
function formatProfileDate(value?: string) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

export function InterviewReportPage() {
  const user = getUser()
  const [interview, setInterview] = useState<InterviewResult | null>(() => getInterviewResult())
  const [profile, setProfile] = useState(() => getProfile())
  const [reportLoading, setReportLoading] = useState(true)
  const name = firstName()

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
    void downloadScorecardPdf(user?.name || profile?.fullName || name).catch(() => {
      /* user can click Download report on the page */
    })
  }, [interview, autoDownloadDone, searchParams, user?.name, profile?.fullName, name])

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
          <main className={styles.main}>
            <p className={styles.muted} role="status">Loading your interview report…</p>
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
            <h1>Interview report</h1>
            <p className={styles.muted}>Complete your AI interview first to generate a career report.</p>
            <Link to="/interview" className={styles.bannerBtn}>
              Start AI interview
              </Link>
          </main>
                  </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <main className={styles.main} style={{ paddingTop: 24 }}>
          {fromInterview ? (
            <div style={{ marginBottom: 16 }} role="status">
                  <p className={styles.muted}>
                {autoContinueDashboard
                  ? 'Your immediate interview is complete. Review your report — we’ll open your dashboard shortly.'
                  : 'Your interview is complete. Review your report below, then continue to your dashboard.'}
              </p>
              {autoContinueDashboard && dashboardCountdown != null && dashboardCountdown > 0 && (
                <p className={styles.muted} style={{ marginTop: 8 }}>
                  Opening your dashboard in {dashboardCountdown}s…{' '}
                  <button
                    type="button"
                    className={styles.secondary}
                    style={{ marginLeft: 8 }}
                    onClick={() => goToCandidateDashboardAfterInterview(navigate)}
                  >
                    Go now
                  </button>
                </p>
              )}
              </div>
          ) : (
            <p style={{ marginBottom: 16 }}>
              <Link to="/dashboard" className={styles.secondary}>
                ← Back to dashboard
              </Link>
            </p>
          )}
            <CareerIntelligenceDashboard
              result={interview}
              candidateName={user?.name || profile?.fullName || name}
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
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'Posted recently'
  const diffMs = Date.now() - then
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return '1 week ago'
  if (weeks < 5) return `${weeks} weeks ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
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
  const [minMatchFilter] = useState('70%')
  const [sortBy, setSortBy] = useState('Best match')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [jobScope, setJobScope] = useState<'matched' | 'all'>('matched')
  const [jobsListMeta, setJobsListMeta] = useState<{
    totalOpen?: number
    candidateRoleHints?: string[]
    personalized?: boolean
    message?: string
  }>({})
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set())
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null)
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
        const listRes = await fetchOpenJobs({ summary: true, scope: jobScope })
        if (cancelled) return
        setJobsListMeta({
          totalOpen: listRes.totalOpen ?? listRes.total,
          candidateRoleHints: listRes.candidateRoleHints,
          personalized: listRes.personalized,
          message: listRes.message,
        })
        const rawJobs = listRes.jobs ?? []
        syncJobMatchNotifications(
          rawJobs.map((j) => ({ id: j.id, title: j.title, company: j.company })),
        )
        if (rawJobs.length === 0) {
          setEmployerJobs([])
          setJobsBoardState('ready')
          return
        }
        const ranked = rankPostedJobs(rawJobs)
        const mapped: JobMatchRole[] = ranked.map((j, idx) => {
          const raw = rawJobs.find((rj) => rj.id === j.id)
          const reqSkills = raw?.requiredSkills?.length ? raw.requiredSkills : ['Skills in job description']
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
            mode: (j.location || '').toLowerCase().includes('remote') ? 'Remote' : 'Hybrid',
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
                : ['Review the full description on the apply form.', 'Submit your resume for ATS scoring.'],
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

  // Filter and sort
  const filteredRoles = useMemo(() => {
    return allRoles.filter((job) => {
      if (
        searchTerm &&
        !job.title.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !job.company.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !job.matchedSkills.some((s) => s.toLowerCase().includes(searchTerm.toLowerCase()))
      ) {
        return false
      }
      if (jobScope === 'all') {
        return true
      }
      const loc = job.location.toLowerCase()
      const mode = job.mode.toLowerCase()
      const remoteFriendly = mode.includes('remote') || loc.includes('remote')
      if (
        locationFilter !== 'Any' &&
        locationFilter !== 'All locations'
      ) {
        if (locationFilter.toLowerCase() === 'remote') {
          if (!remoteFriendly) return false
        } else if (!loc.includes(locationFilter.toLowerCase()) && !remoteFriendly) {
          return false
        }
      }
      if (workModeFilter !== 'Any' && !job.mode.toLowerCase().includes(workModeFilter.toLowerCase())) {
        return false
      }
      const minMatch = parseInt(minMatchFilter, 10)
      if (Number.isFinite(minMatch) && job.match < minMatch) {
        return false
      }
      return true
    })
  }, [allRoles, searchTerm, locationFilter, workModeFilter, minMatchFilter, jobScope])

  const sortedRoles = useMemo(() => {
    const list = [...filteredRoles]
    if (sortBy === 'Highest salary') {
      list.sort((a, b) => b.salary.localeCompare(a.salary))
    } else if (sortBy === 'Most recent') {
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
      profile?.fullName || user?.name ? `Candidate: ${profile?.fullName || user?.name}` : '',
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
    if (!job.shareableCode) {
      setToast('This role is missing an apply link. Ask the employer to re-share the job.')
      window.setTimeout(() => setToast(''), 3000)
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
      window.setTimeout(() => setToast(''), 3500)
      return
    }
    if (resumeText.trim().length < 30) {
      setToast('Complete your profile or upload a resume before applying with your report.')
      window.setTimeout(() => setToast(''), 3500)
      return
    }
    setApplyingJobId(job.id)
    try {
        await applyToPublicJob(
          job.shareableCode,
          {
          candidateName: profile?.fullName || user?.name || '',
            candidateEmail: user?.email || '',
          candidatePhone: user?.phone || '',
          candidateRole: profile?.currentRole || interview?.role || '',
          experienceYears: profile?.totalExperience || interview?.level || '',
          resumeText,
          resumeName: profile?.resumeName || 'HireRight profile',
          attachInterviewReport: true,
          match: job.match,
        },
        job.companySlug || slugifyCompany(job.company),
      )
      const synced = await apiListApplications()
      saveApplications(synced)
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
      setApplyingJobId(null)
      window.setTimeout(() => setToast(''), 4000)
    }
  }

  function handleSave(job: JobMatchRole) {
    setSavedJobIds((prev) => {
      const next = new Set(prev)
      if (next.has(job.id)) {
        next.delete(job.id)
        setToast(`Removed ${job.title} from saved roles.`)
      } else {
        next.add(job.id)
        setToast(`Saved ${job.title} to your bookmarked roles.`)
      }
      return next
    })
    window.setTimeout(() => setToast(''), 2500)
  }

  function handleNotForMe(job: JobMatchRole) {
    setToast(`Marked "${job.title}" as not for you.`)
    window.setTimeout(() => setToast(''), 2500)
  }

  const jobsHeadline =
    jobsBoardState === 'loading'
      ? 'Loading roles…'
      : sortedRoles.length === 0
        ? 'No jobs found'
        : `${sortedRoles.length} job${sortedRoles.length === 1 ? '' : 's'}`

  return (
    <div className={styles.pageCandidateBleed}>
      <div className={`${styles.page} ${styles.pageCandidate} ${styles.pageJobsBoard}`}>
        <div className={`${styles.shell} ${styles.jobsBoardShell}`}>
        <motion.main
            className={`${styles.main} ${styles.jobsBoardMain}`}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
            <motion.div className={styles.jobsBoardToolbar} variants={fadeUp}>
              <div className={styles.jobsSearchWrap}>
                <HrIcon name="search" size={18} className={styles.jobsSearchIcon} />
                <input
                  type="search"
                  className={styles.jobsSearchInput}
                  placeholder="Search jobs here"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search jobs"
                />
            </div>
              <div className={styles.jobsToolbarFilters}>
                <select
                  className={styles.jobsToolbarSelect}
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  aria-label="Location"
                >
                  <option value="Hyderabad">Hyderabad</option>
                  <option value="Bengaluru">Bengaluru</option>
                  <option value="Pune">Pune</option>
                  <option value="Remote">Remote</option>
                  <option value="Any">Any location</option>
                </select>
                <select
                  className={styles.jobsToolbarSelect}
                  value={workModeFilter}
                  onChange={(e) => setWorkModeFilter(e.target.value)}
                  aria-label="Work mode"
                >
                  <option value="Any">Any mode</option>
                  <option value="Remote">Remote</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="On-site">On-site</option>
                </select>
                <select
                  className={styles.jobsToolbarSelect}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort jobs"
                >
                  <option value="Best match">Best match</option>
                  <option value="Most recent">Most recent</option>
                  <option value="Highest salary">Salary</option>
                </select>
              </div>
            </motion.div>

            <motion.div className={styles.jobsScopeRow} variants={fadeUp}>
              <button
                type="button"
                className={jobScope === 'matched' ? styles.jobsScopeChipActive : styles.jobsScopeChip}
                onClick={() => setJobScope('matched')}
              >
                For you
              </button>
              <button
                type="button"
                className={jobScope === 'all' ? styles.jobsScopeChipActive : styles.jobsScopeChip}
                onClick={() => setJobScope('all')}
              >
                All jobs
                {jobScope === 'all' && employerJobs.length > 0
                  ? ` (${employerJobs.length})`
                  : jobsListMeta.totalOpen != null
                    ? ` (${jobsListMeta.totalOpen})`
                    : ''}
              </button>
              <span className={styles.jobsResultCount}>{jobsHeadline}</span>
              {!unlocked ? (
                <span className={styles.jobsScoreHint}>Complete interview to apply with your report</span>
              ) : (
                <span className={styles.jobsScoreHint}>Interview score {candidateScoreLabel}</span>
              )}
            </motion.div>

            {jobsBoardError ? (
              <p className={styles.jobsBoardMessage} role="alert">
                {jobsBoardError}
              </p>
            ) : null}
            {!jobsBoardError && jobScope === 'matched' && jobsListMeta.message ? (
              <p className={styles.jobsBoardMessage}>{jobsListMeta.message}</p>
            ) : null}

            {toast ? <div className={styles.toast}>{toast}</div> : null}

            <motion.div className={styles.jobsFeedList} variants={fadeUp}>
              {jobsBoardState === 'loading'
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={`sk-${i}`} className={`${styles.naukriJobCard} ${styles.jobFeedSkeleton}`} />
                  ))
                : null}

              {jobsBoardState === 'ready' && visibleRoles.length === 0 && !jobsBoardError ? (
                <div className={styles.jobsEmptyCard}>
                  {employerJobs.length > 0 ? (
                    <>
                      <strong>No jobs match your filters</strong>
                      <p>
                        Try &quot;Any location&quot; in the toolbar, clear search, or switch work mode to
                        &quot;Any mode&quot;.
                      </p>
                    <button
                      type="button"
                      className={styles.primary}
                        onClick={() => {
                          setLocationFilter('Any')
                          setWorkModeFilter('Any')
                          setSearchTerm('')
                        }}
                      >
                        Reset filters
                    </button>
                    </>
                  ) : (
                    <>
                      <strong>No open roles yet</strong>
                      <p>
                        When employers post jobs on HireRighttt, they appear here. Complete your profile
                        and interview to apply with your AI report.
                      </p>
                      {jobScope === 'matched' && (jobsListMeta.totalOpen ?? 0) > 0 ? (
                    <button
                      type="button"
                      className={styles.primary}
                          onClick={() => setJobScope('all')}
                    >
                          Browse all {jobsListMeta.totalOpen} postings
                    </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {visibleRoles.map((job) => {
                const isOpen = selectedJob?.id === job.id
                const locationLine =
                  job.mode && job.mode !== 'Hybrid'
                    ? `${job.mode} · ${job.location}`
                    : `${job.mode} - ${job.location}`
                return (
                  <article
                    key={job.id}
                    className={`${styles.naukriJobCard} ${isOpen ? styles.naukriJobCardOpen : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.naukriJobCardHit}
                      onClick={() => setSelectedJobId(isOpen ? null : job.id)}
                      aria-expanded={isOpen}
                    >
                      <div className={styles.naukriCardTop}>
                        <div className={styles.naukriCardHeadline}>
                          <h2 className={styles.naukriJobTitle}>{job.title}</h2>
                          <div className={styles.naukriCompanyRow}>
                            <span className={styles.naukriCompanyName}>{job.company}</span>
                            {unlocked ? (
                              <span className={styles.naukriRating}>
                                <HrIcon name="star" size={14} className={styles.naukriStar} />
                                {job.match}% profile match
                              </span>
                            ) : null}
          </div>
                        </div>
                        <div
                          className={styles.naukriLogoBox}
                          style={{ background: job.logoBg, color: job.logoColor }}
                          aria-hidden
                        >
                          {job.logo}
                        </div>
                      </div>

                      <div className={styles.naukriMetaRow}>
                        <span className={styles.naukriMetaItem}>
                          <HrIcon name="briefcase" size={15} />
                          {job.experience}
                        </span>
                        <span className={styles.naukriMetaSep} aria-hidden>
                          |
                        </span>
                        <span className={styles.naukriMetaItem}>
                          <span className={styles.naukriRupee} aria-hidden>
                            ₹
                          </span>
                          {job.salary === 'Employer listed' ? 'Not disclosed' : job.salary}
                        </span>
                        <span className={styles.naukriMetaSep} aria-hidden>
                          |
                        </span>
                        <span className={styles.naukriMetaItem}>
                          <HrIcon name="map-pin" size={15} />
                          {locationLine}
                        </span>
                      </div>

                      <p className={styles.naukriSkillsLine}>{job.skillTags.join(' · ')}</p>

                      <div className={styles.naukriCardFoot}>
                        <span className={styles.naukriPosted}>{job.posted}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          className={
                            savedJobIds.has(job.id) ? styles.naukriSaveActive : styles.naukriSave
                          }
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSave(job)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              handleSave(job)
                            }
                          }}
                        >
                          <HrIcon name="document" size={16} />
                          {savedJobIds.has(job.id) ? 'Saved' : 'Save'}
                        </span>
                      </div>
                    </button>

                    {isOpen ? (
                      <div className={styles.naukriJobExpand}>
                        <p className={styles.naukriAbout}>{job.about}</p>
                        {job.bullets.length > 0 ? (
                          <ul className={styles.naukriBullets}>
                            {job.bullets.map((b, idx) => (
                              <li key={idx}>{b}</li>
                            ))}
                          </ul>
                        ) : null}
                        <div className={styles.naukriExpandActions}>
                          <button
                            type="button"
                            className={styles.naukriApplyBtn}
                            disabled={applyingJobId === job.id}
                            onClick={() => void handleApply(job)}
                          >
                            {applyingJobId === job.id ? 'Applying…' : 'Apply with my report'}
                          </button>
                          <button
                            type="button"
                            className={styles.naukriSecondaryBtn}
                            onClick={() => handleNotForMe(job)}
                          >
                            Not for me
                          </button>
                        </div>
                        <p className={styles.naukriApplyNote}>
                          Applying shares your HireRighttt interview report and resume with this employer.
                        </p>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </motion.div>
        </motion.main>
      </div>
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{title}</h2>
          {subtitle ? (
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{subtitle}</span>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!editing ? (
            <button
              type="button"
              className={styles.btnOutline}
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
                className={styles.primary}
                data-testid={doneTestId}
                onClick={() => void onDone()}
                disabled={saving}
              >
                Done
              </button>
              <button
                type="button"
                className={styles.btnOutline}
                data-testid={cancelTestId}
                onClick={onCancel}
                disabled={saving}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      {saving ? (
        <p className={styles.skillsSavingNotice} data-testid={savingTestId} role="status">
          Updating, please wait…
        </p>
      ) : null}
    </>
  )
}

export function ProfilePage() {
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

  const [fullName, setFullName] = useState(profile?.fullName || user?.name || '')
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
    fullName: profile?.fullName || user?.name || '',
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

  const [visibleToEmployers, setVisibleToEmployers] = useState(true)
  const [shareRecording, setShareRecording] = useState(false)
  const [emailAlerts, setEmailAlerts] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setProfileLoading(true)
      await syncSessionFromApi()
      const remote = await pullProfileFromApi()
      if (cancelled) return
      const next = remote ?? getProfile()
      setLiveProfile(next)
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
        setFullName(next.fullName || getUser()?.name || '')
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
      setProfileLoading(false)
    })()
    return () => {
      cancelled = true
    }
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
    const trimmedName = fullName.trim()
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
      <div className={styles.profileShell}>
        <motion.main
          className={`${styles.main} ${styles.profileMainShell}`}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <div className={styles.profileContentColumn}>
            {/* Header */}
          <motion.header className={styles.head} variants={fadeUp}>
            <div>
                <span className={styles.eyebrow}>PROFILE AND PREFERENCES</span>
                <h1>{user?.name || profile?.fullName || 'Your profile'}</h1>
                <p>
                  {profileLoading
                    ? 'Loading your saved profile…'
                    : profileUpdatedLabel
                      ? `Employers and job matches use this information. Last updated ${profileUpdatedLabel}.`
                      : 'Employers and job matches use this information from your account.'}
                  {!profileLoading && completionPct < 100
                    ? ` ${completionPct}% complete — finish only the sections marked below.`
                    : ''}
              </p>
            </div>
            </motion.header>

            {profileMissing.length > 0 && !profileLoading ? (
              <div className={styles.toast} role="status" style={{ borderLeft: '4px solid #7047ff' }}>
                <strong style={{ display: 'block', marginBottom: 6 }}>Still needed for better matches</strong>
                {profileMissing.map((item) => (
                  <Link
                    key={item.label}
                    to={profileCheckHref(item)}
                    style={{ display: 'inline-block', marginRight: 12, fontWeight: 600 }}
                  >
                    {item.label}
                    {!item.required ? ' (optional)' : ''}
              </Link>
                ))}
            </div>
            ) : null}

            {toast && <div className={styles.toast}>{toast}</div>}

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
                <div
                  className={styles.formGridThree}
                  style={{ marginTop: 12, opacity: basicsSaving ? 0.65 : 1 }}
                >
                  <div className={styles.formFieldBlock}>
                    <label>FULL NAME</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      readOnly={!basicsEditing}
                      disabled={basicsSaving}
                      data-testid="basics-full-name"
                    />
                    </div>
                  <div className={styles.formFieldBlock}>
                    <label>EMAIL</label>
                    <input
                      type="email"
                      className={styles.formInputText}
                      value={email}
                      readOnly
                      tabIndex={-1}
                      data-testid="basics-email"
                    />
                </div>
                  <div className={styles.formFieldBlock}>
                    <label>PHONE</label>
                    <input
                      type="tel"
                      className={styles.formInputText}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      readOnly={!basicsEditing}
                      disabled={basicsSaving}
                      data-testid="basics-phone"
                    />
                  </div>
                  </div>

                <div className={styles.formFieldBlock} style={{ marginTop: 14, opacity: basicsSaving ? 0.65 : 1 }}>
                  <label>CURRENT CITY</label>
                  <input
                    type="text"
                    className={styles.formInputText}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    readOnly={!basicsEditing}
                    disabled={basicsSaving}
                    data-testid="basics-city"
                  />
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
                <div
                  className={styles.formGridThree}
                  style={{ marginTop: 12, opacity: roleSaving ? 0.65 : 1 }}
                >
                  <div className={styles.formFieldBlock}>
                    <label>TARGET ROLE</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      readOnly={!roleEditing}
                      disabled={roleSaving}
                      data-testid="role-target"
                    />
                </div>
                  <div className={styles.formFieldBlock}>
                    <label>TOTAL EXPERIENCE</label>
                    <select
                      className={styles.formInputText}
                      value={experience}
                      onChange={(e) => setExperience(e.target.value)}
                      disabled={!roleEditing || roleSaving}
                      data-testid="role-experience"
                    >
                      <option value="0 - 1 years">0 - 1 years</option>
                      <option value="1 - 2 years">1 - 2 years</option>
                      <option value="2 - 3 years">2 - 3 years</option>
                      <option value="3 - 5 years">3 - 5 years</option>
                      <option value="5+ years">5+ years</option>
                    </select>
                  </div>
                  <div className={styles.formFieldBlock}>
                    <label>CURRENT COMPANY AND TITLE</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={companyTitle}
                      onChange={(e) => setCompanyTitle(e.target.value)}
                      readOnly={!roleEditing}
                      disabled={roleSaving}
                      data-testid="role-company-title"
                    />
                  </div>
                </div>

                <div className={styles.formFieldBlock} style={{ marginTop: 14, opacity: roleSaving ? 0.65 : 1 }}>
                  <label>HIGHEST EDUCATION</label>
                  <input
                    type="text"
                    className={styles.formInputText}
                    value={highestEducation}
                    onChange={(e) => setHighestEducation(e.target.value)}
                    readOnly={!roleEditing}
                    disabled={roleSaving}
                    data-testid="role-education"
                  />
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

                <div style={{ marginTop: 16, opacity: skillsSaving ? 0.65 : 1 }}>
                  {!skillsList.length && !skillsEditing ? (
                    <p className={styles.muted} style={{ margin: 0 }}>
                      No skills saved yet. Edit skills to add what matches your target roles.
                    </p>
                  ) : null}
                  {skillsList.map((skill) => (
                    <span
                      key={skill.name}
                      className={`${styles.skillPillCustom} ${
                        skill.level === 'Strong'
                          ? styles.skillPillStrong
                          : skill.level === 'Good'
                          ? styles.skillPillGood
                          : styles.skillPillBasic
                      }`}
                      data-testid={`skill-pill-${skill.name.replace(/\s+/g, '-')}`}
                    >
                      {skill.name}
                      <span className={styles.skillTagLevel}>{skill.level}</span>
                      {skillsEditing && !skillsSaving && (
                        <button
                          type="button"
                          className={styles.skillPillRemove}
                          aria-label={`Remove ${skill.name}`}
                          onClick={() => handleRemoveSkill(skill.name)}
                        >
                          ×
                        </button>
                      )}
                    </span>
              ))}
            </div>

                {skillsEditing && !skillsSaving && (
                  <div style={{ marginTop: 16 }}>
                    <label className={styles.filterLabel} style={{ marginBottom: 6, display: 'block' }}>
                      ADD A SKILL
                    </label>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <input
                        type="text"
                        className={styles.formInputText}
                        placeholder="For example: Docker"
                        value={newSkillInput}
                        onChange={(e) => setNewSkillInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddSkill()
                          }
                        }}
                        style={{ flex: 1 }}
                        data-testid="skills-add-input"
                      />
                      <button
                        type="button"
                        className={styles.btnOutline}
                        onClick={handleAddSkill}
                        data-testid="skills-add-btn"
                      >
                        Add skill
                      </button>
                    </div>
              </div>
            )}
              </section>

              {/* Card 4: Résumé */}
              <section id="resume" className={styles.card} aria-busy={resumeReplaceStatus === 'updating'}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>Résumé</h2>
                <input
                  ref={resumeFileInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleResumeFilePicked(file)
                  }}
                />

                {profile?.resumeName ? (
                  <div className={styles.resumeUploadBox}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className={styles.pdfBadge}>PDF</div>
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
                    <div className={styles.resumeActionBtns}>
                      <button
                        type="button"
                        className={styles.primary}
                        style={{ height: 34, padding: '0 14px', fontSize: '0.8rem' }}
                        disabled={resumeReplaceStatus === 'updating'}
                        onClick={() => resumeFileInputRef.current?.click()}
                      >
                        {resumeReplaceStatus === 'updating' ? 'Updating…' : 'Replace'}
                      </button>
                      {profile.resumeUrl ? (
                        <a
                          href={profile.resumeUrl}
                          className={styles.btnOutline}
                          style={{ height: 34, padding: '0 14px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center' }}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download
                        </a>
                      ) : null}
                    </div>
                    {resumeReplaceError ? (
                      <p className={styles.muted} style={{ margin: '10px 0 0', color: '#b91c1c' }}>
                        {resumeReplaceError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.empty} style={{ padding: '12px 0' }}>
                    <p className={styles.muted} style={{ marginTop: 0 }}>
                      No résumé on file yet. Upload one so employers and AI interviews can use your background.
                    </p>
                    <Link to="/onboarding" className={styles.primary} style={{ marginTop: 8, display: 'inline-flex' }}>
                      Upload résumé
                    </Link>
              </div>
            )}
              </section>

              {/* Card 5: Job preferences */}
              <section id="preferences" className={styles.card}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>
                  Job preferences
                </h2>

                <div className={styles.formGridThree}>
                  <div className={styles.formFieldBlock}>
                    <label>EXPECTED CTC (LPA)</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={expectedCtc}
                      onChange={(e) => setExpectedCtc(e.target.value)}
                    />
            </div>
                  <div className={styles.formFieldBlock}>
                    <label>NOTICE PERIOD</label>
                    <select
                      className={styles.formInputText}
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
                  <div className={styles.formFieldBlock}>
                    <label>PREFERRED LOCATIONS</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={prefLocations}
                      onChange={(e) => setPrefLocations(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <label className={styles.filterLabel} style={{ display: 'block', marginBottom: 8 }}>
                    WORK MODE
                  </label>
                  <div style={{ display: 'flex', gap: 20 }}>
                    <label className={styles.checkboxRow} style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={workModes.remote}
                        onChange={(e) => setWorkModes((prev) => ({ ...prev, remote: e.target.checked }))}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>Remote</span>
                    </label>
                    <label className={styles.checkboxRow} style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={workModes.hybrid}
                        onChange={(e) => setWorkModes((prev) => ({ ...prev, hybrid: e.target.checked }))}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>Hybrid</span>
                    </label>
                    <label className={styles.checkboxRow} style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={workModes.onsite}
                        onChange={(e) => setWorkModes((prev) => ({ ...prev, onsite: e.target.checked }))}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>On-site</span>
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <label className={styles.filterLabel} style={{ display: 'block', marginBottom: 8 }}>
                    JOB TYPE
                  </label>
                  <div style={{ display: 'flex', gap: 20 }}>
                    <label className={styles.checkboxRow} style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={jobTypes.fullTime}
                        onChange={(e) => setJobTypes((prev) => ({ ...prev, fullTime: e.target.checked }))}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>Full-time</span>
                    </label>
                    <label className={styles.checkboxRow} style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={jobTypes.contract}
                        onChange={(e) => setJobTypes((prev) => ({ ...prev, contract: e.target.checked }))}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>Contract</span>
                    </label>
                    <label className={styles.checkboxRow} style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={jobTypes.internship}
                        onChange={(e) => setJobTypes((prev) => ({ ...prev, internship: e.target.checked }))}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>Internship</span>
                    </label>
                  </div>
                </div>
              </section>

              {/* Card 6: Links */}
              <section id="links" className={styles.card}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>Links</h2>
                <div className={styles.formGridThree}>
                  <div className={styles.formFieldBlock}>
                    <label>LINKEDIN</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={linkedin}
                      onChange={(e) => setLinkedin(e.target.value)}
                    />
                  </div>
                  <div className={styles.formFieldBlock}>
                    <label>GITHUB</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={github}
                      onChange={(e) => setGithub(e.target.value)}
                    />
                  </div>
                  <div className={styles.formFieldBlock}>
                    <label>PORTFOLIO</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={portfolio}
                      onChange={(e) => setPortfolio(e.target.value)}
                    />
                  </div>
                </div>
              </section>

              {/* Card 7: Privacy and consent */}
              <section id="privacy" className={styles.card}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>
                  Privacy and consent
                </h2>

                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={visibleToEmployers}
                    onChange={(e) => setVisibleToEmployers(e.target.checked)}
                  />
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                      Visible to employers
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Employers can find your profile and score in search.
                    </div>
                  </div>
                </label>

                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={shareRecording}
                    onChange={(e) => setShareRecording(e.target.checked)}
                  />
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                      Share my interview recording
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Off by default. Employers see only the scored report.
                    </div>
                  </div>
                </label>

                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={emailAlerts}
                    onChange={(e) => setEmailAlerts(e.target.checked)}
                  />
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                      Email me about new matches and updates
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      At most one email a day.
                    </div>
                  </div>
                </label>

                <div className={styles.dangerBtnRow}>
                  <button
                    type="button"
                    className={styles.btnOutline}
                    onClick={() => {
                      setToast('Preparing data export...')
                      setTimeout(() => setToast(''), 2000)
                    }}
                  >
                    Download my data
                  </button>
                  <button
                    type="button"
                    className={styles.btnDangerOutline}
                    onClick={() => {
                      if (window.confirm('Are you sure you want to request account deletion?')) {
                        setToast('Account deletion request registered.')
                        setTimeout(() => setToast(''), 2500)
                      }
                    }}
                  >
                    Delete my account
                  </button>
                </div>
              </section>

              {/* Bottom Actions */}
              <div className={styles.profileBottomBar}>
                <button
                  type="button"
                  className={styles.btnOutline}
                  onClick={() => {
                    setToast('Changes reverted.')
                    setTimeout(() => setToast(''), 2000)
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void handleSaveProfile()} disabled={basicsSaving}
                >
                  Save changes
                </button>
              </div>

              {/* Career Scorecard report if interview taken */}
          {interview && (
                <div style={{ marginTop: 20 }}>
              <CareerIntelligenceDashboard
                result={interview}
                candidateName={user?.name ?? profile?.fullName ?? 'Candidate'}
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
                </div>
          )}
            </div>
          </div>
        </motion.main>
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
    <div className={styles.pageCandidateBleed}>
    <div className={`${styles.page} ${styles.pageCandidate}`}>
      <div className={styles.shell}>
        <motion.main
          className={styles.main}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.header className={styles.head} variants={fadeUp}>
            <div>
              <h1>My applications</h1>
              <p>
                Track every role you applied to. Status updates from employers
                show up here automatically.
              </p>
            </div>
            <Link to="/jobs" className={styles.primary}>
              Find more roles
            </Link>
          </motion.header>

          {appsLoading ? (
            <p className={styles.toast} role="status">
              Loading your applications…
            </p>
          ) : null}
          {appsError ? (
            <p className={styles.toast} role="alert">
              {appsError}
            </p>
          ) : null}

          {!appsLoading && apps.length === 0 ? (
            <motion.aside className={styles.unlockBanner} variants={fadeUp}>
              <div>
                <strong>No applications yet</strong>
                <p>
                  {interview
                    ? 'Browse ranked matches and apply with your AI score.'
                    : 'Complete your AI interview first, then apply to unlocked roles.'}
                </p>
              </div>
              <Link to={interview ? '/jobs' : '/interview'} className={styles.primary}>
                {interview ? 'Browse jobs →' : 'Take interview →'}
              </Link>
            </motion.aside>
          ) : !appsLoading ? (
            <div className={styles.jobList}>
              {apps.map((app) => {
                const jobRemoved = app.jobStatus === 'deleted'
                return (
                  <motion.article
                    key={app.id}
                    className={`${styles.jobCard} ${jobRemoved ? styles.jobCardEmployerDeleted : ''}`}
                    variants={fadeUp}
                  >
                  <div>
                    <h2>{app.title}</h2>
                    <p>
                      {app.company} · {app.location}
                        {app.roleTrack ? ` · ${app.roleTrack}` : ''}
                      </p>
                      {jobRemoved ? (
                        <p className={styles.jobDeletedBanner} role="status">
                          {app.jobDeletedMessage ||
                            'This job was removed by the employer. You can withdraw this application.'}
                        </p>
                      ) : null}
                    <span className={styles.lockTag}>
                        {jobRemoved ? 'Job deleted' : app.status} ·{' '}
                        {new Date(app.appliedAt).toLocaleDateString()}
                        {app.experienceLevel ? ` · ${app.experienceLevel}` : ''}
                    </span>
                  </div>
                  <div className={styles.jobRight}>
                      <b>
                        {app.interviewScore != null
                          ? `${app.interviewScore}% Interview`
                          : `${app.match}% Match`}
                      </b>
                    <button
                      type="button"
                      className={styles.secondary}
                        disabled={withdrawingId === app.id}
                        onClick={() => void handleWithdraw(app.id)}
                    >
                        {withdrawingId === app.id ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  </div>
                </motion.article>
                )
              })}
            </div>
          ) : null}
        </motion.main>
      </div>
    </div>
    </div>
  )
}
