import { useEffect, useState, type FormEvent } from 'react'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { HrIcon } from '../components/HrIcon'
import { ensureApiSession } from '../lib/apiSession'
import { apiFetch } from '../lib/api'
import {
  approveAssessmentPlan,
  createAssessmentJob,
  defaultCompetencies,
  fetchAssessmentJobs,
  fetchAssessmentPlan,
  fetchAssessmentReport,
  getAssessmentSession,
  listAssessmentInterviews,
  type AssessmentJob,
} from '../lib/assessmentApi'
import styles from './AssessmentPages.module.css'

type OrgContext = { id: string; name: string }

export function AssessmentRecruiterPage() {
  const [org, setOrg] = useState<OrgContext | null>(null)
  const [jobs, setJobs] = useState<AssessmentJob[]>([])
  const [interviews, setInterviews] = useState<
    { id: string; candidate_id: string; status: string; created_at: string }[]
  >([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState('2–5 years')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [planPreview, setPlanPreview] = useState<string>('')
  const [reportJson, setReportJson] = useState<string>('')

  async function refresh(orgId: string) {
    const [jobRes, intRes] = await Promise.all([
      fetchAssessmentJobs(orgId),
      listAssessmentInterviews(orgId),
    ])
    setJobs(jobRes.jobs)
    setInterviews(intRes.interviews)
  }

  useEffect(() => {
    void (async () => {
      try {
        await ensureApiSession()
        const res = await apiFetch('/api/organization')
        if (!res.ok) throw new Error('Organization required')
        const data = await res.json()
        const o = data.organization as { id: string; name: string }
        setOrg({ id: o.id, name: o.name })
        await refresh(o.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load recruiter workspace')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function handleCreateJob(e: FormEvent) {
    e.preventDefault()
    if (!org) return
    setError('')
    try {
      await createAssessmentJob({
        organization_id: org.id,
        title: title.trim(),
        description: description.trim(),
        experience_level: level,
        competencies: defaultCompetencies(),
      })
      setTitle('')
      setDescription('')
      await refresh(org.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create job failed')
    }
  }

  async function handleApprove(sessionId: string) {
    setError('')
    try {
      const plan = await fetchAssessmentPlan(sessionId)
      if (plan.plan.status !== 'created') {
        setError('This plan is already approved.')
        return
      }
      const s = await getAssessmentSession(sessionId)
      await approveAssessmentPlan(sessionId, s.version)
      if (org) await refresh(org.id)
      setPlanPreview(JSON.stringify(plan.questions, null, 2))
      setSelectedSession(sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    }
  }

  async function handleReport(sessionId: string) {
    setError('')
    try {
      const report = await fetchAssessmentReport(sessionId)
      setReportJson(JSON.stringify(report, null, 2))
      setSelectedSession(sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report not ready')
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />
        <section className={styles.hero}>
          <h1>Structured assessments (7-question)</h1>
          <p>
            Create competency-based roles, approve AI-generated interview plans, and review scored
            reports — aligned with HireRight&apos;s structured assessment API.
          </p>
          {org && (
            <p style={{ marginTop: 8, fontSize: '0.85rem', color: '#6036eb', fontWeight: 700 }}>
              Organization: {org.name}
            </p>
          )}
        </section>

        {error && <p className={styles.error}>{error}</p>}
        {loading && <p>Loading…</p>}

        {!loading && org && (
          <div className={styles.grid2}>
            <div className={styles.card}>
              <h2>Create assessment job</h2>
              <form onSubmit={handleCreateJob}>
                <label className={styles.label}>Title</label>
                <input
                  className={styles.input}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="Senior Backend Engineer"
                />
                <label className={styles.label}>Experience level</label>
                <input
                  className={styles.input}
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  required
                />
                <label className={styles.label}>Job description</label>
                <textarea
                  className={styles.textarea}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  placeholder="Paste full JD — used for seven-question plan generation"
                />
                <button type="submit" className={styles.btn}>
                  <HrIcon name="plus" size={16} /> Create job
                </button>
              </form>
            </div>

            <div className={styles.card}>
              <h2>Assessment jobs ({jobs.length})</h2>
              {jobs.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>No jobs yet.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.9rem' }}>
                  {jobs.map((j) => (
                    <li key={j.id} style={{ marginBottom: 8 }}>
                      <strong>{j.title}</strong> · {j.experience_level}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {!loading && org && (
          <div className={styles.card} style={{ marginTop: 24 }}>
            <h2>Candidate sessions</h2>
            {interviews.length === 0 ? (
              <p style={{ color: '#64748b' }}>No sessions yet. Candidates start from Professional assessment.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Candidate</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.map((row) => (
                    <tr key={row.id}>
                      <td>{row.id.slice(0, 8)}…</td>
                      <td>{row.candidate_id.slice(0, 8)}…</td>
                      <td>
                        <span className={styles.badge}>{row.status}</span>
                      </td>
                      <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {!['completed', 'cancelled', 'failed'].includes(row.status) && (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnSecondary}`}
                            onClick={() => void handleApprove(row.id)}
                          >
                            Review & approve plan
                          </button>
                        )}
                        {row.status === 'completed' && (
                          <button type="button" className={styles.btn} onClick={() => void handleReport(row.id)}>
                            View report
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {selectedSession && planPreview && (
          <div className={styles.card} style={{ marginTop: 20 }}>
            <h2>Plan preview (session {selectedSession.slice(0, 8)}…)</h2>
            <pre style={{ fontSize: '0.75rem', overflow: 'auto', maxHeight: 320 }}>{planPreview}</pre>
          </div>
        )}

        {selectedSession && reportJson && (
          <div className={styles.card} style={{ marginTop: 20 }}>
            <h2>Assessment report</h2>
            <pre style={{ fontSize: '0.75rem', overflow: 'auto', maxHeight: 420 }}>{reportJson}</pre>
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  )
}
