import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { fadeUp, staggerContainer } from '../motion/variants'
import {
  applyToJob,
  calcProfileStrength,
  canApplyToJobs,
  firstName,
  getApplications,
  getInterviewResult,
  getProfile,
  getUser,
  hasInterviewScore,
  markNotificationsRead,
  rankPostedJobs,
  saveProfile,
  withdrawApplication,
  type RankedJob,
} from '../lib/store'
import { CareerIntelligenceDashboard } from '../components/CareerIntelligenceDashboard'
import { downloadScorecardPdf } from '../lib/printScorecard'
import { ensureApiSession } from '../lib/apiSession'
import { fetchOpenJobs } from '../lib/vendorApi'
import { buildApplyPath } from '../lib/jobLink'
import styles from './AppPages.module.css'

export function DashboardPage() {
  const user = getUser()
  const interview = getInterviewResult()
  const profile = getProfile()
  const name = firstName()
  const strength = interview ? interview.overall : calcProfileStrength(profile)
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
                {interview
                  ? `Your AI interview score is ${interview.overall}. Matches are unlocked.`
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
                {interview ? `${interview.overall}` : '--'}
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

          {/* Full-width Card: Skills vs target role */}
          <motion.div className={styles.fullWidthSection} variants={fadeUp}>
            <h3 className={styles.panelTitle}>Skills vs target role</h3>
            <p className={styles.panelDesc} style={{ margin: '6px 0 0' }}>
              Add your target role and upload your résumé to see which skills employers ask for and where the gaps are. You have {profile?.skills?.length ?? 12} skills on file.
            </p>

            <div className={styles.dashedRoleBox}>
              <span className={styles.dashedRoleText}>
                {profile?.currentRole || 'No target role yet'}
              </span>
              <Link to="/onboarding" className={styles.dashedRoleBtn}>
                {profile?.currentRole ? 'Edit role' : 'Add your role'}
              </Link>
            </div>
          </motion.div>

          {/* Bottom 2-Column Section */}
          <motion.div className={styles.twoColSection} variants={fadeUp}>
            {/* Left: My applications */}
            <div className={styles.panelCard}>
              <h3 className={styles.panelTitle}>My applications</h3>
              <div className={styles.appsQuadGrid}>
                <div className={styles.appStatBox}>
                  <div className={styles.appStatNum}>--</div>
                  <div className={styles.appStatLabel}>Applied</div>
                </div>
                <div className={styles.appStatBox}>
                  <div className={styles.appStatNum}>--</div>
                  <div className={styles.appStatLabel}>Shortlisted</div>
                </div>
                <div className={styles.appStatBox}>
                  <div className={styles.appStatNum}>--</div>
                  <div className={styles.appStatLabel}>Interviewing</div>
                </div>
                <div className={styles.appStatBox}>
                  <div className={styles.appStatNum}>--</div>
                  <div className={styles.appStatLabel}>Offers</div>
                </div>
              </div>

              <div style={{ marginTop: 'auto' }}>
                <div className={styles.appsNoteTitle}>
                  Applications unlock with your interview score
                </div>
                <div className={styles.appsNoteDesc}>
                  Employers see your AI interview score first, so apply once your report is ready.
                </div>
              </div>
            </div>

            {/* Right: Profile snapshot */}
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
                    {interview ? `Score ${interview.overall}` : 'Not completed'}
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

const DEFAULT_MATCHED_ROLES: JobMatchRole[] = [
  {
    id: '1',
    logo: 'NL',
    logoColor: '#6366f1',
    logoBg: '#ede9fe',
    title: 'Software Engineer',
    company: 'Northwind Labs',
    location: 'Hyderabad',
    mode: 'Hybrid',
    salary: '₹14-18 LPA',
    experience: '2-4 years',
    jobType: 'Full-time',
    badge: 'Top pick',
    badgeType: 'topPick',
    matchedSkills: ['React', 'Node.js'],
    gapSkills: ['SQL'],
    posted: 'Posted 2 days ago',
    applicants: '34 applicants',
    match: 91,
    minScore: 70,
    breakdown: {
      interviewFit: 90,
      resumeFit: 88,
      skillsFit: 92,
      experienceFit: 95,
    },
    youHave: ['JavaScript', 'React', 'Node.js', 'Git'],
    closeGap: ['SQL', 'Docker'],
    about:
      'Build and ship customer-facing features across the React front end and Node.js services. You will work in a small product team, review code, and own features from design to release.',
    bullets: [
      '2 to 4 years of web development experience',
      'Strong JavaScript, React and REST APIs',
      'Comfortable with SQL databases',
    ],
  },
  {
    id: '2',
    logo: 'BL',
    logoColor: '#059669',
    logoBg: '#ecfdf5',
    title: 'Backend Developer',
    company: 'Brightloop',
    location: 'Bengaluru',
    mode: 'Remote',
    salary: '₹12-16 LPA',
    experience: '2-5 years',
    jobType: 'Full-time',
    badge: 'New',
    badgeType: 'new',
    matchedSkills: ['Node.js', 'SQL'],
    gapSkills: ['Docker'],
    posted: 'Posted today',
    applicants: '8 applicants',
    match: 88,
    minScore: 68,
    breakdown: {
      interviewFit: 86,
      resumeFit: 89,
      skillsFit: 90,
      experienceFit: 87,
    },
    youHave: ['Node.js', 'SQL', 'REST APIs', 'Git'],
    closeGap: ['Docker', 'AWS'],
    about:
      'Design robust backend microservices, database schemas, and performant API endpoints.',
    bullets: [
      '3+ years Node.js backend experience',
      'PostgreSQL or MySQL expertise',
      'Familiarity with distributed caching',
    ],
  },
  {
    id: '3',
    logo: 'LA',
    logoColor: '#2563eb',
    logoBg: '#eff6ff',
    title: 'Frontend Engineer',
    company: 'Lumen Apps',
    location: 'Remote',
    mode: 'Remote',
    salary: '₹12-17 LPA',
    experience: '2-4 years',
    jobType: 'Full-time',
    badge: 'New',
    badgeType: 'new',
    matchedSkills: ['React', 'JavaScript'],
    gapSkills: ['Testing'],
    posted: 'Posted today',
    applicants: '12 applicants',
    match: 86,
    minScore: 65,
    breakdown: {
      interviewFit: 85,
      resumeFit: 87,
      skillsFit: 88,
      experienceFit: 84,
    },
    youHave: ['React', 'JavaScript', 'HTML and CSS', 'TypeScript'],
    closeGap: ['Testing', 'Cypress'],
    about:
      'Craft responsive and accessible user interfaces for our design system and SaaS platform.',
    bullets: [
      'Solid React and TypeScript foundation',
      'Experience with modern CSS and animation',
      'Component-driven development',
    ],
  },
  {
    id: '4',
    logo: 'KP',
    logoColor: '#d97706',
    logoBg: '#fef3c7',
    title: 'Full-stack Engineer',
    company: 'Kestrel Pay',
    location: 'Hyderabad',
    mode: 'On-site',
    salary: '₹15-20 LPA',
    experience: '3-5 years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['React', 'JavaScript'],
    gapSkills: ['System design'],
    posted: 'Posted 5 days ago',
    applicants: '61 applicants',
    match: 84,
    minScore: 72,
    breakdown: {
      interviewFit: 83,
      resumeFit: 85,
      skillsFit: 86,
      experienceFit: 82,
    },
    youHave: ['React', 'Node.js', 'Git', 'Agile'],
    closeGap: ['System design', 'Microservices'],
    about:
      'Scale fintech payment pipelines and consumer checkout experiences with modern full-stack tools.',
    bullets: [
      'Full-stack JavaScript/TypeScript skills',
      'Fintech or transaction processing experience',
      'High standards for test coverage',
    ],
  },
  {
    id: '5',
    logo: 'ZS',
    logoColor: '#7c3aed',
    logoBg: '#f3e8ff',
    title: 'Data Engineer',
    company: 'Zephyr Systems',
    location: 'Pune',
    mode: 'Hybrid',
    salary: '₹14-19 LPA',
    experience: '2-4 years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['SQL', 'Python'],
    gapSkills: ['Spark'],
    posted: 'Posted 1 week ago',
    applicants: '47 applicants',
    match: 82,
    minScore: 70,
    breakdown: {
      interviewFit: 80,
      resumeFit: 83,
      skillsFit: 84,
      experienceFit: 81,
    },
    youHave: ['SQL', 'Python', 'Git'],
    closeGap: ['Spark', 'Airflow'],
    about:
      'Develop ETL pipelines, data warehouses, and automated analytics ingestion frameworks.',
    bullets: [
      'Python and SQL data engineering experience',
      'Data modeling and warehouse architectures',
      'Comfortable working with large data sets',
    ],
  },
  {
    id: '6',
    logo: 'OH',
    logoColor: '#0284c7',
    logoBg: '#e0f2fe',
    title: 'Platform Engineer',
    company: 'Orbit Health',
    location: 'Pune',
    mode: 'Hybrid',
    salary: '₹16-22 LPA',
    experience: '3-6 years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['Git'],
    gapSkills: ['Docker', 'CI/CD'],
    posted: 'Posted 1 week ago',
    applicants: '29 applicants',
    match: 79,
    minScore: 72,
    breakdown: {
      interviewFit: 78,
      resumeFit: 80,
      skillsFit: 79,
      experienceFit: 80,
    },
    youHave: ['Git', 'Linux', 'Node.js'],
    closeGap: ['Docker', 'CI/CD', 'Kubernetes'],
    about:
      'Empower healthcare software reliability, cloud infrastructure deployments, and observability.',
    bullets: [
      'Cloud and container infrastructure experience',
      'CI/CD automation pipelines',
      'Observability and uptime monitoring',
    ],
  },
  {
    id: '7',
    logo: 'IX',
    logoColor: '#4338ca',
    logoBg: '#e0e7ff',
    title: 'Cloud Architect',
    company: 'Informatix',
    location: 'Bengaluru',
    mode: 'Remote',
    salary: '₹22-28 LPA',
    experience: '5+ years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['Node.js', 'System design'],
    gapSkills: ['Terraform', 'Kubernetes'],
    posted: 'Posted 3 days ago',
    applicants: '19 applicants',
    match: 78,
    minScore: 75,
    breakdown: {
      interviewFit: 76,
      resumeFit: 80,
      skillsFit: 78,
      experienceFit: 81,
    },
    youHave: ['JavaScript', 'System design', 'Git'],
    closeGap: ['Terraform', 'Kubernetes'],
    about:
      'Architect distributed microservices and multi-region cloud systems for global enterprise workloads.',
    bullets: [
      '5+ years cloud architecture experience',
      'Deep AWS or GCP knowledge',
      'High-availability infrastructure design',
    ],
  },
  {
    id: '8',
    logo: 'NX',
    logoColor: '#059669',
    logoBg: '#ecfdf5',
    title: 'DevOps Specialist',
    company: 'Nexis',
    location: 'Hyderabad',
    mode: 'Hybrid',
    salary: '₹15-21 LPA',
    experience: '3-5 years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['Git', 'Docker'],
    gapSkills: ['Ansible'],
    posted: 'Posted 4 days ago',
    applicants: '22 applicants',
    match: 77,
    minScore: 70,
    breakdown: {
      interviewFit: 75,
      resumeFit: 78,
      skillsFit: 79,
      experienceFit: 77,
    },
    youHave: ['Git', 'Docker', 'Linux'],
    closeGap: ['Ansible', 'Helm'],
    about:
      'Automate build, test, and release pipelines to support fast delivery with maximum uptime.',
    bullets: [
      'Strong CI/CD scripting experience',
      'Container orchestration expertise',
      'Infrastructure automation mindset',
    ],
  },
  {
    id: '9',
    logo: 'QX',
    logoColor: '#9333ea',
    logoBg: '#f3e8ff',
    title: 'QA Automation Lead',
    company: 'Quantix',
    location: 'Chennai',
    mode: 'Hybrid',
    salary: '₹13-18 LPA',
    experience: '3-5 years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['JavaScript'],
    gapSkills: ['Playwright', 'Selenium'],
    posted: 'Posted 5 days ago',
    applicants: '16 applicants',
    match: 75,
    minScore: 68,
    breakdown: {
      interviewFit: 74,
      resumeFit: 76,
      skillsFit: 77,
      experienceFit: 75,
    },
    youHave: ['JavaScript', 'REST APIs', 'Git'],
    closeGap: ['Playwright', 'Selenium'],
    about:
      'Own end-to-end testing frameworks, regression pipelines, and performance benchmark suites.',
    bullets: [
      '3+ years automated test development',
      'End-to-end framework experience',
      'Deep understanding of QA life cycle',
    ],
  },
  {
    id: '10',
    logo: 'SP',
    logoColor: '#ea580c',
    logoBg: '#ffedd5',
    title: 'UI/UX Front-end Dev',
    company: 'StudioPulse',
    location: 'Mumbai',
    mode: 'Remote',
    salary: '₹12-16 LPA',
    experience: '2-4 years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['React', 'HTML and CSS'],
    gapSkills: ['Figma', 'Framer Motion'],
    posted: 'Posted 6 days ago',
    applicants: '38 applicants',
    match: 74,
    minScore: 65,
    breakdown: {
      interviewFit: 73,
      resumeFit: 75,
      skillsFit: 76,
      experienceFit: 74,
    },
    youHave: ['React', 'HTML and CSS', 'JavaScript'],
    closeGap: ['Figma', 'Framer Motion'],
    about:
      'Translate slick Figma prototypes into responsive, pixel-perfect interactive web interfaces.',
    bullets: [
      'Strong eye for design details and micro-interactions',
      'React and modern CSS expertise',
      'Cross-browser and accessibility standards',
    ],
  },
  {
    id: '11',
    logo: 'CS',
    logoColor: '#0284c7',
    logoBg: '#e0f2fe',
    title: 'Site Reliability Engineer',
    company: 'CoreScale',
    location: 'Pune',
    mode: 'On-site',
    salary: '₹16-24 LPA',
    experience: '4-7 years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['Node.js', 'Git'],
    gapSkills: ['Grafana', 'Prometheus'],
    posted: 'Posted 1 week ago',
    applicants: '18 applicants',
    match: 72,
    minScore: 72,
    breakdown: {
      interviewFit: 71,
      resumeFit: 73,
      skillsFit: 74,
      experienceFit: 72,
    },
    youHave: ['Linux', 'Git', 'REST APIs'],
    closeGap: ['Grafana', 'Prometheus'],
    about:
      'Ensure 99.99% availability of mission-critical customer systems with telemetry and alerting.',
    bullets: [
      'Production system troubleshooting skills',
      'Observability and SLI/SLO metrics experience',
      'On-call runbook development',
    ],
  },
  {
    id: '12',
    logo: 'AS',
    logoColor: '#d97706',
    logoBg: '#fef3c7',
    title: 'Mobile React Native Dev',
    company: 'AppSphere',
    location: 'Delhi NCR',
    mode: 'Hybrid',
    salary: '₹14-19 LPA',
    experience: '2-4 years',
    jobType: 'Full-time',
    badge: 'Open',
    badgeType: 'open',
    matchedSkills: ['React', 'JavaScript'],
    gapSkills: ['React Native', 'iOS/Android'],
    posted: 'Posted 1 week ago',
    applicants: '24 applicants',
    match: 71,
    minScore: 68,
    breakdown: {
      interviewFit: 70,
      resumeFit: 72,
      skillsFit: 73,
      experienceFit: 70,
    },
    youHave: ['React', 'JavaScript', 'TypeScript'],
    closeGap: ['React Native', 'Mobile APIs'],
    about:
      'Build engaging iOS and Android consumer mobile applications using React Native.',
    bullets: [
      'Experience shipping cross-platform mobile apps',
      'Performance tuning and native bridge knowledge',
      'Publishing to App Store and Play Store',
    ],
  },
]

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

  const interview = getInterviewResult()
  const candidateScore = interview ? interview.overall : 78
  const unlocked = hasInterviewScore()
  const canApply = canApplyToJobs()

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
    applyToJob({
      title: job.title,
      company: job.company,
      location: job.location,
      match: job.match,
    })
    navigate(buildApplyPath(job.company, job.shareableCode))
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
                    onClick={() => void handleApply(selectedJob)}
                  >
                    Apply with my report
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

export function ProfilePage() {
  const user = getUser()
  const profile = getProfile()
  const interview = getInterviewResult()

  const [activeSection, setActiveSection] = useState('basics')
  const [toast, setToast] = useState('')

  // Form State initialized with stored values or screenshot defaults
  const [fullName, setFullName] = useState(profile?.fullName || user?.name || 'Aarav Reddy')
  const [email, setEmail] = useState(user?.email || 'aarav@example.com')
  const [phone, setPhone] = useState(user?.phone || '+91 98765 43210')
  const [city, setCity] = useState(profile?.currentLocation || 'Hyderabad')

  const [targetRole, setTargetRole] = useState(profile?.currentRole || 'Software Engineer')
  const [experience, setExperience] = useState(profile?.totalExperience || '2 - 3 years')
  const [companyTitle, setCompanyTitle] = useState('Junior Developer, Cloudwave')
  const [highestEducation, setHighestEducation] = useState('B.Tech, Computer Science')

  const [newSkillInput, setNewSkillInput] = useState('')
  const [skillsList, setSkillsList] = useState<Array<{ name: string; level: 'Strong' | 'Good' | 'Basic' }>>([
    { name: 'JavaScript', level: 'Strong' },
    { name: 'React', level: 'Strong' },
    { name: 'Node.js', level: 'Good' },
    { name: 'Git', level: 'Good' },
    { name: 'HTML and CSS', level: 'Good' },
    { name: 'REST APIs', level: 'Good' },
    { name: 'TypeScript', level: 'Good' },
    { name: 'SQL', level: 'Basic' },
    { name: 'Python', level: 'Basic' },
    { name: 'MongoDB', level: 'Basic' },
    { name: 'Agile', level: 'Good' },
    { name: 'Problem solving', level: 'Good' },
  ])

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
    if (!trimmed) return
    if (skillsList.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setToast('Skill already in your list')
      setTimeout(() => setToast(''), 2000)
      return
    }
    setSkillsList((prev) => [...prev, { name: trimmed, level: 'Good' }])
    setNewSkillInput('')
    setToast(`Added skill "${trimmed}"`)
    setTimeout(() => setToast(''), 2000)
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
          className={styles.main}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
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

          {/* Split Layout */}
          <div className={styles.profileSplitLayout}>
            {/* Sidebar Navigation */}
            <nav className={styles.profileSidebar}>
              <button
                type="button"
                className={`${styles.profileSideLink} ${activeSection === 'basics' ? styles.profileSideActive : ''}`}
                onClick={() => scrollToSection('basics')}
              >
                Basics
              </button>
              <button
                type="button"
                className={`${styles.profileSideLink} ${activeSection === 'role' ? styles.profileSideActive : ''}`}
                onClick={() => scrollToSection('role')}
              >
                Role and experience
              </button>
              <button
                type="button"
                className={`${styles.profileSideLink} ${activeSection === 'skills' ? styles.profileSideActive : ''}`}
                onClick={() => scrollToSection('skills')}
              >
                Skills
              </button>
              <button
                type="button"
                className={`${styles.profileSideLink} ${activeSection === 'resume' ? styles.profileSideActive : ''}`}
                onClick={() => scrollToSection('resume')}
              >
                Résumé
              </button>
              <button
                type="button"
                className={`${styles.profileSideLink} ${activeSection === 'preferences' ? styles.profileSideActive : ''}`}
                onClick={() => scrollToSection('preferences')}
              >
                Job preferences
              </button>
              <button
                type="button"
                className={`${styles.profileSideLink} ${activeSection === 'links' ? styles.profileSideActive : ''}`}
                onClick={() => scrollToSection('links')}
              >
                Links
              </button>
              <button
                type="button"
                className={`${styles.profileSideLink} ${activeSection === 'privacy' ? styles.profileSideActive : ''}`}
                onClick={() => scrollToSection('privacy')}
              >
                Privacy and consent
              </button>
            </nav>

            {/* Main Sections Stack */}
            <div className={styles.profileSectionStack}>
              {/* Card 1: Basics */}
              <section id="basics" className={styles.card}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>Basics</h2>
                <div className={styles.formGridThree}>
                  <div className={styles.formFieldBlock}>
                    <label>FULL NAME</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div className={styles.formFieldBlock}>
                    <label>EMAIL</label>
                    <input
                      type="email"
                      className={styles.formInputText}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className={styles.formFieldBlock}>
                    <label>PHONE</label>
                    <input
                      type="tel"
                      className={styles.formInputText}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className={styles.formFieldBlock} style={{ marginTop: 14 }}>
                  <label>CURRENT CITY</label>
                  <input
                    type="text"
                    className={styles.formInputText}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
              </section>

              {/* Card 2: Role and experience */}
              <section id="role" className={styles.card}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>
                  Role and experience
                </h2>
                <div className={styles.formGridThree}>
                  <div className={styles.formFieldBlock}>
                    <label>TARGET ROLE</label>
                    <input
                      type="text"
                      className={styles.formInputText}
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                    />
                  </div>
                  <div className={styles.formFieldBlock}>
                    <label>TOTAL EXPERIENCE</label>
                    <select
                      className={styles.formInputText}
                      value={experience}
                      onChange={(e) => setExperience(e.target.value)}
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
                    />
                  </div>
                </div>

                <div className={styles.formFieldBlock} style={{ marginTop: 14 }}>
                  <label>HIGHEST EDUCATION</label>
                  <input
                    type="text"
                    className={styles.formInputText}
                    value={highestEducation}
                    onChange={(e) => setHighestEducation(e.target.value)}
                  />
                </div>
              </section>

              {/* Card 3: Skills */}
              <section id="skills" className={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Skills</h2>
                  <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                    12 on file · 9 found in your résumé · 3 added by you
                  </span>
                </div>

                <div style={{ marginTop: 16 }}>
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
                    >
                      {skill.name}
                      <span className={styles.skillTagLevel}>{skill.level}</span>
                    </span>
                  ))}
                </div>

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
                    />
                    <button
                      type="button"
                      className={styles.btnOutline}
                      onClick={handleAddSkill}
                    >
                      Add skill
                    </button>
                  </div>
                </div>
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
        </motion.main>
      </div>
      <SiteFooter />
    </div>
  )
}

export function ApplicationsPage() {
  const [apps, setApps] = useState(() => getApplications())
  const interview = getInterviewResult()

  useEffect(() => {
    markNotificationsRead()
  }, [])

  function handleWithdraw(id: string) {
    withdrawApplication(id)
    setApps(getApplications())
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

          {apps.length === 0 ? (
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
          ) : (
            <div className={styles.jobList}>
              {apps.map((app) => (
                <motion.article key={app.id} className={styles.jobCard} variants={fadeUp}>
                  <div>
                    <h2>{app.title}</h2>
                    <p>
                      {app.company} · {app.location}
                    </p>
                    <span className={styles.lockTag}>
                      {app.status} · {new Date(app.appliedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className={styles.jobRight}>
                    <b>{app.match}% Match</b>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => handleWithdraw(app.id)}
                    >
                      Withdraw
                    </button>
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </motion.main>
      </div>
      <SiteFooter />
    </div>
  )
}
