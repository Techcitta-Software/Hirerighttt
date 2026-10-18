import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { fadeUp, staggerContainer } from '../motion/variants'
import {
  mapExperienceToLevel,
  mapProfileRoleToInterviewRole,
} from '../lib/interviewEngine'
import {
  MIN_APPLY_SCORE,
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
  withdrawApplication,
  type InterviewResult,
  type RankedJob,
  type SavedProfile,
} from '../lib/store'
import { CareerIntelligenceDashboard } from '../components/CareerIntelligenceDashboard'
import { downloadScorecardPdf } from '../lib/printScorecard'
import { ensureApiSession } from '../lib/apiSession'
import { writeTargetJob } from '../lib/targetJob'
import { applyToPublicJob, fetchOpenJobs } from '../lib/vendorApi'
import styles from './AppPages.module.css'

function snapshotLastUpdated(profile: SavedProfile | null, interview: InterviewResult | null): string {
  const stamps = [profile?.updatedAt, interview?.date]
    .filter(Boolean)
    .map((d) => new Date(String(d)).getTime())
    .filter((t) => !Number.isNaN(t))
  if (!stamps.length) return 'Not saved yet'
  return new Date(Math.max(...stamps)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function DashboardPage() {
  const user = getUser()
  const interview = getInterviewResult()
  const profile = getProfile()
  const name = firstName()
  const strength = interview ? interview.overall : calcProfileStrength(profile)
  const snapshotReadiness = calcProfileStrength(profile)
  const snapshotUpdated = snapshotLastUpdated(profile, interview)
  const [ranked, setRanked] = useState<RankedJob[]>([])
  const [jobsError, setJobsError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchOpenJobs()
      .then(({ jobs }) => {
        if (!cancelled) setRanked(rankPostedJobs(jobs).slice(0, 3))
      })
      .catch(() => {
        if (!cancelled) setJobsError('Employer jobs could not be loaded.')
      })
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
              <h1>Welcome back, {name}</h1>
              <p>
                {interview
                  ? `Your AI interview score is ${interview.overall}. Matches are unlocked.`
                  : 'Take your AI video interview with Ava to unlock ranked job matches.'}
              </p>
            </div>
            <div className={styles.headActions}>
              {interview && (
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
              )}
              <Link to="/jobs" className={styles.secondary}>
                View matches
              </Link>
              <Link to="/interview" className={styles.primary}>
                {interview ? 'Retake interview' : 'Enter interview studio'}
              </Link>
            </div>
          </motion.header>

          {!interview && (
            <motion.aside className={styles.unlockBanner} variants={fadeUp}>
              <div>
                <strong>Interview required</strong>
                <p>
                  Join the video room, answer Ava out loud, and unlock applications with your score.
                </p>
              </div>
              <Link to="/interview" className={styles.primary}>
                Start AI Interview →
              </Link>
            </motion.aside>
          )}

          <div className={styles.dashGrid}>
            <motion.article className={`${styles.card} ${styles.heroCard}`} variants={fadeUp}>
              <h2>AI Interview Score</h2>
              {interview ? (
                <>
                  <div
                    className={styles.progress}
                    style={{
                      background: `radial-gradient(circle at center, #fff 58%, transparent 59%), conic-gradient(#e11d48 0 ${interview.overall}%, #ffe4e6 ${interview.overall}% 100%)`,
                    }}
                  >
                    <strong>{interview.overall}</strong>
                  </div>
                  <p className={styles.strong}>
                    {interview.overall >= 75
                      ? 'Interview certified'
                      : interview.overall >= MIN_APPLY_SCORE
                        ? 'Eligible to apply'
                        : 'Retake to unlock applies'}
                  </p>
                  <p className={styles.muted}>
                    {interview.role} · {interview.level} ·{' '}
                    {new Date(interview.date).toLocaleDateString()}
                  </p>
                  <Link to="/profile" className={styles.link}>
                    Open talent scorecard →
                  </Link>
                  {downloadError ? <p className={styles.muted}>{downloadError}</p> : null}
                </>
              ) : (
                <>
                  <p className={styles.muted} style={{ marginTop: 14, textAlign: 'left' }}>
                    Live video interview with Ava — spoken answers, instant scoring across
                    four dimensions. Required to unlock matches.
                  </p>
                  <Link to="/interview" className={styles.link}>
                    Enter interview studio →
                  </Link>
                </>
              )}
            </motion.article>

            <motion.article className={styles.card} variants={fadeUp}>
              <h2>Talent readiness</h2>
              <div
                className={styles.progress}
                style={{
                  background: `radial-gradient(circle at center, #fff 58%, transparent 59%), conic-gradient(#0a0a0a 0 ${strength}%, #f4f4f5 ${strength}% 100%)`,
                }}
              >
                <strong>{strength}%</strong>
              </div>
              <p className={styles.strong}>
                {interview ? 'Score-weighted profile' : 'Complete interview to climb'}
              </p>
              <p className={styles.muted}>
                Interview score is the biggest part of readiness — profile details help fine-tune matches.
              </p>
              <Link to={interview ? '/onboarding' : '/interview'} className={styles.link}>
                {interview ? 'Polish profile →' : 'Interview first →'}
              </Link>
            </motion.article>

            <motion.article className={styles.card} variants={fadeUp}>
              <h2>Top matches</h2>
              {!hasInterviewScore() ? (
                <p className={styles.muted} style={{ marginTop: 12, textAlign: 'left' }}>
                  Matches stay locked until you finish your AI interview.
                </p>
              ) : ranked.length === 0 ? (
                <p className={styles.muted} style={{ marginTop: 12, textAlign: 'left' }}>
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
              <Link to="/jobs" className={styles.link}>
                {hasInterviewScore() ? 'Browse all matches →' : 'See locked roles →'}
              </Link>
            </motion.article>

            <motion.article className={`${styles.card} ${styles.snapshotCard}`} variants={fadeUp}>
              <h2>Update your current snapshot</h2>
              <p className={styles.muted} style={{ marginTop: 8, textAlign: 'left' }}>
                This is what employers and job matches use today — keep your role, résumé, and
                interview score in sync.
              </p>
              <p className={styles.snapshotMeta}>
                Last updated <strong>{snapshotUpdated}</strong> · Readiness{' '}
                <strong>{snapshotReadiness}%</strong>
              </p>
              <ul className={styles.snapshotList}>
                <li>
                  <span>Role</span>
                  <strong>{profile?.currentRole || interview?.role || 'Add your role'}</strong>
                </li>
                <li>
                  <span>Experience</span>
                  <strong>{profile?.totalExperience || interview?.level || 'Add experience'}</strong>
                </li>
                <li>
                  <span>Skills on file</span>
                  <strong>{profile?.skills?.length ?? 0}</strong>
                </li>
                <li>
                  <span>Résumé</span>
                  <strong>{profile?.resumeName || 'Upload résumé'}</strong>
                </li>
                <li>
                  <span>AI interview</span>
                  <strong>
                    {interview ? `Score ${interview.overall} · ${interview.role}` : 'Not completed'}
                  </strong>
                </li>
              </ul>
              <div className={styles.snapshotActions}>
                <Link to="/onboarding" className={styles.primary}>
                  Update snapshot
                </Link>
                <Link to="/interview" className={styles.secondary}>
                  {interview ? 'Refresh interview score' : 'Add interview score'}
                </Link>
              </div>
            </motion.article>

            {interview && (
              <motion.article className={styles.card} variants={fadeUp}>
                <h2>Score breakdown</h2>
                <ul className={styles.matchList}>
                  {interview.categories.map((cat) => (
                    <li key={cat.label}>
                      <div>
                        <strong>{cat.label}</strong>
                        <span>From your interview answers</span>
                      </div>
                      <b>{cat.score}/100</b>
                    </li>
                  ))}
                </ul>
              </motion.article>
            )}

            <motion.article className={styles.card} variants={fadeUp}>
              <h2>Quick actions</h2>
              <div className={styles.quick}>
                <Link to="/interview">AI interview studio</Link>
                <Link to="/jobs">Ranked job matches</Link>
                <Link to="/applications">My applications</Link>
                <Link to="/profile">Talent scorecard</Link>
                <Link to="/onboarding">Profile details</Link>
              </div>
            </motion.article>
          </div>
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

const JOBS_FEED_PAGE_SIZE = 4

const JobsFeedCard = memo(function JobsFeedCard({
  job,
  canApply,
  onApply,
  onInterviewToApply,
}: {
  job: RankedJob
  canApply: boolean
  onApply: (job: RankedJob) => void
  onInterviewToApply: (job: RankedJob) => void
}) {
  return (
    <article
      className={`${styles.jobFeedCard} ${job.locked ? styles.jobLocked : ''}`}
    >
      <div className={styles.jobFeedCardMain}>
        <h2>{job.title}</h2>
        <p className={styles.jobFeedMeta}>
          {job.company} · {job.location}
          {job.roleTrack ? ` · ${job.roleTrack}` : ''}
          {job.experienceLevel ? ` · ${job.experienceLevel}` : ''}
        </p>
        {job.jobDescription ? (
          <p className={styles.jobFeedPreview}>{job.jobDescription}</p>
        ) : null}
        {job.locked && <span className={styles.lockTag}>Unlock with AI interview</span>}
      </div>
      <div className={styles.jobRight}>
        <b>{job.locked ? '—' : `${job.match}%`} Match</b>
        {job.locked || !canApply ? (
          <button type="button" className={styles.primary} onClick={() => onInterviewToApply(job)}>
            Interview to apply
          </button>
        ) : (
          <button type="button" className={styles.primary} onClick={() => onApply(job)}>
            Apply now
          </button>
        )}
      </div>
    </article>
  )
})

export function JobsPage() {
  const navigate = useNavigate()
  const [toast, setToast] = useState('')
  const [rankedAll, setRankedAll] = useState<RankedJob[]>([])
  const [displayCount, setDisplayCount] = useState(JOBS_FEED_PAGE_SIZE)
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState('')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const interview = getInterviewResult()
  const unlocked = hasInterviewScore()
  const canApply = canApplyToJobs()

  useEffect(() => {
    let cancelled = false
    setJobsLoading(true)
    setJobsError('')
    setDisplayCount(JOBS_FEED_PAGE_SIZE)

    void (async () => {
      try {
        await ensureApiSession()
        if (cancelled) return
        const { jobs } = await fetchOpenJobs({ summary: true })
        if (cancelled) return
        setRankedAll(rankPostedJobs(jobs ?? []))
      } catch {
        if (!cancelled) setJobsError('Employer jobs could not be loaded.')
      } finally {
        if (!cancelled) setJobsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [interview?.overall])

  const visibleJobs = useMemo(
    () => rankedAll.slice(0, displayCount),
    [rankedAll, displayCount],
  )
  const hasMore = displayCount < rankedAll.length

  const loadMore = useCallback(() => {
    if (!hasMore) return
    setDisplayCount((n) => Math.min(n + JOBS_FEED_PAGE_SIZE, rankedAll.length))
  }, [hasMore, rankedAll.length])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      { root: null, rootMargin: '240px 0px', threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  async function handleApply(job: RankedJob) {
    try {
      const user = getUser()
      const profile = getProfile()
      if (job.shareableCode) {
        await applyToPublicJob(
          job.shareableCode,
          {
            candidateName: user?.name || profile?.fullName || 'Candidate',
            candidateEmail: user?.email || '',
            experienceYears: profile?.totalExperience || '',
            resumeText: profile?.resumeText || '',
            resumeName: profile?.resumeName || undefined,
          },
          job.companySlug,
        )
      }
      applyToJob(job)
      setToast(`Applied to ${job.title} at ${job.company}`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not apply.')
    }
    window.setTimeout(() => setToast(''), 2800)
  }

  function handleInterviewToApply(job: RankedJob) {
    const targetRole = job.roleTrack || mapProfileRoleToInterviewRole(job.title)
    const targetLevel = job.experienceLevel || mapExperienceToLevel(job.title)
    writeTargetJob({
      jobId: job.id,
      title: job.title,
      company: job.company,
      role: targetRole,
      level: targetLevel,
      jd: job.jobDescription || '',
      primarySkills: job.requiredSkills,
    })
    navigate('/interview')
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />
      </div>

      <main className={styles.jobsFeedMain}>
        <header className={styles.jobsFeedHead}>
          <div>
            <h1>Interview-ranked matches</h1>
            <p>
              {unlocked
                ? `Ranked using your ${interview!.overall} AI interview score.`
                : 'Complete your AI interview to unlock applies and full ranking.'}
            </p>
          </div>
          <Link to="/interview" className={styles.primary}>
            {unlocked ? 'Improve score' : 'Unlock with interview'}
          </Link>
        </header>

        {!unlocked && (
          <aside className={styles.unlockBanner}>
            <div>
              <strong>Matches locked</strong>
              <p>
                Roles are visible, but applying requires an AI interview score of at least{' '}
                {MIN_APPLY_SCORE}.
              </p>
            </div>
            <Link to="/interview" className={styles.primary}>
              Take AI Interview →
            </Link>
          </aside>
        )}

        {toast && <p className={styles.toast}>{toast}</p>}

        <div className={styles.jobFeedList}>
          {jobsLoading && visibleJobs.length === 0 ? (
            Array.from({ length: JOBS_FEED_PAGE_SIZE }).map((_, i) => (
              <div key={`sk-${i}`} className={`${styles.jobFeedCard} ${styles.jobFeedSkeleton}`} aria-hidden />
            ))
          ) : visibleJobs.length === 0 ? (
            <p className={styles.muted}>
              {jobsError || 'No jobs yet. Roles appear after an employer creates them.'}
            </p>
          ) : (
            visibleJobs.map((job) => (
              <JobsFeedCard
                key={job.id || `${job.company}-${job.title}`}
                job={job}
                canApply={canApply}
                onApply={handleApply}
                onInterviewToApply={handleInterviewToApply}
              />
            ))
          )}
        </div>

        {hasMore && !jobsLoading ? (
          <div ref={loadMoreRef} className={styles.jobFeedSentinel} aria-hidden />
        ) : null}
        {!hasMore && rankedAll.length > 0 ? (
          <p className={styles.jobFeedEnd}>You&apos;re all caught up.</p>
        ) : null}
      </main>

      <SiteFooter />
    </div>
  )
}

export function ProfilePage() {
  const user = getUser()
  const profile = getProfile()
  const interview = getInterviewResult()
  const strength = calcProfileStrength(profile)

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
              <h1>Talent scorecard</h1>
              <p>
                {user?.name ?? 'Candidate'}
                {profile?.currentRole ? ` · ${profile.currentRole}` : ''}
                {interview ? ` · Score ${interview.overall}` : ' · Interview pending'}
              </p>
            </div>
            <div className={styles.headActions}>
              <Link to="/onboarding" className={styles.secondary}>
                Edit details
              </Link>
              <Link to="/interview" className={styles.primary}>
                {interview ? 'Retake interview' : 'Take AI interview'}
              </Link>
            </div>
          </motion.header>

          <motion.section className={styles.card} variants={fadeUp}>
            <h2>Interview certification</h2>
            {interview ? (
              <>
                <div className={styles.stats}>
                  {[
                    [String(interview.overall), 'Overall'],
                    ...(interview.categories ?? []).map(
                      (c) => [String(c.score), c.label] as [string, string],
                    ),
                  ].map(([value, label]) => (
                    <div key={label}>
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.insightSplit}>
                  <div>
                    <h3>Strengths</h3>
                    <ul>
                      {(interview.strengths ?? []).map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3>Improve next</h3>
                    <ul>
                      {(interview.improvements ?? []).map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <p className={styles.muted} style={{ marginTop: 12, textAlign: 'left' }}>
                No score yet. Complete the AI video interview to generate your talent scorecard.
              </p>
            )}
          </motion.section>

          <motion.section className={styles.card} variants={fadeUp}>
            <h2>Profile snapshot</h2>
            <div className={styles.stats}>
              {[
                [`${strength}%`, 'Readiness'],
                [String(profile?.skills?.length ?? 0), 'Skills'],
                [
                  String(profile?.achievements?.filter(Boolean).length ?? 0),
                  'Achievements',
                ],
                [interview ? 'Certified' : 'Pending', 'Interview'],
              ].map(([value, label]) => (
                <div key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>

            {profile?.whoAreYou && (
              <div className={styles.bio}>
                <h3>About</h3>
                <p>{profile.whoAreYou}</p>
              </div>
            )}

            {profile && profile.skills.length > 0 && (
              <div className={styles.skillWrap}>
                {profile.skills.map((skill) => (
                  <span key={skill} className={styles.skill}>
                    {skill}
                  </span>
                ))}
              </div>
            )}

            <div className={styles.quick}>
              <Link to="/dashboard">Dashboard</Link>
              <Link to="/jobs">Matches</Link>
              <Link to="/applications">Applications</Link>
              <Link to="/interview">Interview studio</Link>
            </div>
          </motion.section>

          {interview && (
            <motion.section className={styles.scorecardSection} variants={fadeUp}>
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
            </motion.section>
          )}
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
