import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { BrandLogo } from '../components/BrandLogo'
import { VideoProctorTimeline } from '../components/VideoProctorTimeline'
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
import { firstName } from '../lib/store'
import { easeOut } from '../motion/variants'
import styles from './AdminDashboard.module.css'

type Tab =
  | 'overview'
  | 'candidates'
  | 'jobs'
  | 'pipeline'
  | 'matching'
  | 'analytics'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Dashboard' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'matching', label: 'AI Matcher' },
  { id: 'analytics', label: 'Analytics' },
]

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [candidates, setCandidates] = useState<AdminCandidate[]>(() =>
    loadAdminCandidates(),
  )
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<PipelineStage | 'All'>('All')
  const [matchJobId, setMatchJobId] = useState(ADMIN_JOBS[0].id)
  const [selected, setSelected] = useState<AdminCandidate | null>(null)
  const name = firstName()

  const kpis = useMemo(() => adminKpis(candidates, ADMIN_JOBS), [candidates])
  const funnel = useMemo(() => funnelFromCandidates(candidates), [candidates])

  const filtered = useMemo(() => {
    return candidates.filter((c) => {
      const q = query.trim().toLowerCase()
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

  const maxMonthly = Math.max(...MONTHLY_TRENDS.map((m) => m.applications))

  return (
    <>
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand} style={{ padding: '8px 10px 16px' }}>
          <BrandLogo size="md" />
        </div>


        <nav className={styles.nav}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? styles.navActive : styles.navItem}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === 'matching' && <em>AI</em>}
            </button>
          ))}
        </nav>

        <div className={styles.sideFoot}>
          <div className={styles.engineCard}>
            <span className={styles.liveDot} />
            <div>
              <strong>Ava AI Studio v2.4</strong>
              <small>Real-time scoring synced</small>
            </div>
          </div>
          <Link to="/dashboard" className={styles.backLink}>
            ← Candidate app
          </Link>
          <Link to="/" className={styles.backLink}>
            Marketing home
          </Link>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Recruiter operations</p>
            <h1>
              {tab === 'overview' && 'Admin dashboard'}
              {tab === 'candidates' && 'Candidate directory'}
              {tab === 'jobs' && 'Jobs management'}
              {tab === 'pipeline' && 'Kanban pipeline'}
              {tab === 'matching' && 'AI candidate matcher'}
              {tab === 'analytics' && 'Recruiter analytics'}
            </h1>
          </div>
          <div className={styles.topActions}>
            <span className={styles.adminChip}>Hi, {name}</span>
            <Link to="/interview" className={styles.ghostBtn}>
              Interview studio
            </Link>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setTab('candidates')}
            >
              Review talent
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: easeOut }}
            className={styles.content}
          >
            {tab === 'overview' && (
              <>
                <section className={styles.banner}>
                  <div>
                    <span className={styles.bannerPill}>Enterprise AI Matcher Active</span>
                    <h2>Recruiter operations & AI talent pipeline</h2>
                    <p>
                      Monitor applications, AI match scores, HIRERIGHT<sup>TT</sup> interview scores, and
                      pipeline progression — adapted from OpenATS for HIRERIGHT<sup>TT</sup>.
                    </p>
                  </div>
                  <div className={styles.bannerActions}>
                    <button type="button" className={styles.primaryBtn} onClick={() => setTab('matching')}>
                      Run AI matcher
                    </button>
                    <button type="button" className={styles.ghostBtn} onClick={() => setTab('jobs')}>
                      Manage jobs
                    </button>
                  </div>
                </section>

                <div className={styles.kpiGrid}>
                  {[
                    ['Total talent pool', String(kpis.totalTalent), '+12 parsed today'],
                    ['Active job roles', String(kpis.activeJobs), 'Across departments'],
                    ['Top AI matches (90%+)', String(kpis.topMatches), 'Ready to fast-track'],
                    ['In interview stages', String(kpis.interviewsScheduled), 'Technical / HR / Offer'],
                  ].map(([label, value, note]) => (
                    <article key={label} className={styles.kpiCard}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>{note}</small>
                    </article>
                  ))}
                </div>

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h3>Candidate directory & AI ranking</h3>
                      <p>Interactive table with stage filters and match scores</p>
                    </div>
                    <button type="button" className={styles.ghostBtn} onClick={() => setTab('candidates')}>
                      Open full directory
                    </button>
                  </div>
                  <CandidateTable
                    rows={filtered.slice(0, 6)}
                    onSelect={setSelected}
                    onStage={updateStage}
                  />
                </section>

                <section className={styles.twoCol}>
                  <article className={styles.panel}>
                    <h3>Application velocity</h3>
                    <div className={styles.barChart}>
                      {MONTHLY_TRENDS.map((m) => (
                        <div key={m.month} className={styles.barCol}>
                          <div className={styles.barTrack}>
                            <motion.div
                              className={styles.barFill}
                              initial={{ height: 0 }}
                              animate={{
                                height: `${(m.applications / maxMonthly) * 100}%`,
                              }}
                              transition={{ duration: 0.5, ease: easeOut }}
                            />
                          </div>
                          <span>{m.month}</span>
                          <small>{m.applications}</small>
                        </div>
                      ))}
                    </div>
                  </article>
                  <article className={styles.panel}>
                    <h3>Hiring funnel</h3>
                    <div className={styles.funnel}>
                      {funnel
                        .filter((f) => f.stage !== 'Rejected')
                        .map((f) => (
                          <div key={f.stage} className={styles.funnelRow}>
                            <span>{f.stage}</span>
                            <div className={styles.funnelTrack}>
                              <div
                                className={styles.funnelFill}
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
              <section className={styles.panel}>
                <div className={styles.toolbar}>
                  <input
                    className={styles.search}
                    placeholder="Search name, skill, title…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    className={styles.select}
                    value={stageFilter}
                    onChange={(e) =>
                      setStageFilter(e.target.value as PipelineStage | 'All')
                    }
                  >
                    <option value="All">All stages</option>
                    {PIPELINE_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <CandidateTable
                  rows={filtered}
                  onSelect={setSelected}
                  onStage={updateStage}
                />
              </section>
            )}

            {tab === 'jobs' && (
              <div className={styles.jobGrid}>
                {ADMIN_JOBS.map((job) => (
                  <article key={job.id} className={styles.jobCard}>
                    <div className={styles.jobTop}>
                      <h3>{job.title}</h3>
                      <span
                        className={
                          job.status === 'Active' ? styles.statusOn : styles.statusOff
                        }
                      >
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
                        className={styles.ghostBtn}
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
                        <h4>{stage}</h4>
                        <span>{cards.length}</span>
                      </header>
                      <div className={styles.kanbanCards}>
                        {cards.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={styles.kanbanCard}
                            onClick={() => setSelected(c)}
                          >
                            <strong>{c.name}</strong>
                            <span>{c.currentTitle}</span>
                            <em>{c.overallMatchScore}% match</em>
                            <select
                              value={c.stage}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updateStage(c.id, e.target.value as PipelineStage)
                              }
                            >
                              {PIPELINE_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'matching' && (
              <section className={styles.panel}>
                <div className={styles.toolbar}>
                  <label className={styles.matchLabel}>
                    Target role
                    <select
                      className={styles.select}
                      value={matchJobId}
                      onChange={(e) => setMatchJobId(e.target.value)}
                    >
                      {ADMIN_JOBS.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className={styles.hint}>
                    Scores combine resume skill match + HireRight AI interview score.
                  </p>
                </div>
                <div className={styles.matchList}>
                  {matchRows.map((c, i) => {
                    const job = ADMIN_JOBS.find((j) => j.id === matchJobId)
                    const missing =
                      job?.requiredSkills.filter(
                        (s) =>
                          !c.skills?.some(
                            (cs) => cs.toLowerCase() === s.toLowerCase(),
                          ),
                      ) ?? []
                    return (
                      <article key={c.id} className={styles.matchCard}>
                        <div className={styles.matchRank}>#{i + 1}</div>
                        <div>
                          <h4>{c.name}</h4>
                          <p>
                            {c.currentTitle} · {c.totalExperienceYears} yrs
                          </p>
                          <div className={styles.skillWrap}>
                            {c.skills.slice(0, 5).map((s) => (
                              <span key={s}>{s}</span>
                            ))}
                          </div>
                          {missing.length > 0 && (
                            <small className={styles.missing}>
                              Missing: {missing.join(', ')}
                            </small>
                          )}
                        </div>
                        <div className={styles.matchScores}>
                          <strong>{c.overallMatchScore}%</strong>
                          <span>Overall match</span>
                          <b>Interview {c.interviewScore ?? '—'}</b>
                          <button
                            type="button"
                            className={styles.ghostBtn}
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
                    ['Total applications', kpis.totalApplications.toLocaleString(), '+18.4% this month'],
                    ['Avg time to hire', `${kpis.avgTimeToHireDays} days`, '4 days faster vs avg'],
                    ['AI screening accuracy', `${kpis.aiAccuracy}%`, 'Based on interviews'],
                    ['Avg interview score', String(kpis.avgInterviewScore), 'HireRight AI studio'],
                  ].map(([label, value, note]) => (
                    <article key={label} className={styles.kpiCard}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>{note}</small>
                    </article>
                  ))}
                </div>

                <section className={styles.twoCol}>
                  <article className={styles.panel}>
                    <h3>Monthly applications vs hires</h3>
                    <div className={styles.barChart}>
                      {MONTHLY_TRENDS.map((m) => (
                        <div key={m.month} className={styles.barCol}>
                          <div className={styles.barTrack}>
                            <div
                              className={styles.barFill}
                              style={{
                                height: `${(m.applications / maxMonthly) * 100}%`,
                              }}
                            />
                            <div
                              className={styles.barFillAlt}
                              style={{
                                height: `${(m.hired / 60) * 100}%`,
                              }}
                            />
                          </div>
                          <span>{m.month}</span>
                          <small>{m.hired} hired</small>
                        </div>
                      ))}
                    </div>
                  </article>
                  <article className={styles.panel}>
                    <h3>Candidate sources</h3>
                    <div className={styles.sourceList}>
                      {SOURCE_MIX.map((s) => (
                        <div key={s.name} className={styles.sourceRow}>
                          <span
                            className={styles.sourceDot}
                            style={{ background: s.color }}
                          />
                          <span>{s.name}</span>
                          <div className={styles.funnelTrack}>
                            <div
                              className={styles.funnelFill}
                              style={{ width: `${s.value}%`, background: s.color }}
                            />
                          </div>
                          <b>{s.value}%</b>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>

                <section className={styles.panel}>
                  <h3>Skills demand vs supply</h3>
                  <div className={styles.skillDemand}>
                    {SKILL_DEMAND.map((s) => (
                      <div key={s.skill} className={styles.skillDemandRow}>
                        <span>{s.skill}</span>
                        <div>
                          <small>Candidates {s.candidates}</small>
                          <div className={styles.funnelTrack}>
                            <div
                              className={styles.funnelFill}
                              style={{ width: `${Math.min(100, s.candidates / 1.6)}%` }}
                            />
                          </div>
                        </div>
                        <div>
                          <small>Demand {s.demand}</small>
                          <div className={styles.funnelTrack}>
                            <div
                              className={styles.barFillAlt}
                              style={{
                                width: `${s.demand}%`,
                                height: 8,
                                borderRadius: 999,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            className={styles.drawerBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelected(null)}
          >
            <motion.aside
              className={styles.drawer}
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <header>
                <div>
                  <h3>{selected.name}</h3>
                  <p>{selected.currentTitle}</p>
                </div>
                <button type="button" className={styles.ghostBtn} onClick={() => setSelected(null)}>
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
              <p>
                <b>Email</b> {selected.email}
              </p>
              <p>
                <b>Location</b> {selected.location}
              </p>
              <p>
                <b>Source</b> {selected.source}
              </p>
              <div className={styles.skillWrap}>
                {selected.skills.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              <label className={styles.matchLabel}>
                Pipeline stage
                <select
                  className={styles.select}
                  value={selected.stage}
                  onChange={(e) =>
                    updateStage(selected.id, e.target.value as PipelineStage)
                  }
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              {/* Real-time Video Timeline & Misbehavior Red Markers */}
              <div style={{ marginTop: '20px' }}>
                <VideoProctorTimeline
                  logs={[
                    {
                      id: 'admin-log-1',
                      timestamp: new Date().toISOString(),
                      formattedTime: '02:14 PM',
                      eventType: 'SIDE_GAZE_LOOKING_AWAY',
                      severity: 'warn',
                      message: 'Candidate looking away off-screen (Side Gaze: 34°)',
                      questionIndex: 1,
                    },
                    {
                      id: 'admin-log-2',
                      timestamp: new Date().toISOString(),
                      formattedTime: '02:16 PM',
                      eventType: 'MULTIPLE_FACES_DETECTED',
                      severity: 'ban',
                      message: 'MULTIPLE FACES DETECTED: 2 people seen in camera frame',
                      questionIndex: 3,
                    },
                  ]}
                />
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
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
            <th>Candidate</th>
            <th>Title</th>
            <th>Match</th>
            <th>Interview</th>
            <th>Stage</th>
            <th>Source</th>
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
                <b className={c.overallMatchScore >= 90 ? styles.scoreHot : undefined}>
                  {c.overallMatchScore}%
                </b>
              </td>
              <td>{c.interviewScore ?? '—'}</td>
              <td>
                <select
                  className={styles.stageSelect}
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
