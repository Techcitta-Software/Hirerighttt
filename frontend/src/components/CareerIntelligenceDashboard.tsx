import { useMemo, useState } from 'react'
import type { InterviewResult } from '../lib/store'
import { CandidateInterviewRecordingSection } from './CandidateInterviewRecordingSection'
import { downloadScorecardPdf } from '../lib/printScorecard'
import { openStoredScorecardPdf } from '../lib/interviewReportUpload'
import { buildQaRowsFromInterview } from '../lib/scorecardQaRows'
import { HrIcon, type HrIconName } from './HrIcon'
import { BrandLogo } from './BrandLogo'
import styles from './CareerIntelligenceDashboard.module.css'


const HEALTH_METRIC_ICONS: HrIconName[] = ['cpu', 'wrench', 'cloud', 'settings', 'message']

const POSITIONING_ICON_CYCLE: HrIconName[] = ['book', 'building', 'trending', 'rocket', 'users', 'target']

interface Props {
  result: InterviewResult
  candidateName: string
  candidateRole?: string
  candidateExperience?: string
  skills?: string[]
  onRetake?: () => void
  onContinue?: () => void
  /** When set, loads full interview video from S3 for candidate review. */
  interviewSessionId?: string | null
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return hash
}

export function CareerIntelligenceDashboard({
  result,
  candidateName,
  candidateRole,
  candidateExperience,
  skills = [],
  onRetake,
  onContinue,
  interviewSessionId,
}: Props) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const sc = result.scorecard
  const overall = result.overall
  const careerScore =
    sc?.careerScore ?? Math.min(980, Math.max(50, Math.round(overall * 10)))

  const tagFor = (score: number) =>
    score >= 75 ? 'Strong' : score >= 50 ? 'Moderate' : score >= 25 ? 'Developing' : 'Needs work'
  const colorFor = (score: number) =>
    score >= 75 ? '#16a34a' : score >= 50 ? '#ea580c' : '#dc2626'

  const roleKey = candidateRole || result.role || 'Candidate'
  const candidateId = useMemo(() => {
    const num = Math.abs(hashString(candidateName + roleKey) % 90000) + 10000
    return `HRT-AI-IND-${num}`
  }, [candidateName, roleKey])

  const interviewDate = useMemo(() => {
    const d = result.date ? new Date(result.date) : new Date()
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }, [result.date])

  const displayRole = candidateRole || result.role || 'Candidate'
  const displayExperience = candidateExperience?.trim() || 'Experience on profile'

  const statusLabel =
    sc?.finalCareerStatus ??
    (careerScore >= 850
      ? 'Premium Market-Ready'
      : careerScore >= 700
        ? 'Industry Ready'
        : careerScore >= 550
          ? 'Growth Potential'
          : 'Skill Enhancement Recommended')

  const bandInterpretation =
    sc?.bandInterpretation ??
    `${candidateName} scored ${overall}/100 for ${result.role || displayRole}. ${result.strengths[0] || ''} ${result.improvements[0] ? `Focus: ${result.improvements[0]}` : ''}`.trim()

  const scoreSubHint =
    sc?.scoreSubHint ??
    (result.improvements[0] ? 'AI-identified priorities below' : result.strengths[0] || statusLabel)

  const industryAlignment =
    sc?.industryAlignment ?? Math.max(1, Math.min(99, result.resumeFitScore ?? overall))

  const industryAlignmentCaption =
    sc?.industryAlignmentCaption ??
    (result.resumeFitScore != null
      ? `Resume fit score ${result.resumeFitScore}% from this interview`
      : `Overall alignment ${industryAlignment}%`)

  const positioningItems =
    sc?.positioningRecommendations?.length
      ? sc.positioningRecommendations
      : result.improvements.slice(0, 5)

  const recommendedRoles =
    sc?.recommendedRoles?.length
      ? sc.recommendedRoles
      : [
          result.role || displayRole,
          ...result.categories.slice(0, 2).map((c) => `${c.label} strength`),
        ].filter(Boolean)

  const nextRecommendedStep =
    sc?.nextRecommendedStep ??
    result.improvements[0] ??
    'Retake the interview after practicing structured STAR answers tied to your resume.'

  const positioningFooter =
    sc?.positioningFooter ??
    (result.improvements[0]
      ? `Prioritize: ${result.improvements[0]}`
      : 'Keep anchoring answers in measurable outcomes from your experience.')

  const skillPills = skills.length > 0 ? skills.slice(0, 10) : []

  const donuts = useMemo(
    () =>
      result.categories?.length
        ? result.categories.map((c) => ({
            label: c.label,
            score: c.score,
            tag: tagFor(c.score),
            color: colorFor(c.score),
          }))
        : sc?.donuts ?? [
            { label: 'Overall', score: overall, tag: tagFor(overall), color: colorFor(overall) },
          ],
    [result.categories, sc?.donuts, overall],
  )

  const healthMetrics = useMemo(() => {
    if (sc?.healthMetrics) {
      return sc.healthMetrics.map((hm, i) => ({
        label: hm.label,
        score: hm.score,
        tag: hm.tag,
        color: hm.color,
        iconName: HEALTH_METRIC_ICONS[i] ?? 'target',
      }))
    }
    return donuts.map((d, i) => ({
      label: d.label,
      score: d.score,
      tag: d.tag,
      color: d.color,
      iconName: HEALTH_METRIC_ICONS[i] ?? 'target',
    }))
  }, [sc?.healthMetrics, donuts])

  const starPatterns =
    sc?.starPatterns ??
    result.answers.slice(0, 7).map((a, i) => ({
      name: `Topic ${i + 1}`,
      stars: '★★★☆☆',
      level: a.score >= 75 ? 'Strong' : 'Moderate',
    }))

  const qaRows = sc?.qaRows?.length ? sc.qaRows : buildQaRowsFromInterview(result)

  const radarAxes = useMemo(
    () =>
      result.categories?.length
        ? result.categories.map((c) => ({ label: c.label, val: c.score }))
        : sc?.radarAxes ?? [{ label: 'Overall', val: overall }],
    [result.categories, sc?.radarAxes, overall],
  )

  const coachNotes =
    sc?.coachNotes ??
    `${candidateName}, your overall interview score is ${overall}/100. Review strengths and growth areas below to improve your market readiness.`
  const sessionStats = sc?.sessionStats
  const careerPaths =
    sc?.careerPaths ?? [
      { role: displayRole, match: Math.max(1, Math.min(99, overall)) },
      { role: `${displayRole} (Senior)`, match: Math.max(1, Math.min(99, overall - 3)) },
      { role: result.role || displayRole, match: Math.max(1, Math.min(99, Math.round(overall * 0.92))) },
    ]
  const priorities =
    sc?.priorities ??
    result.improvements.slice(0, 4).map((text, i) => ({
      num: i + 1,
      title: text.slice(0, 50),
      text,
    }))

  const radarPoints = useMemo(() => {
    const center = 110
    const maxR = 75
    return radarAxes
      .map((axis, i) => {
        const angle = (Math.PI * 2 * i) / radarAxes.length - Math.PI / 2
        const r = (axis.val / 100) * maxR
        const x = center + r * Math.cos(angle)
        const y = center + r * Math.sin(angle)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [radarAxes])

  return (
    <div className={styles.dashboardContainer} id="career-intelligence-dashboard">
      {/* Header Profile Section */}
      <header className={styles.headerCard}>
        <div className={styles.brandRow}>
          <div className={styles.logoTitle}>
            <BrandLogo size="md" />
            <div className={styles.brandText}>
              <span>AI-Powered Career Intelligence Dashboard</span>
            </div>
          </div>

          <div className={styles.headerActions} data-download-exclude>
            <button
              type="button"
              className={styles.printBtn}
              disabled={downloading}
              onClick={() => {
                setDownloadError('')
                setDownloading(true)
                void (async () => {
                  const sid = result.sessionId
                  if (sid && (await openStoredScorecardPdf(sid))) return
                  await downloadScorecardPdf(candidateName)
                })()
                  .catch(() => {
                    setDownloadError('Could not download the report. Try again.')
                  })
                  .finally(() => setDownloading(false))
              }}
            >
              <HrIcon name="download" size={16} />
              {downloading ? 'Preparing download…' : 'Download Report'}
            </button>
            {downloadError ? <p className={styles.downloadError}>{downloadError}</p> : null}
          </div>
        </div>

        <div className={styles.candidateProfileRow}>
          <div className={styles.candidateLeftBlock}>
            <div className={styles.avatarBox}>
              {candidateName.charAt(0).toUpperCase()}
            </div>
            <div className={styles.candidateInfo}>
              <h1>{candidateName}</h1>
              <p className={styles.candidateSubtitle}>
                {displayRole} | {displayExperience}
              </p>
              <p className={styles.candidateTrack}>{result.role || displayRole}</p>
            </div>
          </div>

          <div className={styles.metaGridRight}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>
                <HrIcon name="user" size={14} /> Candidate ID:
              </span>
              <span className={styles.metaValue}>{candidateId}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>
                <HrIcon name="lock" size={14} /> Resume Visibility:
              </span>
              <span className={styles.metaPrivate}>PRIVATE — Not Shared</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>
                <HrIcon name="check" size={14} /> Interview Status:
              </span>
              <span className={styles.metaValue} style={{ color: '#16a34a' }}>Completed</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>
                <HrIcon name="briefcase" size={14} /> Career Track:
              </span>
              <span className={styles.metaValue}>{result.role || displayRole}</span>
            </div>
            <div className={styles.metaItem} style={{ gridColumn: 'span 2' }}>
              <span className={styles.metaLabel}>
                <HrIcon name="calendar" size={14} /> Interview Date:
              </span>
              <span className={styles.metaValue}>{interviewDate}</span>
            </div>
          </div>
        </div>

        {/* Primary Skills Ribbon with Blue Industry Status Badge */}
        <div className={styles.skillsRibbon}>
          <div className={styles.skillsLeftGroup}>
            <span className={styles.skillsRibbonLabel}>Primary Skills:</span>
            {skillPills.length > 0 ? (
              skillPills.map((sk) => (
                <span key={sk} className={styles.skillPill}>
                  {sk}
                </span>
              ))
            ) : (
              <span className={styles.skillPill} style={{ opacity: 0.7 }}>
                Skills from your profile appear here after onboarding
              </span>
            )}
          </div>
          <div className={styles.industryStatusBadge}>
            Industry Status: {statusLabel}
          </div>
        </div>
      </header>

      {interviewSessionId || result.sessionId ? (
        <CandidateInterviewRecordingSection
          sessionId={interviewSessionId || result.sessionId}
          title="Your interview video"
        />
      ) : null}

      {/* Row 1: Career Score Gauge, Score Band Explanation, Donut Distribution */}
      <section className={styles.rowGridThree}>
        {/* Speedometer Card */}
        <div className={`${styles.card} ${styles.speedometerCard}`}>
          <div className={styles.cardTitle}>HIRERIGHT CAREER SCORE™</div>

          <svg className={styles.speedometerSvg} viewBox="0 0 200 110">
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="16"
              strokeLinecap="round"
            />
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="url(#speedoGradient)"
              strokeWidth="16"
              strokeDasharray="251.2"
              strokeDashoffset={251.2 - (251.2 * (careerScore / 1000))}
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="speedoGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="40%" stopColor="#f59e0b" />
                <stop offset="70%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
            </defs>
            {/* Needle */}
            {(() => {
              const angleDeg = -180 + (careerScore / 1000) * 180
              const rad = (angleDeg * Math.PI) / 180
              const nx = 100 + 64 * Math.cos(rad)
              const ny = 100 + 64 * Math.sin(rad)
              return (
                <g>
                  <line x1="100" y1="100" x2={nx} y2={ny} stroke="#1e3a8a" strokeWidth="3" strokeLinecap="round" />
                  <circle cx="100" cy="100" r="5" fill="#1e3a8a" />
                </g>
              )
            })()}
            <text x="22" y="108" fill="#94a3b8" fontSize="10" fontWeight="bold">0</text>
            <text x="175" y="108" fill="#94a3b8" fontSize="10" fontWeight="bold">1000</text>
          </svg>

          <div className={styles.scoreValue}>{careerScore}</div>
          <div className={styles.scoreOutOf}>/ 1000</div>
          <div className={styles.scoreBadgeText}>{statusLabel}</div>
          <div className={styles.scoreSubHint}>{scoreSubHint}</div>
        </div>

        {/* Score Band Explanation Card */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>SCORE BAND EXPLANATION</div>
          <div className={styles.scoreBandList}>
            <div className={styles.bandItem}>
              <span className={styles.bandBadge} style={{ background: '#166534' }}>850 – 1000</span>
              <span className={styles.bandLabel}>Premium Market-Ready Talent</span>
            </div>
            <div className={styles.bandItem}>
              <span className={styles.bandBadge} style={{ background: '#15803d' }}>700 – 849</span>
              <span className={styles.bandLabel}>Industry Ready</span>
            </div>
            <div className={styles.bandItem}>
              <span className={styles.bandBadge} style={{ background: '#d97706' }}>550 – 699</span>
              <span className={styles.bandLabel}>Growth Potential</span>
            </div>
            <div className={styles.bandItem}>
              <span className={styles.bandBadge} style={{ background: '#dc2626' }}>Below 550</span>
              <span className={styles.bandLabel}>Skill Enhancement Recommended</span>
            </div>
          </div>

          <div className={styles.bandInterpretation}>
            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <HrIcon name="alert" size={14} /> INTERPRETATION:
            </strong>{' '}
            {bandInterpretation}
          </div>
        </div>

        {/* Career Health Distribution (5 Donut Meters) */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>CAREER HEALTH DISTRIBUTION</div>
          <div className={styles.donutRow}>
            {donuts.map((d) => (
              <div key={d.label} className={styles.donutCol}>
                <svg className={styles.donutSvg} viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#f1f5f9"
                    strokeWidth="3.5"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke={d.color}
                    strokeWidth="3.5"
                    strokeDasharray={`${d.score}, 100`}
                    strokeLinecap="round"
                  />
                  <text x="18" y="19" className={styles.donutValueText}>
                    {d.score}%
                  </text>
                </svg>
                <div className={styles.donutLabel}>{d.label}</div>
                <div className={styles.donutTag} style={{ color: d.color }}>
                  {d.tag}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.donutLegend}>
            <span><span className={styles.legendDot} style={{ background: '#16a34a' }}></span> Strong (70%+)</span>
            <span><span className={styles.legendDot} style={{ background: '#ea580c' }}></span> Moderate (50% - 69%)</span>
            <span><span className={styles.legendDot} style={{ background: '#dc2626' }}></span> Needs Improvement (&lt;50%)</span>
          </div>
        </div>
      </section>

      {/* Row 2: Detailed Career Health Metrics + Specialized Interview Pattern Assessment */}
      <section className={styles.rowGridTwo}>
        {/* Left: Detailed Career Health Metrics */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>DETAILED CAREER HEALTH METRICS</div>
          <div className={styles.healthList}>
            {healthMetrics.map((hm) => (
              <div key={hm.label} className={styles.healthRow}>
                <div className={styles.healthCategory}>
                  <span className={styles.healthIconRose}>
                    <HrIcon name={hm.iconName} size={16} />
                  </span>
                  <span>{hm.label}</span>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${hm.score}%`, background: hm.color }}
                  />
                </div>
                <div className={styles.healthScoreNum}>{hm.score}%</div>
                <div
                  className={styles.healthPerformanceTag}
                  style={{
                    color: hm.color,
                    background: `${hm.color}18`,
                    border: `1px solid ${hm.color}35`,
                  }}
                >
                  {hm.tag}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Specialized Interview Pattern Assessment */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>SPECIALIZED INTERVIEW PATTERN ASSESSMENT™</div>
          <div className={styles.patternStatRow}>
            <div className={styles.patternStatBox}>
              <div className={styles.patternStatIcon}>
                <HrIcon name="calendar" size={18} />
              </div>
              <div className={styles.patternStatNumber}>{sessionStats?.durationMinutes ?? Math.max(8, qaRows.length * 4)}</div>
              <div className={styles.patternStatLabel}>Minutes Duration</div>
            </div>
            <div className={styles.patternStatBox}>
              <div className={styles.patternStatIcon}>
                <HrIcon name="message" size={18} />
              </div>
              <div className={styles.patternStatNumber}>{sessionStats?.questionCount ?? qaRows.length}</div>
              <div className={styles.patternStatLabel}>Questions Asked</div>
            </div>
            <div className={styles.patternStatBox}>
              <div className={styles.patternStatIcon}>
                <HrIcon name="target" size={18} />
              </div>
              <div className={styles.patternStatNumber}>{sessionStats?.overallInterviewScore ?? overall} / 100</div>
              <div className={styles.patternStatLabel}>Overall Interview Score</div>
            </div>
          </div>

          <div className={styles.interviewTypePill}>
            Interview Type: {sessionStats?.interviewType ?? `${displayRole} · Adaptive AI Interview`}
          </div>

          <div style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#475569', marginBottom: '8px' }}>
            INTERVIEW PERFORMANCE SUMMARY
          </div>
          <div className={styles.starSummaryGrid}>
            {starPatterns.map((p) => (
              <div key={p.name} className={styles.starSummaryItem}>
                <span className={styles.starCategoryName}>{p.name}</span>
                <span className={styles.starString}>{p.stars}</span>
                <span className={styles.starLevelTag}>{p.level}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Row 3: Actual Interview Questions & Scoring Matrix Table with Grouped Thead */}
      <section className={`${styles.card} ${styles.tableCard}`}>
        <div className={styles.cardTitle}>ACTUAL INTERVIEW QUESTIONS &amp; SCORING</div>
        <table className={styles.qaTable}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: '36px', textAlign: 'center' }}>#</th>
              <th rowSpan={2}>TOPIC</th>
              <th rowSpan={2} style={{ width: '28%' }}>QUESTION ASKED</th>
              <th colSpan={3} className={styles.scoreBreakdownHeader}>
                RUBRIC BREAKDOWN (OUT OF 10)
              </th>
              <th rowSpan={2} style={{ textAlign: 'center' }}>TOTAL (OUT OF 30)</th>
              <th rowSpan={2}>PERFORMANCE</th>
              <th rowSpan={2}>AI FEEDBACK SUMMARY</th>
            </tr>
            <tr>
              <th style={{ textAlign: 'center' }}>CORRECTNESS</th>
              <th style={{ textAlign: 'center' }}>COMMUNICATION</th>
              <th style={{ textAlign: 'center' }}>DEPTH</th>
            </tr>
          </thead>
          <tbody>
            {qaRows.map((q) => (
              <tr key={q.index}>
                <td style={{ textAlign: 'center' }}>
                  <span className={styles.rowCircle}>{q.index}</span>
                </td>
                <td><span className={styles.topicTag}>{q.topic}</span></td>
                <td className={styles.questionCell}>{q.question}</td>
                <td className={styles.scoreNumCell}>{q.accuracy}</td>
                <td className={styles.scoreNumCell}>{q.clarity}</td>
                <td className={styles.scoreNumCell}>{q.depth}</td>
                <td className={styles.totalScoreCell}>
                  <strong>{q.total30 ?? q.total40}/30</strong>
                </td>
                <td style={{ color: '#f59e0b', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{q.stars}</td>
                <td className={styles.feedbackCell}>{q.feedback}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Row 4: Spider Radar + Growth Potential + Priorities */}
      <section className={styles.rowGridFour}>
        {/* Skill Strength Radar */}
        <div className={`${styles.card} ${styles.radarCard}`}>
          <div className={styles.cardTitle}>SKILL STRENGTH RADAR</div>
          <svg className={styles.radarSvg} viewBox="0 0 220 220">
            {[0.25, 0.5, 0.75, 1].map((lvl) => {
              const r = 75 * lvl
              const pts = radarAxes
                .map((_, i) => {
                  const angle = (Math.PI * 2 * i) / radarAxes.length - Math.PI / 2
                  return `${(110 + r * Math.cos(angle)).toFixed(1)},${(110 + r * Math.sin(angle)).toFixed(1)}`
                })
                .join(' ')
              return <polygon key={lvl} points={pts} fill="none" stroke="#e2e8f0" strokeWidth="1" />
            })}

            {radarAxes.map((axis, i) => {
              const angle = (Math.PI * 2 * i) / radarAxes.length - Math.PI / 2
              const x2 = 110 + 75 * Math.cos(angle)
              const y2 = 110 + 75 * Math.sin(angle)
              const lx = 110 + 94 * Math.cos(angle)
              const ly = 110 + 94 * Math.sin(angle)
              return (
                <g key={axis.label}>
                  <line x1="110" y1="110" x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth="1" />
                  <text
                    x={lx}
                    y={ly + 3}
                    textAnchor="middle"
                    fontSize="7"
                    fontWeight="700"
                    fill="#475569"
                  >
                    {axis.label}
                  </text>
                  <text
                    x={lx}
                    y={ly + 10}
                    textAnchor="middle"
                    fontSize="6.5"
                    fontWeight="800"
                    fill="#1e40af"
                  >
                    ({axis.val}%)
                  </text>
                </g>
              )
            })}

            <polygon
              points={radarPoints}
              fill="rgba(37, 99, 235, 0.18)"
              stroke="#2563eb"
              strokeWidth="2"
            />
          </svg>
        </div>

        {/* Career Growth Potential */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>CAREER GROWTH POTENTIAL</div>
          <div className={styles.growthList}>
            {careerPaths.map((g) => (
              <div key={g.role} className={styles.growthItem}>
                <div className={styles.growthItemHeader}>
                  <span>{g.role}</span>
                  <span>{g.match}%</span>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{
                      width: `${g.match}%`,
                      background: g.match >= 80 ? '#16a34a' : g.match >= 65 ? '#ea580c' : '#c2410c',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Market Priorities */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>MARKET-BASED IMPROVEMENT PRIORITIES</div>
          <div className={styles.priorityList}>
            {priorities.map((p) => (
              <div key={p.num} className={styles.priorityItem}>
                <span className={styles.priorityNum}>{p.num}</span>
                <div>
                  <div className={styles.priorityTitle}>{p.title}</div>
                  <div className={styles.priorityText}>{p.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Row 5: Positioning + Industry Alignment (74%) + AI Coach Notes */}
      <section className={styles.positioningGrid}>
        {/* Positioning */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>RESUME POSITIONING INTELLIGENCE™</div>
          <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 10px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <HrIcon name="lock" size={14} /> Your resume is currently kept private and not shared with
              recruiters.
            </span>
          </p>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b' }}>
            HireRight recommends improving:

          </div>
          <div className={styles.positioningIcons}>
            {positioningItems.length > 0 ? (
              positioningItems.map((text, i) => (
                <div key={`${i}-${text.slice(0, 24)}`} className={styles.posIconBox}>
                  <div className={styles.posIconSymbol}>
                    <HrIcon name={POSITIONING_ICON_CYCLE[i % POSITIONING_ICON_CYCLE.length]} size={20} />
                  </div>
                  <div className={styles.posIconText}>{text}</div>
                </div>
              ))
            ) : (
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>
                No positioning gaps flagged — your interview feedback is in the strengths list.
              </p>
            )}
          </div>
          <div style={{ background: '#f1f5f9', borderRadius: '6px', padding: '6px 10px', fontSize: '0.72rem', color: '#334155', fontWeight: 600 }}>
            {positioningFooter}
          </div>
        </div>

        {/* Industry Alignment (74%) + Strengths & Growth Areas */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>INDUSTRY ALIGNMENT</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' }}>
            <svg style={{ width: '64px', height: '64px', flexShrink: 0 }} viewBox="0 0 36 36">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="4"
              />
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#059669"
                strokeWidth="4"
                strokeDasharray={`${industryAlignment}, 100`}
                strokeLinecap="round"
              />
              <text x="18" y="20" style={{ fontSize: '0.85rem', fontWeight: 900, fill: '#0f172a', textAnchor: 'middle' }}>
                {industryAlignment}%
              </text>
            </svg>
            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#166534', lineHeight: 1.3 }}>
              {industryAlignmentCaption}
            </div>
          </div>

          <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#15803d', marginBottom: '3px' }}>
            Top Strengths
          </div>
          <ul className={styles.strengthsList}>
            {(result.strengths.length > 0 ? result.strengths : ['Complete an interview to generate AI strengths.']).map(
              (text) => (
                <li key={text}>
                  <HrIcon name="check" size={12} /> {text}
                </li>
              ),
            )}
          </ul>

          <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#dc2626', marginTop: '8px', marginBottom: '3px' }}>
            Top Growth Areas
          </div>
          <ul className={styles.growthAreasList}>
            {(result.improvements.length > 0
              ? result.improvements
              : ['AI growth areas appear after your first scored interview.']
            ).map((text) => (
              <li key={text}>⨁ {text}</li>
            ))}
          </ul>
        </div>

        {/* AI Career Coach Notes */}
        <div className={styles.coachNoteCard}>
          <div className={styles.cardTitle} style={{ color: '#1e3a8a' }}>
            AI CAREER COACH NOTES™
          </div>
          <div className={styles.coachBubble}>
            <div className={styles.coachAvatar}>
              <HrIcon name="bot" size={28} />
            </div>
            <div>
              <p className={styles.coachQuote}>“{coachNotes}”</p>
              <div className={styles.coachSignature}>
                — HireRight AI Career Coach

              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer Ribbon */}
      <footer className={styles.footerRibbon}>
        <div className={styles.footerTopRow}>
          <div className={styles.finalStatusGroup}>
            <span>FINAL CAREER STATUS:</span>
            <div className={styles.finalStatusPill}>
              <HrIcon name="check" size={14} /> {statusLabel}
            </div>
          </div>

          <div className={styles.recommendedRoles}>
            <span>RECOMMENDED FOR:</span>
            {recommendedRoles.map((role) => (
              <span key={role} className={styles.rolePill}>
                {role}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.nextStepBox}>
          <strong>NEXT RECOMMENDED STEP:</strong>
          <span>{nextRecommendedStep}</span>
        </div>

        <div className={styles.actionButtonRow} data-download-exclude>
          {onRetake && (
            <button type="button" className={styles.secondaryBtn} onClick={onRetake}>
              Retake Interview with Ava
            </button>
          )}
          {onContinue && (
            <button type="button" className={styles.primaryBtn} onClick={onContinue}>
              Go to dashboard →
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
