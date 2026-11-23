import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { HrIcon } from '../components/HrIcon'
import { Score } from '../components/Score'
import { ensureApiSession } from '../lib/apiSession'
import { candidateScore, needsIntegrityReview } from '../lib/candidateSearch'
import { filterJobSeekerCandidates, isOwnOrgCandidate, mapOrgCandidate } from '../lib/employerCandidateUtils'
import { getUser, type EmployerApplicant } from '../lib/store'
import { fetchOrganizationCandidates, fetchVendorJobs, type VendorJob } from '../lib/vendorApi'
import shell from './EmployerDashboard.module.css'
import styles from './VendorDashboardPage.module.css'

const PIPELINE: Array<{ status: EmployerApplicant['status']; label: string; tone: string }> = [
  { status: 'New', label: 'New', tone: styles.toneNew },
  { status: 'In Review', label: 'In review', tone: styles.toneReview },
  { status: 'Shortlisted', label: 'Shortlisted', tone: styles.toneShortlisted },
  { status: 'Rejected', label: 'Rejected', tone: styles.toneRejected },
]

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function formatFullDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Vendor home: headline numbers, the hiring pipeline and what needs attention.
 * Job management lives on /employer/jobs. A job's applications open at /employer/jobs?jobId=.
 */
export function VendorDashboardPage() {
  const user = getUser()
  const [jobs, setJobs] = useState<VendorJob[]>([])
  const [candidates, setCandidates] = useState<EmployerApplicant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!user || user.role !== 'employer') return
      setLoading(true)
      setError('')
      try {
        // The session check is itself an API request, so no separate /api/health ping first.
        if (!(await ensureApiSession())) {
          throw new Error('Could not reach the server. Check your connection and try again.')
        }
        // scope=org: only this organisation's own candidates (not the platform-wide talent pool).
        const [jobsRes, candidatesRes] = await Promise.all([
          fetchVendorJobs(),
          fetchOrganizationCandidates({ scope: 'org' }),
        ])
        if (cancelled) return
        setJobs(jobsRes.jobs)
        // Keep the client-side filter as a safety net (older APIs ignore scope=org).
        setCandidates(filterJobSeekerCandidates(candidatesRes.candidates).filter(isOwnOrgCandidate).map(mapOrgCandidate))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your dashboard.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.role])

  const stats = useMemo(() => {
    const jobIdsWithApplicants = new Set(candidates.map((c) => c.jobId).filter(Boolean))
    const interviewed = candidates.filter((c) => Boolean(c.interviewResult))
    const scores = interviewed.map((c) => candidateScore(c)).filter((s): s is number => s !== null)
    const weekAgo = Date.now() - WEEK_MS
    const byStatus: Record<string, number> = {}
    for (const c of candidates) {
      const key = c.status === 'Interviewing' ? 'In Review' : c.status
      byStatus[key] = (byStatus[key] || 0) + 1
    }
    const perJob = jobs
      .map((j) => ({ id: j.id, title: j.title, count: candidates.filter((c) => c.jobId === j.id).length }))
      .sort((a, b) => b.count - a.count)
    return {
      allJobs: jobs.length,
      activeJobs: jobs.filter((j) => jobIdsWithApplicants.has(j.id)).length,
      totalCandidates: candidates.length,
      interviewsCompleted: interviewed.length,
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      strong: scores.filter((s) => s >= 70).length,
      awaitingInterview: candidates.length - interviewed.length,
      integrityReview: candidates.filter((c) => needsIntegrityReview(c)).length,
      newThisWeek: candidates.filter((c) => new Date(c.appliedAt).getTime() >= weekAgo).length,
      jobsWithoutApplicants: perJob.filter((j) => j.count === 0).length,
      byStatus,
      perJob,
    }
  }, [jobs, candidates])

  const recent = useMemo(
    () => [...candidates].sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt))).slice(0, 6),
    [candidates],
  )
  const top = useMemo(
    () =>
      candidates
        .filter((c) => candidateScore(c) !== null)
        .sort((a, b) => (candidateScore(b) ?? 0) - (candidateScore(a) ?? 0))
        .slice(0, 5),
    [candidates],
  )

  const tiles = [
    { label: 'All jobs', value: stats.allJobs, hint: 'Openings you have posted', to: '/employer/jobs' },
    { label: 'Active jobs', value: stats.activeJobs, hint: 'Openings with applicants', to: '/employer/jobs' },
    { label: 'Applicants', value: stats.totalCandidates, hint: `${stats.newThisWeek} new this week`, to: '/employer/jobs' },
    {
      label: 'Interviews completed',
      value: stats.interviewsCompleted,
      hint: stats.averageScore !== null ? `Average score ${stats.averageScore}/100` : 'No scores yet',
      to: '/employer/jobs',
    },
  ]

  const pipelineMax = Math.max(1, ...PIPELINE.map((p) => stats.byStatus[p.status] || 0))
  const perJobMax = Math.max(1, ...stats.perJob.map((j) => j.count))

  const attention = [
    {
      count: stats.awaitingInterview,
      text: stats.awaitingInterview === 1 ? 'applicant has not taken the AI interview' : 'applicants have not taken the AI interview',
      to: '/employer/jobs',
      icon: 'clock' as const,
    },
    {
      count: stats.integrityReview,
      text: stats.integrityReview === 1 ? 'interview flagged for integrity review' : 'interviews flagged for integrity review',
      to: '/employer/jobs',
      icon: 'shield' as const,
    },
    {
      count: stats.jobsWithoutApplicants,
      text: stats.jobsWithoutApplicants === 1 ? 'opening has no applicants yet' : 'openings have no applicants yet',
      to: '/employer/jobs',
      icon: 'briefcase' as const,
    },
  ].filter((a) => a.count > 0)

  return (
    <div className={shell.pageBleed}>
      <div className={shell.page}>
        <div className={shell.shell}>
          <header className={shell.pageHeader}>
            <div>
              <h1 className={shell.pageTitle}>Dashboard</h1>
              <p className={shell.pageSub}>{user?.companyName || 'Your organization'} · What needs you today and how hiring is going.</p>
            </div>
            <div className={shell.pageActions}>
              <Link to="/employer/jobs" className={shell.btnSecondary}>
                <HrIcon name="search" size={16} /> Open jobs
              </Link>
              <Link to="/employer/jobs" state={{ createJob: true }} className={shell.btnPrimary}>
                <HrIcon name="plus" size={16} /> Create job
              </Link>
            </div>
          </header>

          {error && (
            <p className={`ds-alert ds-alert--error ${styles.error}`} role="alert">
              {error}
            </p>
          )}

          <section className={`${shell.panel} ${styles.section}`} aria-labelledby="vd-attention" aria-busy={loading}>
            <div className={shell.panelHeader}>
              <div>
                <h2 id="vd-attention" className={shell.panelTitle}>
                  Needs your attention
                </h2>
                <p className={shell.panelSub}>Things that are waiting on you.</p>
              </div>
            </div>
            {attention.length === 0 ? (
              loading ? (
                <LoadingRows label="Loading what needs your attention…" rows={3} />
              ) : (
                <p className={styles.allClear}>
                  <span className={styles.allClearIcon} aria-hidden="true">
                    <HrIcon name="check" size={14} />
                  </span>
                  Nothing is waiting on you.
                </p>
              )
            ) : (
              <ul className={styles.attention}>
                {attention.map((a) => (
                  <li key={a.text}>
                    <Link to={a.to} className={styles.attentionRow}>
                      <span className={styles.attentionIcon} aria-hidden="true">
                        <HrIcon name={a.icon} size={16} />
                      </span>
                      <span className={styles.attentionText}>
                        <strong>{a.count}</strong> {a.text}
                      </span>
                      <span className={styles.attentionGo}>
                        <span className={styles.attentionGoLabel}>Review</span>
                        <HrIcon name="arrow-right" size={16} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${styles.tiles} ${styles.section}`} aria-label="Key numbers">
            {tiles.map((t) => (
              <Link key={t.label} to={t.to} className={styles.tile}>
                <span className={styles.tileLabel}>{t.label}</span>
                <span className={styles.tileValue}>
                  {loading ? <span className={`ds-skeleton ${styles.tileSkeleton}`} aria-hidden="true" /> : t.value}
                </span>
                <span className={styles.tileHint}>{loading ? ' ' : t.hint}</span>
              </Link>
            ))}
          </section>

          <div className={`${styles.grid} ${styles.section}`}>
            <section className={shell.panel} aria-labelledby="vd-perjob" aria-busy={loading}>
              <div className={shell.panelHeader}>
                <div>
                  <h2 id="vd-perjob" className={shell.panelTitle}>
                    Applicants by opening
                  </h2>
                  <p className={shell.panelSub}>Which openings are drawing applicants.</p>
                </div>
                <Link to="/employer/jobs" className={`${shell.btnGhost} ${shell.btnSm}`}>
                  All jobs <HrIcon name="arrow-right" size={14} />
                </Link>
              </div>
              {stats.perJob.length === 0 ? (
                loading ? (
                  <LoadingRows label="Loading openings…" rows={6} />
                ) : (
                  <EmptyState icon="briefcase" title="No openings yet" body="Create a job to start collecting applicants." />
                )
              ) : (
                <table className={styles.miniTable}>
                  <thead>
                    <tr>
                      <th scope="col">Opening</th>
                      <th scope="col" className={styles.numCell}>
                        Applicants
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.perJob.slice(0, 6).map((j) => (
                      <tr key={j.id}>
                        <td>
                          <Link className={styles.jobName} title={j.title} to={`/employer/jobs?jobId=${encodeURIComponent(j.id)}`}>
                            {j.title}
                          </Link>
                          <span className={styles.barTrack} aria-hidden="true">
                            <span
                              className={`${styles.barFill} ${styles.toneNew}`}
                              style={{ width: `${(j.count / perJobMax) * 100}%` }}
                            />
                          </span>
                        </td>
                        <td className={styles.numCell}>
                          {j.count === 0 ? <span className={styles.zero}>0</span> : j.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className={shell.panel} aria-labelledby="vd-pipeline" aria-busy={loading}>
              <div className={shell.panelHeader}>
                <div>
                  <h2 id="vd-pipeline" className={shell.panelTitle}>
                    Hiring pipeline
                  </h2>
                  <p className={shell.panelSub}>Where your applicants stand right now.</p>
                </div>
              </div>
              <div className={styles.pipelineBody}>
                <ul className={styles.bars}>
                  {PIPELINE.map((p) => {
                    const count = stats.byStatus[p.status] || 0
                    return (
                      <li key={p.status} className={styles.barRow}>
                        <span className={styles.barLabel}>
                          <span className={`${styles.legendDot} ${p.tone}`} aria-hidden="true" />
                          {p.label}
                        </span>
                        <span className={styles.barTrack} aria-hidden="true">
                          {loading || count === 0 ? null : (
                            <span className={`${styles.barFill} ${p.tone}`} style={{ width: `${(count / pipelineMax) * 100}%` }} />
                          )}
                        </span>
                        <span className={styles.barCount}>
                          {loading ? <span className={`ds-skeleton ${styles.countSkeleton}`} aria-hidden="true" /> : count}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <dl className={styles.inlineStats}>
                  <div>
                    <dt>Average interview score</dt>
                    <dd>
                      {loading ? (
                        <span className={`ds-skeleton ${styles.tileSkeleton}`} aria-hidden="true" />
                      ) : (
                        <>
                          {stats.averageScore ?? '—'}
                          {stats.averageScore !== null && <span className={styles.statMax}>/100</span>}
                        </>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Scored 70 or above</dt>
                    <dd>
                      {loading ? <span className={`ds-skeleton ${styles.tileSkeleton}`} aria-hidden="true" /> : stats.strong}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className={shell.panel} aria-labelledby="vd-recent" aria-busy={loading}>
              <div className={shell.panelHeader}>
                <div>
                  <h2 id="vd-recent" className={shell.panelTitle}>
                    Recent activity
                  </h2>
                  <p className={shell.panelSub}>Latest applications and interviews.</p>
                </div>
              </div>
              {recent.length === 0 ? (
                loading ? (
                  <LoadingRows label="Loading recent activity…" rows={6} />
                ) : (
                  <EmptyState icon="clock" title="No activity yet" body="Share a job link to get started. New applications and interviews show here." />
                )
              ) : (
                <ul className={styles.list}>
                  {recent.map((c) => {
                    const score = candidateScore(c)
                    return (
                      <li key={c.id} className={styles.listRow}>
                        <span className={styles.listMain}>
                          <strong title={c.candidateName}>{c.candidateName}</strong>
                          <span>
                            {score !== null ? 'Completed the interview' : 'Applied'}
                            {c.jobTitle ? ` · ${c.jobTitle}` : ''}
                          </span>
                        </span>
                        {score !== null && <Score value={score} />}
                        <span className={styles.listDate} title={formatFullDate(c.appliedAt)}>
                          {formatDate(c.appliedAt)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className={shell.panel} aria-labelledby="vd-top" aria-busy={loading}>
              <div className={shell.panelHeader}>
                <div>
                  <h2 id="vd-top" className={shell.panelTitle}>
                    Top performers
                  </h2>
                  <p className={shell.panelSub}>Highest AI interview scores.</p>
                </div>
                <Link to="/employer/jobs" className={`${shell.btnGhost} ${shell.btnSm}`}>
                  All jobs <HrIcon name="arrow-right" size={14} />
                </Link>
              </div>
              {top.length === 0 ? (
                loading ? (
                  <LoadingRows label="Loading top performers…" rows={5} />
                ) : (
                  <EmptyState icon="star" title="No interview scores yet" body="Scores appear here once applicants complete their AI interview." />
                )
              ) : (
                <ol className={styles.list}>
                  {top.map((c, i) => (
                    <li key={c.id} className={styles.listRow}>
                      <span className={styles.rank}>{i + 1}</span>
                      <span className={styles.listMain}>
                        <strong title={c.candidateName}>{c.candidateName}</strong>
                        <span>{c.role || c.jobTitle || c.candidateEmail}</span>
                      </span>
                      <Score value={candidateScore(c) ?? 0} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section className={`${shell.panel} ${styles.shortcuts}`} aria-labelledby="vd-actions">
            <h2 id="vd-actions" className={styles.shortcutsTitle}>
              Quick actions
            </h2>
            <div className={styles.actions}>
              <Link to="/employer/jobs" state={{ createJob: true }} className={styles.action}>
                <HrIcon name="briefcase" size={16} /> Create or share a job opening
              </Link>
              <Link to="/employer/jobs" state={{ inviteDialog: true }} className={styles.action}>
                <HrIcon name="link" size={16} /> Send AI interview links
              </Link>
              <Link to="/employer/jobs" className={styles.action}>
                <HrIcon name="users" size={16} /> Review applicants and reports
              </Link>
              <Link to="/resumes" className={styles.action}>
                <HrIcon name="folder" size={16} /> Open the talent vault
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** Skeleton rows shaped like the list rows they replace (§2.12). */
function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className={styles.loading} role="status">
      <span className="ds-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className={`ds-skeleton ${styles.skeletonRow}`} aria-hidden="true" />
      ))}
    </div>
  )
}

/** Empty state inside a panel (§2.11, plain variant). */
function EmptyState({ icon, title, body }: { icon: 'briefcase' | 'clock' | 'star'; title: string; body: string }) {
  return (
    <div className={`ds-empty ds-empty--plain ${styles.empty}`}>
      <span className="ds-empty__icon" aria-hidden="true">
        <HrIcon name={icon} size={20} />
      </span>
      <p className="ds-empty__title">{title}</p>
      <p className="ds-empty__body">{body}</p>
    </div>
  )
}
