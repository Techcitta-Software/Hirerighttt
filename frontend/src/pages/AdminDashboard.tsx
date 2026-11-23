import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'
import {
  ADMIN_JOBS,
  MONTHLY_TRENDS,
  PIPELINE_STAGES,
  SKILL_DEMAND,
  SOURCE_MIX,
  adminKpis,
  funnelFromCandidates,
  loadAdminCandidates,
  saveAdminCandidates,
  type AdminCandidate,
  type PipelineStage,
} from '../lib/adminAts'
import { useDialog } from '../components/useDialog'
import shell from './EmployerDashboard.module.css'
import styles from './AdminDashboard.module.css'

type Tab = 'overview' | 'candidates' | 'jobs' | 'pipeline' | 'matching' | 'analytics'

const TABS: { id: Tab; label: string; title: string }[] = [
  { id: 'overview', label: 'Dashboard', title: 'Admin dashboard' },
  { id: 'candidates', label: 'Candidates', title: 'Candidate directory' },
  { id: 'jobs', label: 'Jobs', title: 'Jobs management' },
  { id: 'pipeline', label: 'Pipeline', title: 'Kanban pipeline' },
  { id: 'matching', label: 'AI Matcher', title: 'AI candidate matcher' },
  { id: 'analytics', label: 'Analytics', title: 'Recruiter analytics' },
]

/**
 * Recruiter admin workspace. Lives inside the app shell (one nav, one brand); the sections are an
 * in-page tab bar and switch instantly.
 */
export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [candidates, setCandidates] = useState<AdminCandidate[]>(() => loadAdminCandidates())
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<PipelineStage | 'All'>('All')
  const [matchJobId, setMatchJobId] = useState(ADMIN_JOBS[0].id)
  const [selected, setSelected] = useState<AdminCandidate | null>(null)
  const closeDrawer = useCallback(() => setSelected(null), [])
  const drawer = useDialog<HTMLElement>(Boolean(selected), closeDrawer)

  const kpis = useMemo(() => adminKpis(candidates, ADMIN_JOBS), [candidates])
  const funnel = useMemo(() => funnelFromCandidates(candidates), [candidates])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates.filter((c) => {
      const hit =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.skills?.some((s) => s.toLowerCase().includes(q)) ||
        c.currentTitle.toLowerCase().includes(q)
      const stageOk = stageFilter === 'All' || c.stage === stageFilter
      return hit && stageOk
    })
  }, [candidates, query, stageFilter])

  const matchRows = useMemo(() => {
    return [...candidates]
      .filter((c) => !c.appliedJobId || c.appliedJobId === matchJobId)
      .sort((a, b) => b.overallMatchScore - a.overallMatchScore)
  }, [candidates, matchJobId])

  function updateStage(id: string, stage: PipelineStage) {
    setCandidates((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, stage } : c))
      saveAdminCandidates(next)
      return next
    })
    setSelected((prev) => (prev?.id === id ? { ...prev, stage } : prev))
  }

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const idx = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setTab(next.id)
    e.currentTarget.querySelector<HTMLButtonElement>(`#admin-tab-${next.id}`)?.focus()
  }

  const maxMonthly = Math.max(...MONTHLY_TRENDS.map((m) => m.applications))
  const maxHired = Math.max(1, ...MONTHLY_TRENDS.map((m) => m.hired))
  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className={shell.pageBleed}>
      <div className={shell.page}>
        <div className={shell.shell}>
          <header className={shell.pageHeader}>
            <div>
              <h1 className={shell.pageTitle}>{current.title}</h1>
              <p className={shell.pageSub}>
                Applications, AI match scores, interview scores and pipeline progress in one place.
              </p>
              {/* The admin workspace runs on sample data kept in this browser (lib/adminAts), not the organisation's
                  real applicants: say so instead of presenting fictional people as real ones (vendor QA). */}
              <p className="ds-alert ds-alert--info" role="note" data-testid="admin-sample-data">
                Sample data: this workspace is a preview and is not connected to your organisation’s jobs or applicants.
                Use Jobs and Applicants for real hiring.
              </p>
            </div>
          </header>

          <div className={styles.tabs} role="tablist" aria-label="Admin sections" onKeyDown={onTabKeyDown}>
            {TABS.map((item) => (
              <button
                key={item.id}
                id={`admin-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls="admin-panel"
                tabIndex={tab === item.id ? 0 : -1}
                className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`} className={styles.content}>
            {tab === 'overview' && (
              <>
                <div className={styles.kpiGrid}>
                  {[
                    ['Talent pool', String(kpis.totalTalent), 'Candidates on file'],
                    ['Active job roles', String(kpis.activeJobs), 'Open across departments'],
                    ['Top AI matches (90%+)', String(kpis.topMatches), 'Ready to fast-track'],
                    ['In interview stages', String(kpis.interviewsScheduled), 'Technical, HR or offer'],
                  ].map(([label, value, note]) => (
                    <article key={label} className={styles.kpiCard}>
                      <span className={styles.kpiLabel}>{label}</span>
                      <strong className={styles.kpiValue}>{value}</strong>
                      <small className={styles.kpiNote}>{note}</small>
                    </article>
                  ))}
                </div>

                <section className={shell.panel} aria-labelledby="admin-top-candidates">
                  <div className={shell.panelHeader}>
                    <div>
                      <h2 id="admin-top-candidates" className={shell.panelTitle}>
                        Candidates and AI ranking
                      </h2>
                      <p className={shell.panelSub}>The latest six. Change a stage right in the table.</p>
                    </div>
                    <button
                      type="button"
                      className={`${shell.btnSecondary} ${shell.btnSm}`}
                      onClick={() => setTab('candidates')}
                    >
                      Open full directory
                    </button>
                  </div>
                  <CandidateTable rows={filtered.slice(0, 6)} onSelect={setSelected} onStage={updateStage} />
                </section>

                <section className={styles.twoCol}>
                  <article className={shell.panel}>
                    <div className={shell.panelHeader}>
                      <h2 className={shell.panelTitle}>Application velocity</h2>
                    </div>
                    <div className={shell.panelBody}>
                      <div className={styles.barChart}>
                        {MONTHLY_TRENDS.map((m) => (
                          <div key={m.month} className={styles.barCol}>
                            <div className={styles.barTrack}>
                              <div
                                className={styles.barFill}
                                style={{ height: `${(m.applications / maxMonthly) * 100}%` }}
                              />
                            </div>
                            <span>{m.month}</span>
                            <small>{m.applications}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                  <article className={shell.panel}>
                    <div className={shell.panelHeader}>
                      <h2 className={shell.panelTitle}>Hiring funnel</h2>
                    </div>
                    <div className={`${shell.panelBody} ${styles.meterList}`}>
                      {funnel
                        .filter((f) => f.stage !== 'Rejected')
                        .map((f) => (
                          <div key={f.stage} className={styles.meterRow}>
                            <span>{f.stage}</span>
                            <div className={styles.meterTrack}>
                              <div
                                className={styles.meterFill}
                                style={{
                                  width: `${Math.max(8, (f.count / Math.max(1, candidates.length)) * 100)}%`,
                                }}
                              />
                            </div>
                            <b>{f.count}</b>
                          </div>
                        ))}
                    </div>
                  </article>
                </section>
              </>
            )}

            {tab === 'candidates' && (
              <section className={shell.panel} aria-label="Candidate directory">
                <div className={styles.toolbar}>
                  <input
                    className={styles.search}
                    type="search"
                    aria-label="Search candidates"
                    placeholder="Search name, skill, title…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    className={styles.select}
                    aria-label="Filter by stage"
                    value={stageFilter}
                    onChange={(e) => setStageFilter(e.target.value as PipelineStage | 'All')}
                  >
                    <option value="All">All stages</option>
                    {PIPELINE_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <CandidateTable rows={filtered} onSelect={setSelected} onStage={updateStage} />
              </section>
            )}

            {tab === 'jobs' && (
              <div className={styles.jobGrid}>
                {ADMIN_JOBS.map((job) => (
                  <article key={job.id} className={styles.jobCard}>
                    <div className={styles.jobTop}>
                      <h2>{job.title}</h2>
                      <span className={`${shell.pill} ${job.status === 'Active' ? shell.pillSuccess : ''}`}>
                        {job.status}
                      </span>
                    </div>
                    <p>
                      {job.department} · {job.location} · {job.employmentType}
                    </p>
                    <p className={styles.salary}>{job.salaryRange}</p>
                    <div className={styles.skillWrap}>
                      {job.requiredSkills.map((s) => (
                        <span key={s}>{s}</span>
                      ))}
                    </div>
                    <footer>
                      <b>{job.applicantsCount} applicants</b>
                      <button
                        type="button"
                        className={`${shell.btnSecondary} ${shell.btnSm}`}
                        onClick={() => {
                          setMatchJobId(job.id)
                          setTab('matching')
                        }}
                      >
                        Match candidates
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            )}

            {tab === 'pipeline' && (
              <div className={styles.kanban}>
                {PIPELINE_STAGES.filter((s) => s !== 'Rejected').map((stage) => {
                  const cards = candidates.filter((c) => c.stage === stage)
                  return (
                    <div key={stage} className={styles.kanbanCol}>
                      <header>
                        <h2>{stage}</h2>
                        <span>{cards.length}</span>
                      </header>
                      <div className={styles.kanbanCards}>
                        {cards.map((c) => (
                          <div key={c.id} className={styles.kanbanCard}>
                            <button type="button" className={styles.nameBtn} onClick={() => setSelected(c)}>
                              {c.name}
                            </button>
                            <span>{c.currentTitle}</span>
                            <em>{c.overallMatchScore}% match</em>
                            <select
                              aria-label={`Stage for ${c.name}`}
                              value={c.stage}
                              onChange={(e) => updateStage(c.id, e.target.value as PipelineStage)}
                            >
                              {PIPELINE_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'matching' && (
              <section className={shell.panel} aria-label="AI candidate matcher">
                <div className={styles.toolbar}>
                  <label className={styles.fieldLabel}>
                    Target role
                    <select className={styles.select} value={matchJobId} onChange={(e) => setMatchJobId(e.target.value)}>
                      {ADMIN_JOBS.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className={styles.hint}>Scores combine resume skill match and the AI interview score.</p>
                </div>
                <div className={styles.matchList}>
                  {matchRows.map((c, i) => {
                    const job = ADMIN_JOBS.find((j) => j.id === matchJobId)
                    const missing =
                      job?.requiredSkills.filter(
                        (s) => !c.skills?.some((cs) => cs.toLowerCase() === s.toLowerCase()),
                      ) ?? []
                    return (
                      <article key={c.id} className={styles.matchCard}>
                        <div className={styles.matchRank}>#{i + 1}</div>
                        <div>
                          <h2>{c.name}</h2>
                          <p>
                            {c.currentTitle} · {c.totalExperienceYears} yrs
                          </p>
                          <div className={styles.skillWrap}>
                            {c.skills.slice(0, 5).map((s) => (
                              <span key={s}>{s}</span>
                            ))}
                          </div>
                          {missing.length > 0 && <small className={styles.missing}>Missing: {missing.join(', ')}</small>}
                        </div>
                        <div className={styles.matchScores}>
                          <strong>{c.overallMatchScore}%</strong>
                          <span>Overall match</span>
                          <span>Interview {c.interviewScore ?? '—'}</span>
                          <button
                            type="button"
                            className={`${shell.btnSecondary} ${shell.btnSm}`}
                            onClick={() => setSelected(c)}
                          >
                            View
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            )}

            {tab === 'analytics' && (
              <>
                <div className={styles.kpiGrid}>
                  {[
                    ['Total applications', kpis.totalApplications.toLocaleString(), 'All open roles'],
                    ['Avg time to hire', `${kpis.avgTimeToHireDays} days`, 'Application to offer'],
                    ['AI screening accuracy', `${kpis.aiAccuracy}%`, 'Based on interviews'],
                    ['Avg interview score', String(kpis.avgInterviewScore), 'AI interview, out of 100'],
                  ].map(([label, value, note]) => (
                    <article key={label} className={styles.kpiCard}>
                      <span className={styles.kpiLabel}>{label}</span>
                      <strong className={styles.kpiValue}>{value}</strong>
                      <small className={styles.kpiNote}>{note}</small>
                    </article>
                  ))}
                </div>

                <section className={styles.twoCol}>
                  <article className={shell.panel}>
                    <div className={shell.panelHeader}>
                      <h2 className={shell.panelTitle}>Monthly applications vs hires</h2>
                    </div>
                    <div className={shell.panelBody}>
                      <div className={styles.barChart}>
                        {MONTHLY_TRENDS.map((m) => (
                          <div key={m.month} className={styles.barCol}>
                            <div className={styles.barTrack}>
                              <div
                                className={styles.barFill}
                                style={{ height: `${(m.applications / maxMonthly) * 100}%` }}
                              />
                              <div className={styles.barFillAlt} style={{ height: `${(m.hired / maxHired) * 100}%` }} />
                            </div>
                            <span>{m.month}</span>
                            <small>{m.hired} hired</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                  <article className={shell.panel}>
                    <div className={shell.panelHeader}>
                      <h2 className={shell.panelTitle}>Candidate sources</h2>
                    </div>
                    <div className={`${shell.panelBody} ${styles.meterList}`}>
                      {SOURCE_MIX.map((s) => (
                        <div key={s.name} className={styles.meterRow}>
                          <span>{s.name}</span>
                          <div className={styles.meterTrack}>
                            <div className={styles.meterFill} style={{ width: `${s.value}%` }} />
                          </div>
                          <b>{s.value}%</b>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>

                <section className={shell.panel}>
                  <div className={shell.panelHeader}>
                    <h2 className={shell.panelTitle}>Skills demand vs supply</h2>
                  </div>
                  <div className={`${shell.panelBody} ${styles.skillDemand}`}>
                    {SKILL_DEMAND.map((s) => (
                      <div key={s.skill} className={styles.skillDemandRow}>
                        <span>{s.skill}</span>
                        <div>
                          <small>Candidates {s.candidates}</small>
                          <div className={styles.meterTrack}>
                            <div className={styles.meterFill} style={{ width: `${Math.min(100, s.candidates / 1.6)}%` }} />
                          </div>
                        </div>
                        <div>
                          <small>Demand {s.demand}</small>
                          <div className={styles.meterTrack}>
                            <div className={styles.meterFillAlt} style={{ width: `${s.demand}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <div className={styles.drawerBackdrop} onClick={closeDrawer} onKeyDown={drawer.onKeyDown}>
          <aside
            ref={drawer.ref}
            tabIndex={-1}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="admin-drawer-title">{selected.name}</h2>
                <p>{selected.currentTitle}</p>
              </div>
              <button type="button" className={`${shell.btnSecondary} ${shell.btnSm}`} onClick={closeDrawer} data-autofocus>
                Close
              </button>
            </header>
            <p className={styles.summary}>{selected.aiSummary}</p>
            <div className={styles.drawerStats}>
              <div>
                <strong>{selected.overallMatchScore}%</strong>
                <span>AI match</span>
              </div>
              <div>
                <strong>{selected.interviewScore ?? '—'}</strong>
                <span>Interview</span>
              </div>
              <div>
                <strong>{selected.totalExperienceYears}y</strong>
                <span>Experience</span>
              </div>
            </div>
            <dl className={styles.drawerDetails}>
              <div>
                <dt>Email</dt>
                <dd>{selected.email}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{selected.location}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selected.source}</dd>
              </div>
            </dl>
            <div className={styles.skillWrap}>
              {selected.skills.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
            <label className={`${styles.fieldLabel} ${styles.drawerField}`}>
              Pipeline stage
              <select
                className={styles.select}
                value={selected.stage}
                onChange={(e) => updateStage(selected.id, e.target.value as PipelineStage)}
              >
                {PIPELINE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </aside>
        </div>
      )}
    </div>
  )
}

function CandidateTable({
  rows,
  onSelect,
  onStage,
}: {
  rows: AdminCandidate[]
  onSelect: (c: AdminCandidate) => void
  onStage: (id: string, stage: PipelineStage) => void
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col">Title</th>
            <th scope="col">Match</th>
            <th scope="col">Interview</th>
            <th scope="col">Stage</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <button type="button" className={styles.nameBtn} onClick={() => onSelect(c)}>
                  {c.name}
                </button>
                <small>{c.email}</small>
              </td>
              <td>{c.currentTitle}</td>
              <td>
                <b className={c.overallMatchScore >= 90 ? styles.scoreHot : undefined}>{c.overallMatchScore}%</b>
              </td>
              <td>{c.interviewScore ?? '—'}</td>
              <td>
                <select
                  className={styles.stageSelect}
                  aria-label={`Stage for ${c.name}`}
                  value={c.stage}
                  onChange={(e) => onStage(c.id, e.target.value as PipelineStage)}
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td>{c.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className={styles.empty}>No candidates match this filter.</p>}
    </div>
  )
}
