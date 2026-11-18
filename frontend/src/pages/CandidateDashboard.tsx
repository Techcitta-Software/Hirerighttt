import { useEffect, useRef, useState } from 'react'
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
  missingRequiredProfileFields,
  profileCheckHref,
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
      setJobsReady(false)
      setAppsReady(false)

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
      } else {
        setJobs([])
        setJobCount(0)
        setJobsReady(true)
      }

      if (apps.status === 'fulfilled') {
        setApplications(apps.value)
        setAppsReady(true)
      } else {
        setApplications([])
        setAppsReady(true)
      }

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
  const missingRequired = missingRequiredProfileFields(profile, user)
  const missingOptional = profileFieldChecks(profile, user).filter(
    (c) => !c.required && !c.done,
  )
  const missingDetails = missingRequired
  const completion = profileCompletionPercent(profile, user)
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'HR'
  const inReviewCount = applications.filter((a) => a.status === 'In Review').length
  const interviewStageCount = applications.filter((a) => a.status === 'Interview').length
  const offerCount = applications.filter((a) => a.status === 'Offer').length
  const readinessScore = hasScore
    ? Math.round((completion + overallScore) / 2)
    : completion
  const topMatch = jobs[0] ?? null

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

  const requiredTotal = profileChecks.filter((c) => c.required).length
  const requiredDone = profileChecks.filter((c) => c.required && c.done).length
  const hasProfileGaps = missingRequired.length > 0 || missingOptional.length > 0

  /* One prominent "next step": the most useful thing to do right now. */
  const nextStep = missingRequired.length
    ? {
        title: 'Finish your profile',
        body: `${requiredDone} of ${requiredTotal} required details added. Employers see your profile when you apply.`,
        to: profileCheckHref(missingRequired[0]),
        cta: 'Continue profile',
        icon: 'user' as const,
      }
    : !hasScore
      ? {
          title: 'Take your AI interview',
          body: 'A short voice interview about your experience. Your score is shared with employers when you apply.',
          to: '/interview',
          cta: 'Start interview',
          icon: 'mic' as const,
        }
      : {
          title: 'Your interview report is ready',
          body: `You scored ${overallScore} out of 100. See what went well and what to work on next.`,
          to: '/dashboard/report',
          cta: 'View report',
          icon: 'document' as const,
        }

  return (
    <div className={styles.pageBleed}>
    <div className={styles.page}>
      <div className={styles.main}>
        <header className={styles.heroBand}>
          <div className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>Welcome back, {firstName}</h1>
              <p>Your profile, interview score and applications in one place.</p>
            </div>
            <div className={styles.heroActions}>
              {hasScore ? (
                <>
                  <Link to="/dashboard/report" className={styles.secondary}>
                    <HrIcon name="document" size={16} />
                    View report
                  </Link>
                  <Link to="/pricing/retake" className={styles.ghost}>
                    <HrIcon name="trending" size={16} />
                    Improve your score?
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/interview" className={styles.secondary}>
                    <HrIcon name="sparkle" size={16} />
                    Start AI interview
                  </Link>
                  <Link to="/pricing/retake" className={styles.ghost}>
                    <HrIcon name="trending" size={16} />
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

        <section className={styles.nextStep} aria-labelledby="next-step-heading">
          <span className={styles.nextStepIcon} aria-hidden="true">
            <HrIcon name={nextStep.icon} size={22} />
          </span>
          <div className={styles.nextStepCopy}>
            <p className={styles.nextStepLabel}>Next step</p>
            <h2 id="next-step-heading">{nextStep.title}</h2>
            <p>{nextStep.body}</p>
            {missingRequired.length > 0 && (
              <div className={styles.nextStepProgress}>
                <progress value={completion} max={100} aria-label="Profile completion" />
                <span>{completion}% complete</span>
              </div>
            )}
          </div>
          <div className={styles.nextStepActions}>
            <Link to={nextStep.to} className={styles.primary}>
              {nextStep.cta}
              <HrIcon name="arrow-right" size={16} />
            </Link>
            {hasProfileGaps && (
              <a href="#complete-profile" className={styles.textLink}>
                View checklist
              </a>
            )}
          </div>
        </section>

        <section className={styles.kpiGrid} aria-label="Overview">
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Interview score</span>
            <strong className={styles.kpiValue}>
              {hasScore ? overallScore : '—'}
              {hasScore && <small>/100</small>}
            </strong>
            <p className={styles.kpiHint}>{hasScore ? 'Latest AI assessment' : 'Complete an interview to unlock'}</p>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Applications</span>
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
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Matched roles</span>
            <strong className={styles.kpiValue}>{jobsReady ? jobCount : '—'}</strong>
            <p className={styles.kpiHint}>{jobsReady ? 'Open roles that fit your profile' : loading ? 'Loading…' : 'Unavailable'}</p>
          </div>
        </section>

        {hasProfileGaps && (
          <section id="complete-profile" className={`${styles.card} ${styles.completionSection}`} aria-labelledby="completion-heading">
            <div className={styles.cardHeader}>
              <div>
                <h2 id="completion-heading">Complete your profile</h2>
                <p className={styles.muted}>
                  {missingRequired.length > 0
                    ? `${missingRequired.length} required item${missingRequired.length === 1 ? '' : 's'} missing. Each link opens the right section.`
                    : 'Core profile complete. A few optional details can still help.'}
                </p>
              </div>
              <span className={styles.countBadge}>
                {requiredDone} / {requiredTotal} required
              </span>
            </div>
            <ul className={styles.checklist}>
              {[...missingRequired, ...missingOptional].map(item => (
                <li key={item.label}>
                  <Link to={profileCheckHref(item)} className={styles.checkRow}>
                    <span className={styles.checkIcon} aria-hidden="true">
                      <HrIcon name={item.icon} size={18} />
                    </span>
                    <span className={styles.checkText}>
                      <strong>
                        {item.label}
                        {!item.required && <span className={styles.optionalTag}>Optional</span>}
                      </strong>
                      <span>{item.hint}</span>
                    </span>
                    <span className={styles.checkAction}>
                      Add
                      <HrIcon name="arrow-right" size={15} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={styles.contentGrid}>
          <div className={styles.primaryCol}>
            <section className={styles.card} aria-labelledby="interview-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="interview-heading">Interview performance</h2>
                  <p className={styles.muted}>AI feedback on your answers. This is not a hiring decision.</p>
                </div>
              </div>

              {hasScore && (
                <div className={styles.scoreHero}>
                  <div className={styles.scoreBig}>
                    {overallScore}
                    <span>/100</span>
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
                    <div key={dimension.key} className={styles.scoreRow}>
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
                      <progress aria-label={dimension.title} value={dimension.score} max={100} />
                      <p className={styles.dimensionCaption}>{dimension.caption}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.inlineEmpty}>
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

            <section className={styles.card} aria-labelledby="jobs-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="jobs-heading">Roles matched to you</h2>
                  <p className={styles.muted}>Open roles that fit your profile.</p>
                </div>
                <Link to="/jobs" className={styles.headerLink}>
                  View all
                  <HrIcon name="arrow-right" size={15} />
                </Link>
              </div>

              {topMatch && jobsReady && (
                <div className={styles.featuredJob} role="group" aria-label="Top matched role">
                  <div className={styles.featuredJobCopy}>
                    <span className={styles.topMatchTag}>
                      <HrIcon name="star" size={13} />
                      Top match for you
                    </span>
                    <h3>{topMatch.title}</h3>
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
                        <span className={styles.matchPill}>{topMatch.match}% profile match</span>
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
                      className={styles.secondary}
                    >
                      View & apply
                      <HrIcon name="arrow-up-right" size={16} />
                    </Link>
                    <Link to="/jobs" className={styles.textLink}>
                      All matches
                    </Link>
                  </div>
                </div>
              )}

              {!jobsReady ? (
                <p className={styles.inlineEmpty} role="status">{loading ? 'Loading roles…' : 'Roles unavailable — retry above.'}</p>
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
                        <h3>{job.title}</h3>
                        <p className={styles.company}>{job.company}</p>
                        <p className={styles.jobLocation}>
                          <HrIcon name="map-pin" size={14} />
                          {job.location || 'Location flexible'}
                        </p>
                        <Link
                          to={job.shareableCode ? buildApplyPath(job.company, job.shareableCode) : `/jobs?job=${encodeURIComponent(job.id || '')}`}
                          aria-label={`View ${job.title} at ${job.company}`}
                        >
                          View role
                          <HrIcon name="arrow-up-right" size={16} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className={styles.railControls}>
                    <span>Scroll or use the arrows to browse</span>
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
                  <h3>No matches yet</h3>
                  <p>
                    {missingDetails.some((m) => m.section === 'role')
                      ? 'Add your target role on your profile to unlock tailored matches.'
                      : 'New employer roles appear here when they match your profile.'}
                  </p>
                  <Link to="/jobs" className={styles.secondary}>
                    Browse all jobs
                  </Link>
                </div>
              )}
            </section>

            <section className={styles.card} aria-labelledby="research-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="research-heading">Stay interview-ready</h2>
                  <p className={styles.muted}>Simple steps to take before an employer looks at your profile.</p>
                </div>
              </div>
              <ul className={styles.researchList}>
                <li>
                  <span className={styles.researchIcon} aria-hidden="true"><HrIcon name="chart" size={18} /></span>
                  <div>
                    <h3>Review your score breakdown</h3>
                    <p>See which areas employers notice first in your interview.</p>
                  </div>
                  <Link to={hasScore ? '/dashboard/report' : '/interview'}>
                    {hasScore ? 'Open report' : 'Take interview'}
                    <HrIcon name="arrow-right" size={14} />
                  </Link>
                </li>
                <li>
                  <span className={styles.researchIcon} aria-hidden="true"><HrIcon name="briefcase" size={18} /></span>
                  <div>
                    <h3>Compare open roles</h3>
                    <p>Check the required skills before you apply.</p>
                  </div>
                  <Link to="/jobs">
                    Explore jobs
                    <HrIcon name="arrow-right" size={14} />
                  </Link>
                </li>
                <li>
                  <span className={styles.researchIcon} aria-hidden="true"><HrIcon name="user" size={18} /></span>
                  <div>
                    <h3>Keep your profile up to date</h3>
                    <p>Location, experience and skills decide which jobs you see.</p>
                  </div>
                  <Link to="/profile">
                    Update profile
                    <HrIcon name="arrow-right" size={14} />
                  </Link>
                </li>
              </ul>
            </section>
          </div>

          <aside className={styles.sideStack} aria-label="Profile and applications">
            <section className={styles.card} aria-labelledby="profile-heading">
              <div className={styles.profileIdentity}>
                <div className={styles.avatar} aria-hidden="true">{initials}</div>
                <div className={styles.profileInfo}>
                  <h2 id="profile-heading">{profile?.fullName?.trim() || user?.name || email}</h2>
                  {profile?.currentRole?.trim() ? <p className={styles.role}>{profile.currentRole}</p> : null}
                </div>
              </div>
              {chips.length > 0 && (
                <ul className={styles.chipRow}>
                  {chips.map((chip) => (
                    <li className={styles.chip} key={`${chip.icon}-${chip.text}`}>
                      <HrIcon name={chip.icon} size={14} />
                      <span>{chip.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.readiness}>
                <div className={styles.readinessHead}>
                  <span>Career readiness</span>
                  <strong>{readinessScore}%</strong>
                </div>
                <progress value={readinessScore} max={100} aria-label="Career readiness" />
                <p>Profile {completion}% + {hasScore ? 'interview score' : 'interview pending'}</p>
              </div>
              <div className={styles.profileCtaRow}>
                <Link to="/profile" className={styles.secondary}>
                  <HrIcon name="user" size={16} />
                  {missingDetails.length ? 'Complete profile' : 'Edit profile'}
                </Link>
                {profile?.updatedAt && (
                  <p className={styles.updated}>Updated {dateLabel(profile.updatedAt)}</p>
                )}
              </div>
            </section>

            <section className={styles.card} aria-labelledby="apps-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="apps-heading">Applications</h2>
                </div>
                <Link to="/applications" className={styles.headerLink}>
                  View all
                  <HrIcon name="arrow-right" size={15} />
                </Link>
              </div>
              {appsReady && applications.length > 0 && (
                <dl className={styles.pipelineBar} aria-label="Application pipeline">
                  <div className={styles.pipelineStep}>
                    <dt>Submitted</dt>
                    <dd>{applications.length}</dd>
                  </div>
                  <div className={styles.pipelineStep}>
                    <dt>In review</dt>
                    <dd>{inReviewCount}</dd>
                  </div>
                  <div className={styles.pipelineStep}>
                    <dt>Interview</dt>
                    <dd>{interviewStageCount}</dd>
                  </div>
                  <div className={styles.pipelineStep}>
                    <dt>Offers</dt>
                    <dd>{offerCount}</dd>
                  </div>
                </dl>
              )}
              {!appsReady ? (
                <p className={styles.inlineEmpty}>{loading ? 'Loading applications…' : 'Applications unavailable.'}</p>
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
                  <h3>No applications yet</h3>
                  <p>Apply to a matched role. Updates from employers show here.</p>
                  <Link to="/jobs" className={styles.textLink}>Find roles <HrIcon name="arrow-right" size={15} /></Link>
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
