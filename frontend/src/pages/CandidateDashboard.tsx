import { CandidateReviewEvents } from '../components/CandidateReviewEvents'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { HrIcon } from '../components/HrIcon'
import { apiMe, apiListApplications } from '../lib/api'
import { fetchOpenJobs } from '../lib/vendorApi'
import { getUser, getProfile, getInterviewResult, profileKey, rankPostedJobs, type Application, type RankedJob, type InterviewResult } from '../lib/store'
import styles from './CandidateDashboard.module.css'

function dateLabel(value?: string) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unavailable'
}

export function DashboardPage() {
  const user = getUser()
  const [profile, setProfile] = useState(getProfile)
  const [interview, setInterview] = useState(getInterviewResult)
  const [jobs, setJobs] = useState<RankedJob[]>([])
  const [jobCount, setJobCount] = useState(0)
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [jobsReady, setJobsReady] = useState(false)
  const [appsReady, setAppsReady] = useState(false)
  const [revision, setRevision] = useState(0)
  const email = user?.email
  const lastFocusRefresh = useRef(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErrors([])
      setJobsReady(false)
      setAppsReady(false)
      const failures: string[] = []
      const [account, roles, apps] = await Promise.allSettled([apiMe(), fetchOpenJobs({ summary: true }), apiListApplications()])
      if (cancelled || getUser()?.email !== email) return
      if (account.status === 'fulfilled' && account.value.user?.email?.toLowerCase() === email?.toLowerCase()) {
        const remote = account.value
        const localProfile = getProfile()
        if (remote.profile && (!localProfile || Date.parse(remote.profile.updatedAt || '') >= Date.parse(localProfile.updatedAt || ''))) {
          localStorage.setItem(profileKey(email), JSON.stringify(remote.profile))
          setProfile(getProfile())
        }
        const localInterview = getInterviewResult()
        const remoteInterview = remote.interview as InterviewResult | null
        if (remoteInterview && (!localInterview || Date.parse(remoteInterview.date) >= Date.parse(localInterview.date))) {
          localStorage.setItem(`hireright.interviewResult.${email}`, JSON.stringify(remoteInterview))
          setInterview(remoteInterview)
        } else if (localInterview && (!remoteInterview || Date.parse(localInterview.date) > Date.parse(remoteInterview.date))) {
          failures.push('Your latest report is saved on this device; its server copy is not yet confirmed.')
        }
      } else failures.push('Profile and report could not be refreshed. Showing the last data saved on this device.')
      if (roles.status === 'fulfilled') {
        setJobs(rankPostedJobs(roles.value.jobs))
        setJobCount(roles.value.total ?? roles.value.jobs.length)
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

  const name = profile?.fullName || user?.name || 'Candidate'
  const hasScore = !!interview && Number.isFinite(interview.overall)
  const categories = interview?.categories?.filter(c => Number.isFinite(c.score)) ?? []
  const recent = [...applications].sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt)).slice(0, 4)

  return <div className={styles.page}>
    <main className={styles.main}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>YOUR CAREER WORKSPACE</p><h1>Welcome back, {name.split(' ')[0]}.</h1><p>Your interview insights and next steps, in one place.</p></div>
        <div className={styles.actions}>
          {hasScore ? (
            <Link to="/dashboard/report" className={styles.primary}>
              <HrIcon name="document" size={17} />
              View Report
            </Link>
          ) : (
            <button type="button" className={styles.primary} disabled>
              <HrIcon name="document" size={17} />
              View Report
            </button>
          )}
        </div>
      </header>
      {loading && <p className={styles.sync} role="status">Refreshing your dashboard…</p>}
      {errors.length > 0 && <div className={styles.alert} role="alert">{errors.map(error => <p key={error}>{error}</p>)}<button className={styles.secondary} onClick={() => setRevision(n => n + 1)} disabled={loading}>Retry refresh</button></div>}
      <section className={styles.metrics} aria-label="Your overview">
        <article><span>Interview score</span><strong>{hasScore ? interview.overall : '—'}{hasScore && <small>/100</small>}</strong><p>{hasScore ? 'From your latest interview' : 'Available after your interview'}</p></article>
        <article><span>Applications</span><strong>{appsReady ? applications.length : '—'}</strong><p>{appsReady ? `${applications.filter(a => a.status === 'In Review').length} in review` : loading ? 'Loading applications' : 'Temporarily unavailable'}</p></article>
        <article><span>Open roles</span><strong>{jobsReady ? jobCount : '—'}</strong><p>{jobsReady ? 'Currently listed by employers' : loading ? 'Loading open roles' : 'Temporarily unavailable'}</p></article>
      </section>
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={styles.card}>
            <div className={styles.sectionHead}><div><p className={styles.eyebrow}>LATEST ASSESSMENT</p><h2>Your interview performance</h2></div><HrIcon name="chart" size={22} /></div>
            <p className={styles.muted}>AI-generated feedback from your answers. This is not a hiring decision.</p>
            {categories.length ? <div className={styles.scores}>{categories.map((category, i) => <div key={`${category.label}-${i}`}><div className={styles.scoreLabel}><span>{category.label}</span><strong>{category.score}<small> /100</small></strong></div><progress aria-label={category.label} value={category.score} max={100} /></div>)}</div> : <p className={styles.empty}>{hasScore ? 'A detailed category breakdown is not available for this interview.' : 'Your assessed skills will appear here after your interview.'}</p>}
            <div className={styles.feedback}>
              <div><h3><HrIcon name="check" size={16} />Your strengths</h3>{interview?.strengths?.length ? <ul>{interview.strengths.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}</ul> : <p>No strengths feedback available yet.</p>}</div>
              <div><h3><HrIcon name="trending" size={16} />Focus next</h3>{interview?.improvements?.length ? <ul>{interview.improvements.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}</ul> : <p>No improvement feedback available yet.</p>}</div>
            </div>
            {hasScore && <div className={styles.cardFooter}><Link to="/dashboard/report">Explore answer-by-answer feedback <HrIcon name="arrow-right" size={15} /></Link><Link to="/interview">Practice with another interview</Link></div>}
          </section>
          <section className={styles.card}>
            <div className={styles.sectionHead}><h2>Application activity</h2><Link to="/applications">View all <HrIcon name="arrow-right" size={15} /></Link></div>
            {!appsReady ? <p className={styles.empty}>{loading ? 'Loading your applications…' : 'Application activity is unavailable. Retry refresh above.'}</p> : recent.length ? <ul className={styles.rows}>{recent.map(app => <li key={app.id}><div><Link to="/applications">{app.title}</Link><p>{app.company} · {dateLabel(app.appliedAt)}</p></div><span className={styles.badge}>{app.status}</span></li>)}</ul> : <div className={styles.empty}><HrIcon name="briefcase" size={26} /><h3>Your applications will appear here</h3><p>Find a role that fits, then track its progress here.</p><Link to="/jobs">Explore open roles →</Link></div>}
          </section>
          <section className={styles.card}>
            <div className={styles.sectionHead}><h2>Explore opportunities</h2><HrIcon name="briefcase" size={20} /></div>
            <p className={styles.muted}>Open employer listings. Review each role's requirements before applying.</p>
            {!jobsReady ? <p className={styles.empty}>{loading ? 'Loading roles…' : 'Roles are unavailable. Retry refresh above.'}</p> : jobs.length ? <ul className={styles.rows}>{jobs.slice(0, 3).map((job, i) => <li key={job.id || i}><div><Link to="/jobs">{job.title}</Link><p>{job.company}</p><p>{job.location}</p></div></li>)}</ul> : <p className={styles.empty}>No open roles at the moment. Check back for new opportunities.</p>}
            <Link to="/jobs">Browse all roles <HrIcon name="arrow-right" size={15} /></Link>
          </section>
        </div>
      </div>
      <p className={styles.footnote}>Your dashboard uses your saved profile, latest interview and employer application updates.</p>
    <CandidateReviewEvents sessionId={interview?.sessionId} />
    </main>
  </div>
}
