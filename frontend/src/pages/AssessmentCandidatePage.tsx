import { useEffect, useState, type FormEvent } from 'react'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { HrIcon } from '../components/HrIcon'
import { ensureApiSession } from '../lib/apiSession'
import {
  fetchAssessmentJobs,
  fileToBase64,
  generateAssessment,
  getAssessmentSession,
  repeatAssessmentQuestion,
  startAssessmentSession,
  submitAssessmentAnswer,
  uploadAssessmentResume,
  type AssessmentJob,
  type AssessmentSessionView,
} from '../lib/assessmentApi'
import styles from './AssessmentPages.module.css'

function newRequestId() {
  return crypto.randomUUID()
}

export function AssessmentCandidatePage() {
  const [jobs, setJobs] = useState<AssessmentJob[]>([])
  const [jobId, setJobId] = useState('')
  const [resumeId, setResumeId] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [session, setSession] = useState<AssessmentSessionView | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [answer, setAnswer] = useState('')
  const [quickMsg, setQuickMsg] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        await ensureApiSession()
        const { jobs: open } = await fetchAssessmentJobs()
        setJobs(open)
        if (open[0]) setJobId(open[0].id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load assessment jobs')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = (e.currentTarget.elements.namedItem('resume') as HTMLInputElement)?.files?.[0]
    if (!input) return
    setBusy(true)
    setError('')
    try {
      const b64 = await fileToBase64(input)
      const res = await uploadAssessmentResume(input.name, b64)
      setResumeId(res.resume_id)
      setResumeText(res.extracted_text.slice(0, 2000))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleGenerate() {
    if (!jobId || !resumeId) {
      setError('Upload a resume and select a job first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await generateAssessment({ job_id: jobId, resume_id: resumeId, consent: true })
      setSessionId(created.session_id)
      setSession(await getAssessmentSession(created.session_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate plan')
    } finally {
      setBusy(false)
    }
  }

  async function reloadSession(id: string) {
    const s = await getAssessmentSession(id)
    setSession(s)
    setSessionId(id)
    return s
  }

  async function handleStart() {
    if (!sessionId || !session) return
    setBusy(true)
    setError('')
    try {
      const s = await startAssessmentSession(sessionId, session.version)
      setSession(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot start — recruiter may need to approve')
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmitAnswer(e: FormEvent) {
    e.preventDefault()
    if (!sessionId || !session?.current_question) return
    setBusy(true)
    setError('')
    setQuickMsg('')
    try {
      const result = await submitAssessmentAnswer(sessionId, {
        message: answer.trim(),
        question_id: session.current_question.question_id,
        version: session.version,
        request_id: newRequestId(),
      })
      setAnswer('')
      if (result.response) setQuickMsg(result.response)
      setSession(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRepeat() {
    if (!sessionId) return
    setBusy(true)
    try {
      const r = await repeatAssessmentQuestion(sessionId)
      setQuickMsg(r.response || 'Question repeated.')
      await reloadSession(sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repeat failed')
    } finally {
      setBusy(false)
    }
  }

  const inInterview = session?.status === 'in_progress'
  const awaitingApproval = session?.awaiting_recruiter_approval || session?.plan_status === 'created'

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />
        <section className={styles.hero}>
          <h1>Professional assessment interview</h1>
          <p>
            Seven structured questions with rubric scoring. Upload your resume, pick a role, and
            complete the interview after your recruiter approves the plan.
          </p>
        </section>

        {error && <p className={styles.error}>{error}</p>}

        {!sessionId && (
          <div className={styles.grid2}>
            <div className={styles.card}>
              <h2>1. Upload resume</h2>
              <form onSubmit={handleUpload}>
                <input type="file" name="resume" accept=".pdf,.doc,.docx" required />
                <button type="submit" className={styles.btn} disabled={busy} style={{ marginTop: 12 }}>
                  Upload & extract
                </button>
              </form>
              {resumeId && (
                <p style={{ fontSize: '0.85rem', color: '#059669', marginTop: 8 }}>
                  Resume saved · {resumeId.slice(0, 8)}…
                </p>
              )}
              {resumeText && (
                <textarea className={styles.textarea} readOnly value={resumeText} style={{ marginTop: 8, minHeight: 80 }} />
              )}
            </div>

            <div className={styles.card}>
              <h2>2. Select job & generate plan</h2>
              {loading ? (
                <p>Loading jobs…</p>
              ) : jobs.length === 0 ? (
                <p style={{ color: '#64748b' }}>No assessment jobs published yet. Ask your recruiter.</p>
              ) : (
                <>
                  <label className={styles.label}>Role</label>
                  <select
                    className={styles.select}
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                  >
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.title} — {j.organization_name || 'Organization'}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={styles.btn} disabled={busy || !resumeId} onClick={() => void handleGenerate()}>
                    Generate 7-question plan
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {sessionId && session && (
          <div className={styles.card} style={{ marginTop: 24 }}>
            <div className={styles.progress}>
              Session {sessionId.slice(0, 8)}… · Status: <strong>{session.status}</strong> · Plan:{' '}
              {session.plan_status || '—'}
            </div>

            {awaitingApproval && (
              <p style={{ color: '#b45309', fontWeight: 600 }}>
                Waiting for recruiter to approve your interview plan. Refresh this page in a moment.
              </p>
            )}

            {session.status === 'ready' && (
              <button type="button" className={styles.btn} disabled={busy} onClick={() => void handleStart()}>
                Start interview
              </button>
            )}

            {inInterview && session.current_question && (
              <>
                <div className={styles.questionBox}>
                  <div className={styles.progress}>
                    Question {session.current_question_index + 1} of {session.total_questions}
                  </div>
                  <p style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>
                    {session.current_question.question_text}
                  </p>
                </div>
                {quickMsg && <div className={styles.quickReply}>{quickMsg}</div>}
                <form onSubmit={handleSubmitAnswer}>
                  <textarea
                    className={styles.textarea}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Type your answer… (or use Repeat for the question again)"
                    required
                  />
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button type="submit" className={styles.btn} disabled={busy}>
                      Submit answer
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={() => void handleRepeat()}
                    >
                      Repeat question
                    </button>
                  </div>
                </form>
              </>
            )}

            {session.status === 'completed' && (
              <p style={{ color: '#059669', fontWeight: 700 }}>
                <HrIcon name="check" size={18} /> Assessment complete. Your recruiter can view the full report.
              </p>
            )}

            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              style={{ marginTop: 16 }}
              onClick={() => void reloadSession(sessionId)}
            >
              Refresh status
            </button>
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  )
}
