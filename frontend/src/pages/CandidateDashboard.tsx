import { CandidateReviewEvents } from '../components/CandidateReviewEvents'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { HrIcon } from '../components/HrIcon'
import { buildApplyPath } from '../lib/jobLink'
import { apiMe, apiListApplications } from '../lib/api'
import { pullInterviewFromApi, pullProfileFromApi, syncSessionFromApi } from '../lib/apiSync'
import { fetchOpenJobs } from '../lib/vendorApi'
import {
  getUser,
  getProfile,
  getInterviewResult,
  profileKey,
  rankPostedJobs,
  type Application,
  type RankedJob,
  type InterviewResult,
  type SavedProfile,
  type User,
} from '../lib/store'
import { syncJobMatchNotifications } from '../lib/jobMatchNotifications'
import {
  missingProfileFields,
  profileCompletionPercent,
  profileFieldChecks,
} from '../lib/profileCompletion'
import { buildInterviewInsights } from '../lib/interviewInsightsPresentation'
import styles from './CandidateDashboard.module.css'

function dateLabel(value?: string) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unavailable'
}

function statusBadgeClass(status: Application['status']) {
  switch (status) {
    case 'In Review':
      return styles.badgeReview
    case 'Interview':
      return styles.badgeInterview
    case 'Offer':
      return styles.badgeOffer
    default:
      return styles.badgeApplied
  }
}

export function DashboardPage() {
  const sessionUser = getUser()
  const [accountUser, setAccountUser] = useState<User | null>(sessionUser)
  const [profile, setProfile] = useState<SavedProfile | null>(getProfile)
  const [interview, setInterview] = useState<InterviewResult | null>(getInterviewResult)
  const [jobs, setJobs] = useState<RankedJob[]>([])
  const [jobCount, setJobCount] = useState(0)
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [jobsReady, setJobsReady] = useState(false)
  const [appsReady, setAppsReady] = useState(false)
  const [revision, setRevision] = useState(0)
  const email = sessionUser?.email
  const lastFocusRefresh = useRef(0)
  const jobRail = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErrors([])
      setJobsReady(false)
      setAppsReady(false)
      const failures: string[] = []

      await syncSessionFromApi()
      if (cancelled || getUser()?.email !== email) return
      setAccountUser(getUser())

      const [account, roles, apps, remoteProfile, remoteInterview] = await Promise.allSettled([
        apiMe(),
        fetchOpenJobs({ summary: true, scope: 'matched' }),
        apiListApplications(),
        pullProfileFromApi(),
        pullInterviewFromApi(),
      ])

      if (cancelled || getUser()?.email !== email) return

      if (account.status === 'fulfilled' && account.value.user?.email?.toLowerCase() === email?.toLowerCase()) {
        const remote = account.value
        setAccountUser((prev) => ({
          ...(prev || getUser()!),
          name: remote.user?.name || prev?.name || '',
          email: remote.user?.email || prev?.email || email!,
          phone: remote.user?.phone || prev?.phone,
        }))
        const localProfile = getProfile()
        if (remote.profile && (!localProfile || Date.parse(remote.profile.updatedAt || '') >= Date.parse(localProfile.updatedAt || ''))) {
          localStorage.setItem(profileKey(email!), JSON.stringify(remote.profile))
        }
        const localInterview = getInterviewResult()
        const remoteInterview = remote.interview as InterviewResult | null
        if (remoteInterview && (!localInterview || Date.parse(remoteInterview.date) >= Date.parse(localInterview.date))) {
          localStorage.setItem(`hireright.interviewResult.${email}`, JSON.stringify(remoteInterview))
        }
      } else if (account.status === 'rejected') {
        failures.push('We could not refresh your account. Showing saved data on this device.')
      }

      if (remoteProfile.status === 'fulfilled' && remoteProfile.value) {
        setProfile(remoteProfile.value)
      } else {
        setProfile(getProfile())
      }

      if (remoteInterview.status === 'fulfilled') {
        setInterview(remoteInterview.value)
      } else {
        setInterview(getInterviewResult())
      }

      if (roles.status === 'fulfilled') {
        const openJobs = roles.value.jobs ?? []
        syncJobMatchNotifications(
          openJobs.map((j) => ({ id: j.id, title: j.title, company: j.company })),
        )
        setJobs(rankPostedJobs(openJobs))
        setJobCount(roles.value.matchedCount ?? roles.value.total ?? openJobs.length)
        setJobsReady(true)
      } else failures.push('Open roles could not be loaded.')

      if (apps.status === 'fulfilled') {
        setApplications(apps.value)
        setAppsReady(true)
      } else failures.push('Application updates could not be loaded.')

      setErrors(failures)
      setLoading(false)
    }
    void load()
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastFocusRefresh.current < 60_000) return
      lastFocusRefresh.current = now
      setRevision((n) => n + 1)
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => { cancelled = true; window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh) }
  }, [email, revision])

  const user = accountUser || sessionUser
  const name = profile?.fullName?.trim() || user?.name?.trim() || 'there'
  const firstName = name.split(/\s+/)[0] || name
  const hasScore = !!interview && Number.isFinite(interview.overall)
  const overallScore = hasScore ? Math.round(interview!.overall) : 0
  const interviewInsights = buildInterviewInsights(interview)
  const performanceDimensions = interviewInsights.dimensions
  const recent = [...applications].sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt)).slice(0, 5)
  const profileChecks = profileFieldChecks(profile, user)
  const missingDetails = missingProfileFields(profile, user)
  const completion = profileCompletionPercent(profile, user)
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'HR'
  const inReviewCount = applications.filter((a) => a.status === 'In Review').length
  const interviewStageCount = applications.filter((a) => a.status === 'Interview').length
  const offerCount = applications.filter((a) => a.status === 'Offer').length
  const readinessScore = hasScore
    ? Math.round((completion + overallScore) / 2)
    : completion
  const topMatch = jobs[0] ?? null

  const nextActions = useMemo(() => {
    const actions: { title: string; body: string; href: string; cta: string; icon: 'sparkle' | 'user' | 'briefcase' | 'document' | 'chart' }[] = []
    if (!hasScore) {
      actions.push({
        title: 'Unlock your interview score',
        body: 'Employers on HireRighttt weigh AI interview signals when you apply.',
        href: '/interview',
        cta: 'Start interview',
        icon: 'sparkle',
      })
    }
    if (missingDetails.length > 0) {
      actions.push({
        title: 'Strengthen your profile',
        body: `${missingDetails.length} field${missingDetails.length === 1 ? '' : 's'} left — better data means sharper job matches.`,
        href: `/profile#${missingDetails[0].section}`,
        cta: 'Complete profile',
        icon: 'user',
      })
    }
    if (topMatch && hasScore) {
      actions.push({
        title: `Apply to ${topMatch.title}`,
        body: `${topMatch.company} · ${topMatch.match}% match with your profile.`,
        href: topMatch.shareableCode
          ? buildApplyPath(topMatch.company, topMatch.shareableCode)
          : `/jobs?job=${encodeURIComponent(topMatch.id || '')}`,
        cta: 'View role',
        icon: 'briefcase',
      })
    } else if (jobsReady && jobCount > 0) {
      actions.push({
        title: 'Review matched openings',
        body: `${jobCount} live role${jobCount === 1 ? '' : 's'} aligned with your track.`,
        href: '/jobs',
        cta: 'Browse jobs',
        icon: 'briefcase',
      })
    }
    if (hasScore && applications.length === 0) {
      actions.push({
        title: 'Send your first application',
        body: 'Your report and resume go to the employer in one step when you apply.',
        href: '/jobs',
        cta: 'Find roles',
        icon: 'document',
      })
    } else if (hasScore) {
      actions.push({
        title: 'Review performance insights',
        body: 'See strengths and focus areas before your next employer conversation.',
        href: '/dashboard/report',
        cta: 'Open report',
        icon: 'chart',
      })
    }
    return actions.slice(0, 4)
  }, [hasScore, missingDetails, topMatch, jobsReady, jobCount, applications.length])

  const chips: { icon: 'map-pin' | 'briefcase' | 'message' | 'user' | 'calendar' | 'sparkle'; text: string }[] = []
  if (profile?.currentLocation?.trim()) chips.push({ icon: 'map-pin', text: profile.currentLocation })
  if (profile?.totalExperience?.trim()) chips.push({ icon: 'briefcase', text: profile.totalExperience })
  if (email) chips.push({ icon: 'message', text: email })
  if (user?.phone?.trim()) chips.push({ icon: 'user', text: user.phone })
  if (profile?.noticePeriod?.trim()) chips.push({ icon: 'calendar', text: `Available ${profile.noticePeriod}` })
  if (profile?.skills?.filter(Boolean).length) {
    const skillText = profile.skills.filter(Boolean).slice(0, 3).join(' · ')
    chips.push({ icon: 'sparkle', text: profile.skills.length > 3 ? `${skillText}…` : skillText })
  }

  function scrollJobs(direction: number) {
    jobRail.current?.scrollBy({ left: direction * 310, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return (
    <div className={styles.pageBleed}>
    <div className={styles.page}>
      <div className={styles.main}>
        <header className={styles.heroBand}>
          <div className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Career workspace</p>
              <h1>Welcome back, {firstName}</h1>
              <p>
                Your live profile, interview score, and applications — full width view of where you stand
                with employers on HireRighttt.
              </p>
            </div>
            <div className={styles.heroActions}>
              {hasScore ? (
                <>
                  <Link to="/dashboard/report" className={styles.primary}>
                    <HrIcon name="document" size={17} />
                    View report
                  </Link>
                  <Link to="/pricing/retake" className={styles.secondary}>
                    <HrIcon name="trending" size={17} />
                    Improve your score?
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/interview" className={styles.primary}>
                    <HrIcon name="sparkle" size={17} />
                    Start AI interview
                  </Link>
                  <Link to="/pricing/retake" className={styles.secondary}>
                    <HrIcon name="trending" size={17} />
                    Improve your score?
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        <div className={styles.dashboardBody}>
        {loading && (
          <p className={styles.sync} role="status">
            <span className={styles.syncDot} aria-hidden="true" />
            Syncing your dashboard…
          </p>
        )}

        {errors.length > 0 && (
          <div className={styles.alert} role="alert">
            {errors.map(error => <p key={error}>{error}</p>)}
            <button type="button" className={styles.secondary} onClick={() => setRevision(n => n + 1)} disabled={loading}>
              Retry refresh
            </button>
          </div>
        )}

        <section className={styles.kpiGrid} aria-label="Overview metrics">
          <article className={styles.kpiCard}>
            <div className={styles.kpiTop}>
              <span className={styles.kpiLabel}>Interview score</span>
              <span className={styles.kpiIcon} aria-hidden="true">
                <HrIcon name="chart" size={18} />
              </span>
            </div>
            <strong className={styles.kpiValue}>
              {hasScore ? overallScore : '—'}
              {hasScore && <small>/100</small>}
            </strong>
            <p className={styles.kpiHint}>{hasScore ? 'Latest AI assessment' : 'Complete an interview to unlock'}</p>
          </article>
          <article className={styles.kpiCard}>
            <div className={styles.kpiTop}>
              <span className={styles.kpiLabel}>Applications</span>
              <span className={styles.kpiIcon} aria-hidden="true">
                <HrIcon name="document" size={18} />
              </span>
            </div>
            <strong className={styles.kpiValue}>{appsReady ? applications.length : '—'}</strong>
            <p className={styles.kpiHint}>
              {appsReady
                ? applications.length
                  ? `${inReviewCount} in review`
                  : 'None yet — explore matched jobs'
                : loading
                  ? 'Loading…'
                  : 'Unavailable'}
            </p>
          </article>
          <article className={styles.kpiCard}>
            <div className={styles.kpiTop}>
              <span className={styles.kpiLabel}>Matched roles</span>
              <span className={styles.kpiIcon} aria-hidden="true">
                <HrIcon name="briefcase" size={18} />
              </span>
            </div>
            <strong className={styles.kpiValue}>{jobsReady ? jobCount : '—'}</strong>
            <p className={styles.kpiHint}>{jobsReady ? 'Live employer openings for you' : loading ? 'Loading…' : 'Unavailable'}</p>
          </article>
          <article className={styles.kpiCard}>
            <div className={styles.kpiTop}>
              <span className={styles.kpiLabel}>Career readiness</span>
              <span className={styles.kpiIcon} aria-hidden="true">
                <HrIcon name="target" size={18} />
              </span>
            </div>
            <strong className={styles.kpiValue}>
              {readinessScore}
              <small>%</small>
            </strong>
            <p className={styles.kpiHint}>
              Profile + {hasScore ? 'interview score' : 'interview pending'}
            </p>
          </article>
        </section>

        {appsReady && applications.length > 0 && (
          <section className={styles.pipelineBar} aria-label="Application pipeline">
            <div className={styles.pipelineStep}>
              <strong>{applications.length}</strong>
              <span>Submitted</span>
            </div>
            <div className={styles.pipelineStep}>
              <strong>{inReviewCount}</strong>
              <span>In review</span>
            </div>
            <div className={styles.pipelineStep}>
              <strong>{interviewStageCount}</strong>
              <span>Interview</span>
            </div>
            <div className={styles.pipelineStep}>
              <strong>{offerCount}</strong>
              <span>Offers</span>
            </div>
          </section>
        )}

        {nextActions.length > 0 && (
          <section className={styles.nextActions} aria-labelledby="next-actions-heading">
            <div className={styles.nextActionsHead}>
              <div>
                <p className={styles.eyebrow}>Recommended</p>
                <h2 id="next-actions-heading">Your next best moves</h2>
              </div>
            </div>
            <div className={styles.nextActionsGrid}>
              {nextActions.map((action) => (
                <Link to={action.href} className={styles.nextActionCard} key={action.title}>
                  <HrIcon name={action.icon} size={18} />
                  <h3>{action.title}</h3>
                  <p>{action.body}</p>
                  <span>
                    {action.cta}
                    <HrIcon name="arrow-right" size={14} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {topMatch && jobsReady && (
          <section className={styles.featuredJob} aria-label="Top matched role">
            <div className={styles.featuredJobCopy}>
              <p className={styles.eyebrow} style={{ color: 'rgba(255,255,255,0.65)' }}>
                Top match for you
              </p>
              <h2>{topMatch.title}</h2>
              <p>
                {topMatch.company} is hiring for this role. Applying shares your HireRighttt interview report
                and resume with the employer team.
              </p>
              <div className={styles.featuredJobMeta}>
                <span>
                  <HrIcon name="map-pin" size={14} />
                  {topMatch.location || 'Flexible'}
                </span>
                {topMatch.match > 0 && !topMatch.locked ? (
                  <span>
                    <HrIcon name="star" size={14} />
                    {topMatch.match}% profile match
                  </span>
                ) : null}
              </div>
            </div>
            <div className={styles.featuredJobActions}>
              <Link
                to={
                  topMatch.shareableCode
                    ? buildApplyPath(topMatch.company, topMatch.shareableCode)
                    : `/jobs?job=${encodeURIComponent(topMatch.id || '')}`
                }
                className={styles.featuredPrimary}
              >
                View & apply
                <HrIcon name="arrow-up-right" size={16} />
              </Link>
              <Link to="/jobs" className={styles.featuredSecondary}>
                All matches
              </Link>
            </div>
          </section>
        )}

        <section className={styles.profileHero} aria-label="Your profile">
          <div className={styles.profileIdentity}>
            <div className={styles.avatarWrap}>
              <div className={styles.avatar} aria-hidden="true">{initials}</div>
              <span className={styles.avatarRing} aria-hidden="true" />
            </div>
            <div className={styles.profileInfo}>
              <p className={styles.eyebrow}>Your profile</p>
              <h2>{profile?.fullName?.trim() || user?.name || email}</h2>
              {profile?.currentRole?.trim() ? <p className={styles.role}>{profile.currentRole}</p> : null}
              {chips.length > 0 && (
                <div className={styles.chipRow}>
                  {chips.map((chip) => (
                    <span className={styles.chip} key={`${chip.icon}-${chip.text}`}>
                      <HrIcon name={chip.icon} size={14} />
                      {chip.text}
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.profileCtaRow}>
                <Link to="/profile" className={styles.primary}>
                  <HrIcon name="user" size={16} />
                  {missingDetails.length ? 'Complete profile' : 'Edit profile'}
                </Link>
                {profile?.updatedAt && (
                  <p className={styles.updated}>Updated {dateLabel(profile.updatedAt)}</p>
                )}
              </div>
            </div>
          </div>
          {missingDetails.length > 0 && (
            <aside className={styles.completionPanel}>
              <div className={styles.completionPanelHead}>
                <span>Profile strength</span>
                <span className={styles.completionPct}>{completion}%</span>
              </div>
              <progress value={completion} max={100} aria-label="Profile completion" />
              <h3>{missingDetails.length} item{missingDetails.length === 1 ? '' : 's'} to go</h3>
              <p>Only missing details — nothing you have already saved will be asked again.</p>
              <a href="#complete-profile">
                View checklist
                <HrIcon name="arrow-right" size={15} />
              </a>
            </aside>
          )}
        </section>

        {missingDetails.length > 0 && (
          <section id="complete-profile" className={styles.completionSection} aria-labelledby="completion-heading">
            <div className={styles.sectionIntro}>
              <div className={styles.sectionHead}>
                <div>
                  <p className={styles.eyebrow}>Next steps</p>
                  <h2 id="completion-heading">Complete your profile</h2>
                </div>
                <span className={styles.countBadge}>
                  {profileChecks.filter(c => c.done).length} / {profileChecks.length} on file
                </span>
              </div>
              <p className={styles.muted}>Each card opens the exact section you still need — the rest of your profile stays untouched.</p>
            </div>
            <div className={styles.completionGrid}>
              {missingDetails.map(item => (
                <Link to={`/profile#${item.section}`} className={styles.completionTile} key={item.label}>
                  <span className={styles.tileIcon}><HrIcon name={item.icon} size={20} /></span>
                  <h3>{item.label}</h3>
                  <p>{item.hint}</p>
                  <span className={styles.tileAction}>
                    Add now
                    <HrIcon name="plus" size={16} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className={styles.contentGrid}>
          <div className={styles.primaryCol}>
            <section className={styles.card} aria-labelledby="interview-heading">
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.eyebrow}>Interview insights</p>
                  <h2 id="interview-heading">Performance summary</h2>
                </div>
                <HrIcon name="chart" size={22} className={styles.cardHeaderIcon} />
              </div>
              <p className={styles.muted}>AI-generated feedback from your answers — not a hiring decision.</p>

              {hasScore && (
                <div className={styles.scoreHero}>
                  <div
                    className={styles.scoreRing}
                    style={{ ['--score' as string]: String(overallScore) }}
                    aria-hidden="true"
                  >
                    <div className={styles.scoreRingInner}>
                      {overallScore}
                      <span>/100</span>
                    </div>
                  </div>
                  <div className={styles.scoreHeroCopy}>
                    <h3>{interview?.role || profile?.currentRole || 'Your latest session'}</h3>
                    <p>
                      {interview?.level ? `${interview.level} · ` : ''}
                      Assessed {interview?.date ? dateLabel(interview.date) : 'recently'}
                    </p>
                  </div>
                </div>
              )}

              {performanceDimensions.length ? (
                <div className={styles.scores}>
                  {performanceDimensions.map((dimension) => (
                    <div key={dimension.key}>
                      <div className={styles.scoreLabel}>
                        <span>
                          {dimension.title}
                          <span
                            className={
                              dimension.band === 'strong'
                                ? styles.bandStrong
                                : dimension.band === 'steady'
                                  ? styles.bandSteady
                                  : styles.bandGrowth
                            }
                          >
                            {dimension.band === 'strong'
                              ? 'Standout'
                              : dimension.band === 'steady'
                                ? 'On track'
                                : 'Growth area'}
                          </span>
                        </span>
                        <strong>{dimension.score}<small> /100</small></strong>
                      </div>
                      <p className={styles.dimensionCaption}>{dimension.caption}</p>
                      <progress aria-label={dimension.title} value={dimension.score} max={100} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.empty} style={{ textAlign: 'left', padding: '12px 0' }}>
                  {hasScore ? 'Category breakdown is not available for this session.' : 'Complete your AI interview to see scores and feedback here.'}
                </p>
              )}

              <div className={styles.feedback}>
                <div className={styles.feedbackBlock}>
                  <h3><HrIcon name="check" size={16} />Strengths</h3>
                  {interviewInsights.highlights.length ? (
                    <ul>{interviewInsights.highlights.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  ) : (
                    <p>{hasScore ? 'Complete another practice round to generate personalized highlights.' : 'Highlights appear after your interview.'}</p>
                  )}
                </div>
                <div className={styles.feedbackBlock}>
                  <h3><HrIcon name="trending" size={16} />Focus next</h3>
                  {interviewInsights.focusNext.length ? (
                    <ul>{interviewInsights.focusNext.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  ) : (
                    <p>{hasScore ? 'No priority growth areas flagged for this session.' : 'Personalized focus areas appear after your interview.'}</p>
                  )}
                </div>
              </div>

              {hasScore && (
                <div className={styles.cardFooter}>
                  <Link to="/dashboard/report">
                    Full report & PDF
                    <HrIcon name="arrow-right" size={15} />
                  </Link>
                  <Link to="/pricing/retake">Retake interview</Link>
                </div>
              )}
            </section>

            <section className={`${styles.card} ${styles.opportunities}`} aria-labelledby="jobs-heading">
              <div className={styles.sectionHead}>
                <div>
                  <p className={styles.eyebrow}>Opportunities</p>
                  <h2 id="jobs-heading">Roles matched to you</h2>
                  <p className={styles.muted}>Employer postings aligned with your profile.</p>
                </div>
                <Link to="/jobs">
                  View all
                  <HrIcon name="arrow-right" size={16} />
                </Link>
              </div>
              {!jobsReady ? (
                <p className={styles.empty} role="status">{loading ? 'Loading roles…' : 'Roles unavailable — retry above.'}</p>
              ) : jobs.length ? (
                <>
                  <ul className={styles.jobRail} ref={jobRail} tabIndex={0} aria-label="Matched jobs">
                    {jobs.slice(0, 12).map((job, i) => (
                      <li className={styles.jobTile} key={job.id || i}>
                        <div className={styles.jobTileTop}>
                          <div className={styles.companyIcon} aria-hidden="true">
                            {job.company.slice(0, 2).toUpperCase()}
                          </div>
                          {!job.locked && job.match > 0 ? (
                            <span className={styles.matchPill}>{job.match}% match</span>
                          ) : null}
                        </div>
                        <p className={styles.company}>{job.company}</p>
                        <h3>{job.title}</h3>
                        <p className={styles.jobLocation}>
                          <HrIcon name="map-pin" size={15} />
                          {job.location || 'Location flexible'}
                        </p>
                        <Link
                          to={job.shareableCode ? buildApplyPath(job.company, job.shareableCode) : `/jobs?job=${encodeURIComponent(job.id || '')}`}
                          aria-label={`View ${job.title} at ${job.company}`}
                        >
                          View role
                          <HrIcon name="arrow-up-right" size={17} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className={styles.railControls}>
                    <span>Swipe or use arrows to browse</span>
                    <button type="button" onClick={() => scrollJobs(-1)} aria-label="Previous jobs">
                      <span className={styles.reverseArrow}><HrIcon name="arrow-right" size={18} /></span>
                    </button>
                    <button type="button" onClick={() => scrollJobs(1)} aria-label="Next jobs">
                      <HrIcon name="arrow-right" size={18} />
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.empty}>
                  <div className={styles.emptyIconWrap}><HrIcon name="briefcase" size={26} /></div>
                  <h3>No matches yet</h3>
                  <p>
                    {missingDetails.some((m) => m.section === 'role')
                      ? 'Add your target role on your profile to unlock tailored matches.'
                      : 'New employer roles appear here when they match your profile.'}
                  </p>
                  <Link to="/jobs" className={styles.primary} style={{ minHeight: 40, padding: '0 18px', fontSize: '0.8125rem' }}>
                    Browse all jobs
                  </Link>
                </div>
              )}
            </section>

            <section className={styles.card} aria-labelledby="research-heading">
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.eyebrow}>Prepare & research</p>
                  <h2 id="research-heading">Stay interview-ready</h2>
                </div>
              </div>
              <p className={styles.muted}>
                Practical steps candidates use before employer screens — tied to your data on HireRighttt.
              </p>
              <div className={styles.researchGrid} style={{ marginTop: 16 }}>
                <article className={styles.researchCard}>
                  <HrIcon name="chart" size={20} />
                  <h3>Review your score breakdown</h3>
                  <p>See which dimensions employers notice first in your AI session.</p>
                  <Link to={hasScore ? '/dashboard/report' : '/interview'}>
                    {hasScore ? 'Open report' : 'Take interview'}
                    <HrIcon name="arrow-right" size={14} />
                  </Link>
                </article>
                <article className={styles.researchCard}>
                  <HrIcon name="briefcase" size={20} />
                  <h3>Compare open roles</h3>
                  <p>Scan matched postings and required skills before you commit to an application.</p>
                  <Link to="/jobs">
                    Explore jobs
                    <HrIcon name="arrow-right" size={14} />
                  </Link>
                </article>
                <article className={styles.researchCard}>
                  <HrIcon name="user" size={20} />
                  <h3>Keep profile market-ready</h3>
                  <p>Location, experience, and skills drive which jobs surface in your feed.</p>
                  <Link to="/profile">
                    Update profile
                    <HrIcon name="arrow-right" size={14} />
                  </Link>
                </article>
              </div>
            </section>

            <div className={styles.reviewWrap}>
              <CandidateReviewEvents sessionId={interview?.sessionId} />
            </div>
          </div>

          <aside className={styles.sideStack}>
            <section className={styles.card} aria-labelledby="apps-heading">
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.eyebrow}>Pipeline</p>
                  <h2 id="apps-heading">Application activity</h2>
                </div>
                <Link to="/applications">
                  View all
                  <HrIcon name="arrow-right" size={15} />
                </Link>
              </div>
              {!appsReady ? (
                <p className={styles.empty}>{loading ? 'Loading applications…' : 'Applications unavailable.'}</p>
              ) : recent.length ? (
                <ul className={styles.rows}>
                  {recent.map(app => (
                    <li key={app.id}>
                      <div>
                        <Link to="/applications">{app.title}</Link>
                        <p>{app.company} · {dateLabel(app.appliedAt)}</p>
                      </div>
                      <span className={`${styles.badge} ${statusBadgeClass(app.status)}`}>{app.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.empty}>
                  <div className={styles.emptyIconWrap}><HrIcon name="document" size={24} /></div>
                  <h3>No applications yet</h3>
                  <p>Apply to a matched role — status updates from employers show here in real time.</p>
                  <Link to="/jobs">Find roles <HrIcon name="arrow-right" size={15} /></Link>
                </div>
              )}
            </section>
          </aside>
        </div>
        </div>
      </div>
    </div>
    </div>
  )
}
