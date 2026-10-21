import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { fadeUp, staggerContainer } from '../motion/variants'
import {
  addNotification,
  calcProfileStrength,
  canApplyToJobs,
  getCareerDisplayScore,
  firstName,
  getApplications,
  getInterviewResult,
  type Application,
  getProfile,
  getUser,
  hasInterviewScore,
  markNotificationsRead,
  rankPostedJobs,
  saveApplications,
  saveProfile,
  type RankedJob,
} from '../lib/store'
import { CareerIntelligenceDashboard } from '../components/CareerIntelligenceDashboard'
import { downloadScorecardPdf } from '../lib/printScorecard'
import { apiListApplications, apiSaveProfile, apiWithdrawApplication } from '../lib/api'
import { ensureApiSession } from '../lib/apiSession'
import { applyToPublicJob, fetchOpenJobs } from '../lib/vendorApi'
import { slugifyCompany } from '../lib/jobLink'
import styles from './AppPages.module.css'

export function DashboardPage() {
  const user = getUser()
  const interview = getInterviewResult()
  const profile = getProfile()
  const name = firstName()
  const strength = interview ? interview.overall : calcProfileStrength(profile)
  const careerScore = getCareerDisplayScore(interview)
  const snapshotReadiness = calcProfileStrength(profile)
  const [ranked, setRanked] = useState<RankedJob[]>([])
  const [jobsError, setJobsError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await ensureApiSession()
        const { jobs } = await fetchOpenJobs({ summary: true })
        if (!cancelled) setRanked(rankPostedJobs(jobs).slice(0, 3))
      } catch {
        if (!cancelled) setJobsError('Employer jobs could not be loaded. Sign in as a candidate and ensure the API is running.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [interview?.overall])

  if (user?.role === 'employer') {
    return <Navigate to="/employer/dashboard" replace />
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />
        <motion.main
          className={styles.main}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.header className={styles.head} variants={fadeUp}>
            <div>
              <span className={styles.eyebrow}>JOB SEEKER DASHBOARD</span>
              <h1>Welcome back, {name}</h1>
              <p>
                {interview && careerScore != null
                  ? `Your AI interview score is ${careerScore}. Matches are unlocked.`
                  : 'Take your AI video interview with Ava to unlock ranked job matches.'}
              </p>
            </div>
            <div className={styles.headActions}>
              {interview && (
                <>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={downloading}
                    onClick={() => {
                      setDownloadError('')
                      setDownloading(true)
                      void downloadScorecardPdf(user?.name || profile?.fullName || name)
                        .catch(() => setDownloadError('Could not download the report. Try again.'))
                        .finally(() => setDownloading(false))
                    }}
                  >
                    {downloading ? 'Preparing download…' : 'Download report'}
                  </button>
                  {downloadError && (
                    <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{downloadError}</span>
                  )}
                </>
              )}
              <Link to="/jobs" className={styles.secondary}>
                View matches
              </Link>
              <Link to="/interview" className={styles.bannerBtn}>
                {interview ? 'Retake interview' : 'Enter interview studio'}
              </Link>
            </div>
          </motion.header>

          {!interview && (
            <motion.aside className={styles.bannerRequired} variants={fadeUp}>
              <div>
                <strong>Interview required</strong>
                <p>
                  Join the video room, answer Ava out loud, and unlock applications with your score.
                </p>
              </div>
              <Link to="/interview" className={styles.bannerBtn}>
                Start AI interview
              </Link>
            </motion.aside>
          )}

          {/* 4 KPI Cards in a row */}
          <motion.div className={styles.kpiRow} variants={fadeUp}>
            {/* Card 1: Talent readiness */}
            <div className={styles.kpiCard}>
              <div className={styles.kpiDonutRow}>
                <div
                  className={styles.miniDonut}
                  style={{
                    background: `conic-gradient(#5b46e5 0 ${strength}%, #ede9fe ${strength}% 100%)`,
                  }}
                >
                  <div className={styles.miniDonutInner}>{strength}%</div>
                </div>
                <div>
                  <h3 className={styles.kpiTitle}>Talent readiness</h3>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e1b4b', marginTop: 2 }}>
                    {interview ? 'Profile calibrated' : 'Complete interview to climb'}
                  </div>
                </div>
              </div>
              <p className={styles.kpiDesc} style={{ marginTop: 10 }}>
                The interview is the biggest part of this score
              </p>
            </div>

            {/* Card 2: AI interview score */}
            <div className={styles.kpiCard}>
              <h3 className={styles.kpiTitle}>AI interview score</h3>
              <div className={styles.kpiValue}>
                {careerScore != null ? `${careerScore}` : '--'}
              </div>
              <p className={styles.kpiDesc}>
                {interview
                  ? `${interview.role} · ${interview.level}`
                  : 'Not completed · takes about 20 minutes'}
              </p>
            </div>

            {/* Card 3: Résumé strength (ATS) */}
            <div className={styles.kpiCard}>
              <h3 className={styles.kpiTitle}>Résumé strength (ATS)</h3>
              <div className={styles.kpiValue}>
                {profile?.resumeName ? '78' : '--'}
              </div>
              <p className={styles.kpiDesc}>
                {profile?.resumeName
                  ? `${profile.resumeName} on file`
                  : 'Upload your résumé to get an ATS score'}
              </p>
            </div>

            {/* Card 4: Ranked job matches */}
            <div className={styles.kpiCard}>
              <h3 className={styles.kpiTitle}>Ranked job matches</h3>
              <div className={hasInterviewScore() && ranked.length > 0 ? styles.kpiValue : styles.kpiValueLocked}>
                {hasInterviewScore() && ranked.length > 0 ? `${ranked.length}` : 'Locked'}
              </div>
              <p className={styles.kpiDesc}>
                {hasInterviewScore()
                  ? 'Matched roles ready for review'
                  : 'Finish your interview to unlock ranked roles'}
              </p>
            </div>
          </motion.div>

          {/* Middle 2-Column Section */}
          <motion.div className={styles.twoColSection} variants={fadeUp}>
            {/* Left Panel: AI interview score */}
            <div className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>AI interview score</h3>
                <span className={interview ? styles.badgeLocked : styles.badgeNotCompleted}>
                  {interview ? 'Completed' : 'Not completed'}
                </span>
              </div>
              <p className={styles.panelDesc}>
                A live video interview with Ava. You answer out loud, and your answers are scored instantly across four dimensions. Required to unlock matches.
              </p>

              <div className={styles.dimensionTable}>
                <div className={styles.dimensionRow}>
                  <span>Communication</span>
                  <span className={styles.dimensionScore}>
                    {interview?.categories?.find(c => c.label.toLowerCase().includes('comm'))?.score ?? '--'}
                  </span>
                </div>
                <div className={styles.dimensionRow}>
                  <span>Technical knowledge</span>
                  <span className={styles.dimensionScore}>
                    {interview?.categories?.find(c => c.label.toLowerCase().includes('tech'))?.score ?? '--'}
                  </span>
                </div>
                <div className={styles.dimensionRow}>
                  <span>Problem solving</span>
                  <span className={styles.dimensionScore}>
                    {interview?.categories?.find(c => c.label.toLowerCase().includes('problem'))?.score ?? '--'}
                  </span>
                </div>
                <div className={styles.dimensionRow}>
                  <span>Confidence and presence</span>
                  <span className={styles.dimensionScore}>
                    {interview?.categories?.find(c => c.label.toLowerCase().includes('confid') || c.label.toLowerCase().includes('presence'))?.score ?? '--'}
                  </span>
                </div>
              </div>

              <div className={styles.metaTagsRow}>
                <span>About 20 min</span>
                <span>Camera and mic needed</span>
                <span>Spoken answers</span>
                <span>3 attempts</span>
              </div>

              <Link to="/interview" className={styles.panelBtnPrimary}>
                {interview ? 'Retake interview' : 'Enter interview studio'}
              </Link>
            </div>

            {/* Right Panel: Top matches */}
            <div className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>Top matches</h3>
                <span className={styles.badgeLocked}>
                  {hasInterviewScore() ? `${ranked.length} active` : 'Locked'}
                </span>
              </div>

              {!hasInterviewScore() ? (
                <div className={styles.lockedCenterBox}>
                  {/* Subtle placeholder rows */}
                  <div style={{ width: '100%', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10, opacity: 0.4 }}>
                    <div style={{ height: 14, background: '#f1f5f9', borderRadius: 4, width: '70%' }} />
                    <div style={{ height: 10, background: '#f8fafc', borderRadius: 4, width: '45%' }} />
                    <div style={{ height: 14, background: '#f1f5f9', borderRadius: 4, width: '85%' }} />
                  </div>

                  <div className={styles.lockCircle}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <div className={styles.lockedMessage}>
                    Matches stay locked until you finish your AI interview
                  </div>
                  <Link to="/interview" className={styles.panelBtnPrimary}>
                    Start AI interview
                  </Link>
                </div>
              ) : ranked.length === 0 ? (
                <p className={styles.muted} style={{ marginTop: 12 }}>
                  {jobsError || 'No jobs yet. Roles show up here after an employer posts them.'}
                </p>
              ) : (
                <ul className={styles.matchList}>
                  {ranked.map((job) => (
                    <li key={job.id || `${job.company}-${job.title}`}>
                      <div>
                        <strong>{job.title}</strong>
                        <span>
                          {job.company} · {job.location}
                        </span>
                      </div>
                      <b>{job.match}%</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>

          {/* Profile snapshot */}
          <motion.div className={styles.fullWidthSection} variants={fadeUp}>
            <div className={styles.panelCard}>
              <div className={styles.panelHeader} style={{ marginBottom: 4 }}>
                <h3 className={styles.panelTitle}>Profile snapshot</h3>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b' }}>
                  {snapshotReadiness}%
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Profile completeness</div>
              <div className={styles.completenessBarWrap}>
                <div className={styles.completenessBarTrack}>
                  <div
                    className={styles.completenessBarFill}
                    style={{ width: `${Math.min(100, Math.max(15, snapshotReadiness))}%` }}
                  />
                </div>
              </div>

              <div className={styles.profilePropsList}>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>TARGET ROLE</span>
                  <Link to="/onboarding" className={styles.profilePropVal}>
                    {profile?.currentRole || 'Add your role'}
                  </Link>
                </div>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>EXPERIENCE</span>
                  <span className={styles.profilePropValMuted}>
                    {profile?.totalExperience || '2 - 3 years'}
                  </span>
                </div>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>SKILLS ON FILE</span>
                  <span className={styles.profilePropValMuted}>
                    {profile?.skills?.length ?? 12}
                  </span>
                </div>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>RÉSUMÉ</span>
                  <Link to="/onboarding" className={styles.profilePropVal}>
                    {profile?.resumeName || 'Upload résumé'}
                  </Link>
                </div>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>AI INTERVIEW</span>
                  <span className={interview ? styles.profilePropVal : styles.profilePropValWarning}>
                    {careerScore != null ? `Score ${careerScore}` : 'Not completed'}
                  </span>
                </div>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>LOCATION</span>
                  <Link to="/onboarding" className={styles.profilePropVal}>
                    {profile?.currentLocation || 'Add location'}
                  </Link>
                </div>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>EXPECTED CTC</span>
                  <Link to="/onboarding" className={styles.profilePropVal}>
                    {profile?.salaryExpectation || 'Add expected CTC'}
                  </Link>
                </div>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>NOTICE PERIOD</span>
                  <Link to="/onboarding" className={styles.profilePropVal}>
                    {profile?.noticePeriod || 'Add notice period'}
                  </Link>
                </div>
                <div className={styles.profilePropRow}>
                  <span className={styles.profilePropKey}>VISIBILITY</span>
                  <span className={styles.profilePropValMuted}>Hidden until interview</span>
                </div>
              </div>

              <div className={styles.snapshotButtonsRow}>
                <Link to="/onboarding" className={styles.snapshotPrimaryBtn}>
                  Update snapshot
                </Link>
                <Link to="/onboarding" className={styles.snapshotOutlineBtn}>
                  Upload résumé
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.main>
        {interview && (
          <div className={styles.reportCapture} aria-hidden="true" inert>
            <CareerIntelligenceDashboard
              result={interview}
              candidateName={user?.name || profile?.fullName || name}
              candidateRole={profile?.currentRole || interview.role}
              candidateExperience={profile?.totalExperience || interview.level}
              skills={profile?.skills ?? []}
            />
          </div>
        )}
      </div>
      <SiteFooter />
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
}

export function JobsPage() {
  const navigate = useNavigate()
  const [toast, setToast] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [locationFilter, setLocationFilter] = useState('Hyderabad')
  const [workModeFilter, setWorkModeFilter] = useState('Any')
  const [minSalaryFilter, setMinSalaryFilter] = useState('₹10 LPA')
  const [minMatchFilter, setMinMatchFilter] = useState('70%')
  const [sortBy, setSortBy] = useState('Best match')
  const [selectedJobId, setSelectedJobId] = useState<string>('1')
  const [showAllMatches, setShowAllMatches] = useState(false)
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set())
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null)

  const interview = getInterviewResult()
  const candidateScore = interview ? interview.overall : 78
  const unlocked = hasInterviewScore()

  const [employerJobs, setEmployerJobs] = useState<JobMatchRole[]>([])
  const [jobsBoardState, setJobsBoardState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [jobsBoardError, setJobsBoardError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setJobsBoardState('loading')
      setJobsBoardError('')
      try {
        const sessionOk = await ensureApiSession()
        if (!sessionOk) {
          if (!cancelled) {
            setJobsBoardState('error')
            setJobsBoardError('Sign in as a candidate to see employer-posted roles.')
            setEmployerJobs([])
          }
          return
        }
        const { jobs } = await fetchOpenJobs({ summary: true })
        if (cancelled) return
        const rawJobs = jobs ?? []
        if (rawJobs.length === 0) {
          setEmployerJobs([])
          setJobsBoardState('ready')
          return
        }
        const ranked = rankPostedJobs(rawJobs)
        const mapped: JobMatchRole[] = ranked.map((j, idx) => {
          const raw = rawJobs.find((rj) => rj.id === j.id)
          const reqSkills = raw?.requiredSkills?.length ? raw.requiredSkills : ['Skills in job description']
          const jd = raw?.jobDescription || j.jobDescription || ''
          const jdBullets = jd
            .split(/\n/)
            .map((line) => line.replace(/^[\s•\-*]+/, '').trim())
            .filter((line) => line.length > 20)
            .slice(0, 3)
          return {
            id: j.id || `emp-${idx}`,
            logo: j.company.slice(0, 2).toUpperCase(),
            logoColor: '#6366f1',
            logoBg: '#ede9fe',
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
            posted: raw?.createdAt ? 'Posted recently' : 'Open role',
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
          setJobsBoardError('Could not load employer jobs. Check that the backend is running.')
          setEmployerJobs([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [interview?.overall])

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
      if (
        locationFilter !== 'Any' &&
        locationFilter !== 'All locations' &&
        !job.location.toLowerCase().includes(locationFilter.toLowerCase())
      ) {
        return false
      }
      if (workModeFilter !== 'Any' && !job.mode.toLowerCase().includes(workModeFilter.toLowerCase())) {
        return false
      }
      return true
    })
  }, [allRoles, searchTerm, locationFilter, workModeFilter])

  const sortedRoles = useMemo(() => {
    const list = [...filteredRoles]
    if (sortBy === 'Highest salary') {
      list.sort((a, b) => b.salary.localeCompare(a.salary))
    } else if (sortBy === 'Most recent') {
      list.sort((a, b) => a.posted.localeCompare(b.posted))
    } else {
      list.sort((a, b) => b.match - a.match)
    }
    return list
  }, [filteredRoles, sortBy])

  const visibleRoles = showAllMatches ? sortedRoles : sortedRoles.slice(0, 6)

  const selectedJob = useMemo(() => {
    return sortedRoles.find((j) => j.id === selectedJobId) || sortedRoles[0] || null
  }, [sortedRoles, selectedJobId])

  useEffect(() => {
    if (sortedRoles.length > 0 && !sortedRoles.some((j) => j.id === selectedJobId)) {
      setSelectedJobId(sortedRoles[0].id)
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
      interview
        ? `AI interview score: ${interview.overall}% (${interview.role || 'Interview'})`
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
    if (!canApplyToJobs()) {
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

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />
        <motion.main
          className={styles.main}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {/* Header */}
          <motion.header className={styles.head} variants={fadeUp}>
            <div>
              <span className={styles.eyebrow}>RANKED JOB MATCHES</span>
              <h1>
                {jobsBoardState === 'loading'
                  ? 'Loading employer roles…'
                  : sortedRoles.length === 0
                    ? 'No open employer roles yet'
                    : `${sortedRoles.length} employer role${sortedRoles.length === 1 ? '' : 's'} for you`}
              </h1>
              <p>
                {jobsBoardError ||
                  'Roles posted by vendors on HireRight. Ranked by your interview score when available.'}
              </p>
            </div>
            <div className={styles.headerBadgesWrap}>
              {sortedRoles.length > 0 ? (
                <span className={styles.badgeSubtlePill}>{sortedRoles.length} live posting(s)</span>
              ) : null}
              <span className={styles.badgeScoreFitPill}>
                Interview score {candidateScore}
                {unlocked && sortedRoles.length > 0
                  ? ` · ${sortedRoles.filter((j) => j.match >= 70).length} meet 70%+ match`
                  : ''}
              </span>
            </div>
          </motion.header>

          {toast && <div className={styles.toast}>{toast}</div>}

          {/* Filter Bar */}
          <motion.div className={styles.filterBar} variants={fadeUp}>
            <div className={styles.filterField}>
              <label className={styles.filterLabel}>SEARCH</label>
              <input
                type="text"
                className={styles.filterInput}
                placeholder="Role, company or skill"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel}>LOCATION</label>
              <select
                className={styles.filterSelect}
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
              >
                <option value="Hyderabad">Hyderabad</option>
                <option value="Bengaluru">Bengaluru</option>
                <option value="Pune">Pune</option>
                <option value="Remote">Remote</option>
                <option value="Any">Any location</option>
              </select>
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel}>WORK MODE</label>
              <select
                className={styles.filterSelect}
                value={workModeFilter}
                onChange={(e) => setWorkModeFilter(e.target.value)}
              >
                <option value="Any">Any</option>
                <option value="Remote">Remote</option>
                <option value="Hybrid">Hybrid</option>
                <option value="On-site">On-site</option>
              </select>
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel}>MIN SALARY</label>
              <select
                className={styles.filterSelect}
                value={minSalaryFilter}
                onChange={(e) => setMinSalaryFilter(e.target.value)}
              >
                <option value="₹10 LPA">₹10 LPA</option>
                <option value="₹12 LPA">₹12 LPA</option>
                <option value="₹14 LPA">₹14 LPA</option>
                <option value="₹16 LPA">₹16 LPA</option>
                <option value="Any">Any</option>
              </select>
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel}>MIN MATCH</label>
              <select
                className={styles.filterSelect}
                value={minMatchFilter}
                onChange={(e) => setMinMatchFilter(e.target.value)}
              >
                <option value="70%">70%</option>
                <option value="75%">75%</option>
                <option value="80%">80%</option>
                <option value="85%">85%</option>
              </select>
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel}>SORT BY</label>
              <select
                className={styles.filterSelect}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="Best match">Best match</option>
                <option value="Highest salary">Highest salary</option>
                <option value="Most recent">Most recent</option>
              </select>
            </div>
          </motion.div>

          {/* Master - Detail Layout */}
          <motion.div className={styles.matchesLayout} variants={fadeUp}>
            {/* Left Column: Job Cards List */}
            <div className={styles.matchCardList}>
              {jobsBoardState === 'loading' ? (
                <p className={styles.muted}>Loading jobs from employers…</p>
              ) : null}
              {jobsBoardState === 'ready' && visibleRoles.length === 0 && !jobsBoardError ? (
                <p className={styles.muted}>
                  When a vendor creates a job in the employer dashboard, it appears here. You can apply with
                  your resume on the apply form.
                </p>
              ) : null}
              {visibleRoles.map((job) => {
                const isSelected = selectedJob?.id === job.id
                return (
                  <article
                    key={job.id}
                    className={`${styles.matchItemCard} ${isSelected ? styles.matchItemActive : ''}`}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <div className={styles.matchCardLeft}>
                      <div
                        className={styles.companyAvatar}
                        style={{ background: job.logoBg, color: job.logoColor }}
                      >
                        {job.logo}
                      </div>
                      <div>
                        <div className={styles.matchCardTitleRow}>
                          <span className={styles.matchCardRole}>{job.title}</span>
                          {job.badge && (
                            <span
                              className={
                                job.badgeType === 'topPick'
                                  ? styles.badgeTopPick
                                  : job.badgeType === 'new'
                                  ? styles.badgeNew
                                  : styles.badgeOpen
                              }
                            >
                              {job.badge}
                            </span>
                          )}
                        </div>
                        <div className={styles.matchCardSub}>
                          {job.company} · {job.location} · {job.mode}
                        </div>
                        <div className={styles.matchCardSalary}>{job.salary}</div>
                        <div className={styles.matchCardSkills}>
                          Matched: {job.matchedSkills.join(', ')} · Gap: {job.gapSkills.join(', ')}
                        </div>
                        <div className={styles.matchCardFooter}>
                          {job.posted} · {job.applicants}
                        </div>
                      </div>
                    </div>
                    <div className={styles.matchScorePill}>
                      <span className={styles.matchScoreNum}>{job.match}%</span>
                      <span className={styles.matchScoreLabel}>match</span>
                    </div>
                  </article>
                )
              })}

              {sortedRoles.length > 6 && (
                <button
                  type="button"
                  className={styles.loadMoreMatchesBtn}
                  onClick={() => setShowAllMatches((prev) => !prev)}
                >
                  {showAllMatches ? 'Show fewer matches' : 'Show 6 more matches'}
                </button>
              )}
            </div>

            {/* Right Column: Sticky Detail Pane */}
            {selectedJob && (
              <aside className={styles.detailStickyPane}>
                <div className={styles.detailHeader}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div
                      className={styles.companyAvatar}
                      style={{
                        background: selectedJob.logoBg,
                        color: selectedJob.logoColor,
                        width: 44,
                        height: 44,
                        fontSize: '1rem',
                      }}
                    >
                      {selectedJob.logo}
                    </div>
                    <div>
                      <h2
                        style={{
                          fontSize: '1.25rem',
                          fontWeight: 700,
                          color: '#0f172a',
                          margin: 0,
                        }}
                      >
                        {selectedJob.title}
                      </h2>
                      <div className={styles.matchCardSub} style={{ marginTop: 2 }}>
                        {selectedJob.company} · {selectedJob.location} · {selectedJob.mode}
                      </div>
                      <div className={styles.matchCardSub} style={{ marginTop: 2, fontWeight: 600 }}>
                        {selectedJob.salary} · {selectedJob.jobType} · {selectedJob.experience}
                      </div>
                    </div>
                  </div>
                  <div className={styles.detailScoreWrap}>
                    <div className={styles.detailScoreBig}>{selectedJob.match}%</div>
                    <div className={styles.matchScoreLabel}>overall match</div>
                  </div>
                </div>

                <div className={styles.scoreReqAlert}>
                  Employer requires an interview score of {selectedJob.minScore} or more. Yours is{' '}
                  {candidateScore}.
                </div>

                {/* Why you match */}
                <div>
                  <h3
                    style={{
                      fontSize: '0.95rem',
                      fontWeight: 700,
                      color: '#0f172a',
                      margin: '18px 0 10px',
                    }}
                  >
                    Why you match
                  </h3>
                  <div className={styles.fitProgressList}>
                    <div className={styles.fitProgressRow}>
                      <span style={{ width: 100, color: '#475569' }}>Interview fit</span>
                      <div className={styles.fitProgressBarWrap}>
                        <div
                          className={styles.fitProgressBarFill}
                          style={{ width: `${selectedJob.breakdown.interviewFit}%` }}
                        />
                      </div>
                      <span style={{ fontWeight: 700, color: '#0f172a', width: 24, textAlign: 'right' }}>
                        {selectedJob.breakdown.interviewFit}
                      </span>
                    </div>
                    <div className={styles.fitProgressRow}>
                      <span style={{ width: 100, color: '#475569' }}>Résumé fit</span>
                      <div className={styles.fitProgressBarWrap}>
                        <div
                          className={styles.fitProgressBarFill}
                          style={{ width: `${selectedJob.breakdown.resumeFit}%` }}
                        />
                      </div>
                      <span style={{ fontWeight: 700, color: '#0f172a', width: 24, textAlign: 'right' }}>
                        {selectedJob.breakdown.resumeFit}
                      </span>
                    </div>
                    <div className={styles.fitProgressRow}>
                      <span style={{ width: 100, color: '#475569' }}>Skills fit</span>
                      <div className={styles.fitProgressBarWrap}>
                        <div
                          className={styles.fitProgressBarFill}
                          style={{ width: `${selectedJob.breakdown.skillsFit}%` }}
                        />
                      </div>
                      <span style={{ fontWeight: 700, color: '#0f172a', width: 24, textAlign: 'right' }}>
                        {selectedJob.breakdown.skillsFit}
                      </span>
                    </div>
                    <div className={styles.fitProgressRow}>
                      <span style={{ width: 100, color: '#475569' }}>Experience fit</span>
                      <div className={styles.fitProgressBarWrap}>
                        <div
                          className={styles.fitProgressBarFill}
                          style={{ width: `${selectedJob.breakdown.experienceFit}%` }}
                        />
                      </div>
                      <span style={{ fontWeight: 700, color: '#0f172a', width: 24, textAlign: 'right' }}>
                        {selectedJob.breakdown.experienceFit}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Skills Compare */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '16px 0' }}>
                  <div>
                    <div className={styles.skillsCompareTitle}>You have</div>
                    <div>
                      {selectedJob.youHave.map((sk) => (
                        <span key={sk} className={styles.skillPillHave}>
                          {sk}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className={styles.skillsCompareTitle}>Close the gap</div>
                    <div>
                      {selectedJob.closeGap.map((sk) => (
                        <span key={sk} className={styles.skillPillGap}>
                          {sk}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* About the role */}
                <div style={{ marginTop: 20 }}>
                  <h3
                    style={{
                      fontSize: '0.95rem',
                      fontWeight: 700,
                      color: '#0f172a',
                      marginBottom: 8,
                    }}
                  >
                    About the role
                  </h3>
                  <p
                    style={{
                      fontSize: '0.825rem',
                      color: '#475569',
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
                    {selectedJob.about}
                  </p>
                  <ul
                    style={{
                      margin: '10px 0 0',
                      paddingLeft: 18,
                      fontSize: '0.8125rem',
                      color: '#475569',
                      lineHeight: 1.6,
                    }}
                  >
                    {selectedJob.bullets.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                </div>

                {/* Action buttons */}
                <div className={styles.detailActionsRow}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={!selectedJob || applyingJobId === selectedJob.id}
                    onClick={() => selectedJob && void handleApply(selectedJob)}
                  >
                    {selectedJob && applyingJobId === selectedJob.id
                      ? 'Submitting application…'
                      : 'Apply with my report'}
                  </button>
                  <button
                    type="button"
                    className={styles.btnOutline}
                    onClick={() => handleSave(selectedJob)}
                  >
                    {savedJobIds.has(selectedJob.id) ? 'Saved ✓' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => handleNotForMe(selectedJob)}
                  >
                    Not for me
                  </button>
                </div>

                <div
                  style={{
                    fontSize: '0.72rem',
                    color: '#94a3b8',
                    marginTop: 12,
                    lineHeight: 1.45,
                  }}
                >
                  Applying shares your AI interview report with this employer. You can withdraw any time.
                </div>
              </aside>
            )}
          </motion.div>
        </motion.main>
      </div>
      <SiteFooter />
    </div>
  )
}

function profileSkillsToList(skills: string[] | undefined) {
  const names = (skills ?? []).map((s) => s.trim()).filter(Boolean)
  if (!names.length) {
    return [{ name: 'Add your skills', level: 'Basic' as const }]
  }
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

const PROFILE_NAV_SECTIONS = [
  { id: 'basics', label: 'Basics' },
  { id: 'role', label: 'Role and experience' },
  { id: 'skills', label: 'Skills' },
  { id: 'resume', label: 'Résumé' },
  { id: 'preferences', label: 'Job preferences' },
  { id: 'links', label: 'Links' },
  { id: 'privacy', label: 'Privacy and consent' },
] as const

export function ProfilePage() {
  const user = getUser()
  const profile = getProfile()
  const interview = getInterviewResult()

  const [activeSection, setActiveSection] = useState('basics')
  const [profileNavOpen, setProfileNavOpen] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!profileNavOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileNavOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [profileNavOpen])

  // Form State initialized with stored values or screenshot defaults
  const profileExtras = profile as
    | (typeof profile & { currentCompanyTitle?: string; highestEducation?: string; contactPhone?: string })
    | null

  const [fullName, setFullName] = useState(profile?.fullName || user?.name || 'Aarav Reddy')
  const [email] = useState(user?.email || 'aarav@example.com')
  const [phone, setPhone] = useState(user?.phone || profileExtras?.contactPhone || '+91 98765 43210')
  const [city, setCity] = useState(profile?.currentLocation || 'Hyderabad')

  const [targetRole, setTargetRole] = useState(profile?.currentRole || 'Software Engineer')
  const [experience, setExperience] = useState(profile?.totalExperience || '2 - 3 years')
  const [companyTitle, setCompanyTitle] = useState(
    profileExtras?.currentCompanyTitle || 'Junior Developer, Cloudwave',
  )
  const [highestEducation, setHighestEducation] = useState(
    profileExtras?.highestEducation || 'B.Tech, Computer Science',
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

  const [expectedCtc, setExpectedCtc] = useState(profile?.salaryExpectation || '14 - 18')
  const [noticePeriod, setNoticePeriod] = useState(profile?.noticePeriod || '30 days')
  const [prefLocations, setPrefLocations] = useState(
    profile?.preferredLocations && profile.preferredLocations.length > 0
      ? profile.preferredLocations.join(', ')
      : 'Hyderabad, Bengaluru, Remote'
  )

  const [workModes, setWorkModes] = useState({ remote: true, hybrid: true, onsite: false })
  const [jobTypes, setJobTypes] = useState({ fullTime: true, contract: false, internship: false })

  const [linkedin, setLinkedin] = useState('linkedin.com/in/aarav-reddy')
  const [github, setGithub] = useState('github.com/username')
  const [portfolio, setPortfolio] = useState('yourname.dev')

  const [visibleToEmployers, setVisibleToEmployers] = useState(true)
  const [shareRecording, setShareRecording] = useState(false)
  const [emailAlerts, setEmailAlerts] = useState(true)

  function scrollToSection(id: string) {
    setActiveSection(id)
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function handleAddSkill() {
    const trimmed = newSkillInput.trim()
    if (!trimmed || skillsSaving) return
    if (skillsList.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setToast('Skill already in your list')
      setTimeout(() => setToast(''), 2000)
      return
    }
    setSkillsList((prev) => prev.filter((s) => s.name !== 'Add your skills').concat([{ name: trimmed, level: 'Good' }]))
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
      .filter((n) => n && n !== 'Add your skills')
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
      workMode: profile?.workMode || '',
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
      saveProfile(mergedProfile, profile?.completedSteps ?? 5)
      await apiSaveProfile(mergedProfile)
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

  function handleSaveProfile() {
    const updated = {
      whoAreYou: profile?.whoAreYou || '',
      whatDrivesYou: profile?.whatDrivesYou || '',
      keyStrengths: profile?.keyStrengths || '',
      currentRole: targetRole,
      totalExperience: experience,
      currentLocation: city,
      noticePeriod: noticePeriod,
      skills: skillsList.map((s) => s.name),
      experienceSummary: profile?.experienceSummary || '',
      workExperiences: profile?.workExperiences || [],
      achievements: profile?.achievements || [],
      metrics: profile?.metrics || [],
      awards: profile?.awards || [],
      certifications: profile?.certifications || [],
      selfRating: profile?.selfRating || 4,
      preferredRoles: [targetRole],
      preferredLocations: prefLocations
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      workMode: [
        workModes.remote && 'Remote',
        workModes.hybrid && 'Hybrid',
        workModes.onsite && 'On-site',
      ]
        .filter(Boolean)
        .join(', '),
      salaryExpectation: expectedCtc,
      interviewNotes: profile?.interviewNotes || '',
      resumeFile: null,
      resumeText: profile?.resumeText || '',
      resumeName: profile?.resumeName || 'Aarav_Reddy_Resume.pdf',
      resumeUrl: profile?.resumeUrl || null,
      resumeStoragePath: profile?.resumeStoragePath || null,
    }

    saveProfile(updated, 5)
    setToast('Profile and preferences saved successfully!')
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />
        <motion.main
          className={`${styles.main} ${styles.profileMainShell}`}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <div className={styles.profilePageFrame}>
            <aside className={styles.profileNavRail} aria-label="Profile section navigation">
              <button
                type="button"
                className={styles.profileMenuBtn}
                aria-expanded={profileNavOpen}
                aria-controls="profile-section-nav"
                aria-label={profileNavOpen ? 'Hide profile sections' : 'Show profile sections'}
                onClick={() => setProfileNavOpen((open) => !open)}
              >
                <span className={styles.profileMenuIcon} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className={styles.profileMenuLabel}>
                  {profileNavOpen ? 'Hide sections' : 'Sections'}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {profileNavOpen ? (
                  <motion.nav
                    id="profile-section-nav"
                    className={styles.profileSidebar}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                  >
                    {PROFILE_NAV_SECTIONS.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        className={`${styles.profileSideLink} ${activeSection === section.id ? styles.profileSideActive : ''}`}
                        onClick={() => scrollToSection(section.id)}
                      >
                        {section.label}
                      </button>
                    ))}
                  </motion.nav>
                ) : null}
              </AnimatePresence>
            </aside>

            <div className={styles.profileContentCenterSlot}>
            <div className={styles.profileContentColumn}>
              {/* Header */}
              <motion.header className={styles.head} variants={fadeUp}>
                <div>
                  <span className={styles.eyebrow}>PROFILE AND PREFERENCES</span>
                  <h1>Keep your profile sharp</h1>
                  <p>Employers and your job matches use this information. Last updated 13 Oct 2026.</p>
                </div>
                <div className={styles.profileGaugeWrap}>
                  <div
                    className={styles.profileGaugeCircle}
                    style={{
                      background: 'conic-gradient(#5b46e5 0 89%, #ede9fe 89% 100%)',
                    }}
                  >
                    <div className={styles.profileGaugeInner} />
                  </div>
                  <div className={styles.profileGaugeText}>
                    <span className={styles.profileGaugePercent}>89% complete</span>
                    <span className={styles.profileGaugeSub}>Add projects to reach 100%</span>
                  </div>
                </div>
              </motion.header>

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
                  subtitle={`${skillsList.filter((s) => s.name !== 'Add your skills').length} on file`}
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
                      {skillsEditing && skill.name !== 'Add your skills' && !skillsSaving && (
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
              <section id="resume" className={styles.card}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>Résumé</h2>

                <div className={styles.resumeUploadBox}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className={styles.pdfBadge}>PDF</div>
                    <div className={styles.resumeFileDetails}>
                      <span className={styles.resumeFileName}>
                        {profile?.resumeName || 'Aarav_Reddy_Resume.pdf'}
                      </span>
                      <span className={styles.resumeFileMeta}>
                        Uploaded 12 Oct 2026 · 2 pages · 184 KB
                      </span>
                    </div>
                  </div>
                  <div className={styles.resumeActionBtns}>
                    <Link to="/onboarding" className={styles.primary} style={{ height: 34, padding: '0 14px', fontSize: '0.8rem' }}>
                      Replace
                    </Link>
                    <button
                      type="button"
                      className={styles.btnOutline}
                      style={{ height: 34, padding: '0 14px', fontSize: '0.8rem' }}
                      onClick={() => {
                        setToast('Downloading résumé...')
                        setTimeout(() => setToast(''), 2000)
                      }}
                    >
                      Download
                    </button>
                  </div>
                </div>

                {/* ATS Score widget */}
                <div className={styles.atsBreakdownBox}>
                  <div className={styles.atsScoreCol}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                      ATS score
                    </div>
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1, marginTop: 4 }}>
                      71<span style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 500 }}>/100</span>
                    </div>
                  </div>
                  <div className={styles.atsCheckList}>
                    <div className={styles.atsCheckRow}>
                      <span>Summary</span>
                      <span className={styles.atsStatusFound}>Found</span>
                    </div>
                    <div className={styles.atsCheckRow}>
                      <span>Work experience</span>
                      <span className={styles.atsStatusFound}>Found</span>
                    </div>
                    <div className={styles.atsCheckRow}>
                      <span>Education</span>
                      <span className={styles.atsStatusFound}>Found</span>
                    </div>
                    <div className={styles.atsCheckRow}>
                      <span>Skills</span>
                      <span className={styles.atsStatusFound}>Found</span>
                    </div>
                    <div className={styles.atsCheckRow}>
                      <span>Projects</span>
                      <span className={styles.atsStatusWarn}>Add 2 projects</span>
                    </div>
                    <div className={styles.atsCheckRow}>
                      <span>Certifications</span>
                      <span className={styles.atsStatusMissing}>Missing</span>
                    </div>
                  </div>
                </div>
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
                  onClick={handleSaveProfile}
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
                    onRetake={() => {
                      window.location.href = '/interview'
                    }}
                  />
                </div>
              )}
              </div>
            </div>
            </div>
          </div>
        </motion.main>
      </div>
      <SiteFooter />
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
    markNotificationsRead()
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
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />
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
      <SiteFooter />
    </div>
  )
}
