import { useMemo, useState } from 'react'
import type { InterviewResult } from '../lib/store'
import { downloadScorecardPdf } from '../lib/printScorecard'
import { openStoredScorecardPdf } from '../lib/interviewReportUpload'
import { buildQaRowsFromInterview } from '../lib/scorecardQaRows'
import { HrIcon, type HrIconName } from './HrIcon'
import { BrandLogo } from './BrandLogo'
import styles from './CareerIntelligenceDashboard.module.css'


const HEALTH_METRIC_ICONS: HrIconName[] = ['cpu', 'wrench', 'cloud', 'settings', 'message']


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
  /** Blob URL right after interview while cloud playback is prepared. */
  localPreviewUrl?: string | null
  /** Embedded under another page's h1 (profile, vendor viewer): render the candidate name as an h2. */
  embedded?: boolean
  /**
   * 'summary' (default): the one-page report shown when the interview ends and saved as the PDF. It does not list
   * the questions asked. 'detailed': adds the per-question breakdown (candidate profile, recruiter review).
   */
  variant?: 'summary' | 'detailed'
  /**
   * 'recruiter': the employer's view (applicant drawer, recruiter report modal). No level words or band legend
   * (product decision: the number carries the meaning), and none of the candidate-only copy ("Your career score...",
   * resume visibility, career track, recommended roles, coaching, the inner logo and second Download button).
   */
  audience?: 'candidate' | 'recruiter'
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
  embedded = false,
  variant = 'summary',
  audience = 'candidate',
}: Props) {
  const recruiter = audience === 'recruiter'
  const NameHeading = embedded ? 'h2' : 'h1'
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const sc = result.scorecard
  const overall = result.overall
  /* The career score IS the interview score: one 0–100 number, no x10 scale and no bands. */
  const careerScore = Math.max(0, Math.min(100, Math.round(overall)))

  const tagFor = (score: number) =>
    score >= 75 ? 'Strong' : score >= 50 ? 'Moderate' : score >= 25 ? 'Developing' : 'Needs work'
  /* Neutral bands: green for strong, amber for moderate, muted below. No red on candidate reports. */
  const colorFor = (score: number) =>
    score >= 75 ? '#047857' : score >= 50 ? '#b45309' : '#5f6686'
  const toneFor = (score: number) =>
    score >= 75 ? styles.toneSuccess : score >= 50 ? styles.toneWarning : styles.toneNeutral
  const fillFor = (score: number) =>
    recruiter ? '' : score >= 75 ? styles.dotSuccess : score >= 50 ? styles.dotWarning : styles.dotNeutral

  const roleKey = candidateRole || result.role || 'Candidate'
  const candidateId = useMemo(() => {
    const num = Math.abs(hashString(candidateName + roleKey) % 90000) + 10000
    return `HRT-AI-IND-${num}`
  }, [candidateName, roleKey])

  const interviewDate = useMemo(() => {
    const d = result.date ? new Date(result.date) : new Date()
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }, [result.date])

  const displayRole = candidateRole || result.role || 'Candidate'
  const displayExperience = candidateExperience?.trim() || 'Experience on profile'

  /* How the score was produced, not a tier label. */
  const statusLabel = result.scoring && !result.scoring.reliable ? 'Provisional score' : 'AI-evaluated'

  const bandInterpretation =
    `${candidateName} scored ${careerScore}/100 for ${result.role || displayRole}. ${result.strengths[0] || ''} ${result.improvements[0] ? `Focus: ${result.improvements[0]}` : ''}`.trim()

  const proctorPenalty =
    typeof result.proctorScorePenalty === 'number' && result.proctorScorePenalty > 0 ? result.proctorScorePenalty : 0

  const scoreSubHint =
    sc?.scoreSubHint ??
    (result.improvements[0] ? 'AI-identified priorities below' : result.strengths[0] || statusLabel)

  const industryAlignment =
    sc?.industryAlignment ?? Math.max(1, Math.min(99, result.resumeFitScore ?? overall))

  const roleSkillsMeta = result.roleSkillsAnalysis
  const roleSkillRows = roleSkillsMeta?.skills ?? []
  const industryAlignmentCaption =
    sc?.industryAlignmentCaption ??
    (roleSkillsMeta?.requiredSkills?.length
      ? `Required role skills: ${roleSkillsMeta.onResume.length}/${roleSkillsMeta.requiredSkills.length} on résumé, ${roleSkillsMeta.evidencedInAnswers.length}/${roleSkillsMeta.requiredSkills.length} in answers (${roleSkillsMeta.fitScore}% fit)`
      : result.resumeFitScore != null
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

  /* Rating by topic is read from the same per-question star ratings the table shows,
     so the summary can never disagree with the rows below it. */
  const ratingByTopic = (() => {
    if (qaRows.length === 0) return starPatterns
    const groups = new Map<string, { filled: number; score: number; scored: number; n: number }>()
    for (const q of qaRows) {
      const key = q.topic || 'Interview'
      const g = groups.get(key) ?? { filled: 0, score: 0, scored: 0, n: 0 }
      g.filled += (q.stars.match(/★/g) ?? []).length
      g.n += 1
      if (typeof q.questionScore === 'number') {
        g.score += q.questionScore
        g.scored += 1
      }
      groups.set(key, g)
    }
    return [...groups.entries()].map(([name, g]) => {
      const filled = Math.max(0, Math.min(5, Math.round(g.filled / g.n)))
      const avg = g.scored > 0 ? g.score / g.scored : filled * 20
      return { name, stars: '★'.repeat(filled).padEnd(5, '☆'), level: tagFor(avg) }
    })
  })()

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


  const careerScorePct = careerScore
  const separateCategoryScores = Boolean(sc?.healthMetrics) && donuts.length > 0
  const statusTone = toneFor(careerScore)
  const starCount = (stars: string) => (stars.match(/★/g) ?? []).length

  return (
    <div className={styles.dashboardContainer} id="career-intelligence-dashboard" data-report-variant={variant}>
      {result.scoring && !result.scoring.reliable ? (
        <div className={styles.provisionalBanner} role="status">
          <strong>Provisional score.</strong>{' '}
          {(recruiter
            ? // Recruiter view only: the notice already starts with "Provisional score:", which repeated the label.
              result.scoring.notice?.replace(/^Provisional score:\s*/i, '').replace(/^./, (c) => c.toUpperCase())
            : result.scoring.notice) || 'The AI evaluator was unavailable, so this result uses basic checks only.'}
        </div>
      ) : null}

      {/* ── Header: who, what, when ── */}
      <header className={styles.headerCard}>
        {recruiter ? null : (
        <div className={styles.brandRow}>
          <div className={styles.logoTitle}>
            <BrandLogo size="md" />
            <span className={styles.brandText}>Interview report</span>
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
              {downloading ? 'Preparing download…' : 'Download report'}
            </button>
            {downloadError ? (
              <p className={styles.downloadError} role="alert">
                {downloadError}
              </p>
            ) : null}
          </div>
        </div>
        )}

        <div className={styles.candidateProfileRow}>
          <div className={styles.candidateLeftBlock}>
            <div className={styles.avatarBox} aria-hidden="true">
              {candidateName.charAt(0).toUpperCase()}
            </div>
            <div className={styles.candidateInfo}>
              <NameHeading className={styles.candidateName}>{candidateName}</NameHeading>
              <p className={styles.candidateSubtitle}>
                {displayRole} · {displayExperience}
              </p>
              <p className={styles.candidateTrack}>{result.role || displayRole}</p>
            </div>
          </div>

          <dl className={styles.metaGridRight}>
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Interview date</dt>
              <dd className={styles.metaValue}>{interviewDate}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Status</dt>
              <dd className={`${styles.metaValue} ${styles.metaDone}`}>
                <HrIcon name="check" size={14} /> Completed
              </dd>
            </div>
            {recruiter ? null : (
              <div className={styles.metaItem}>
                <dt className={styles.metaLabel}>Career track</dt>
                <dd className={styles.metaValue}>{result.role || displayRole}</dd>
              </div>
            )}
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Candidate ID</dt>
              <dd className={styles.metaValue}>{candidateId}</dd>
            </div>
            {recruiter ? null : (
              <div className={styles.metaItem}>
                <dt className={styles.metaLabel}>Resume visibility</dt>
                <dd className={`${styles.metaValue} ${styles.metaPrivate}`}>
                  <HrIcon name="lock" size={14} /> Private, not shared
                </dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      {/* ── Summary: one hero score, band, plain-language summary ── */}
      <section className={`${styles.card} ${styles.summaryCard}`} aria-labelledby="report-summary-heading">
        <div className={styles.summaryScore}>
          <h2 id="report-summary-heading" className={styles.cardTitle}>{recruiter ? 'Interview score' : 'Career score'}</h2>
          <div className={styles.scoreLine}>
            <span className={styles.scoreValue}>{careerScore}</span>
            <span className={styles.scoreOutOf}>/100</span>
          </div>
          <span className={`${styles.statusPill} ${recruiter ? styles.toneNeutral : statusTone}`}>{statusLabel}</span>
          {recruiter ? null : <p className={styles.scoreSubHint}>Your career score is your interview score.</p>}
          {proctorPenalty ? (
            <p className={styles.scoreSubHint}>
              Includes a −{proctorPenalty} point camera proctoring deduction
              {typeof result.scoreBeforeProctorPenalty === 'number'
                ? ` (${result.scoreBeforeProctorPenalty}/100 before the deduction)`
                : ''}
              .
            </p>
          ) : null}
          <p className={styles.scoreSubHint}>{scoreSubHint}</p>

          <div className={styles.scoreScale} aria-hidden="true">
            <div className={styles.scoreScaleTrack}>
              <span className={styles.scoreScaleFill} style={{ width: `${careerScorePct}%` }} />
            </div>
            <div className={styles.scoreScaleEnds}>
              <span>0</span>
              <span>100</span>
            </div>
          </div>
        </div>

        <div className={styles.summaryBody}>
          <h3 className={styles.subTitle}>Summary</h3>
          <p className={styles.bandInterpretation}>{bandInterpretation}</p>

          <dl className={styles.summaryStats}>
            <div>
              <dt>Interview score</dt>
              <dd>
                {careerScore}
                <small>/100</small>
              </dd>
            </div>
            <div>
              <dt>Questions</dt>
              <dd>{sessionStats?.questionCount ?? qaRows.length}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>
                {sessionStats?.durationMinutes ?? '—'}
                {sessionStats?.durationMinutes != null ? <small> min</small> : null}
              </dd>
            </div>
            <div>
              <dt>Role skills fit</dt>
              <dd>
                {industryAlignment}
                <small>%</small>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ── Score by area ── */}
      <section className={styles.card} aria-labelledby="report-areas-heading">
        <div className={styles.cardHead}>
          <h2 id="report-areas-heading" className={styles.cardTitle}>Score by area</h2>
          {recruiter ? (
            <p className={styles.cardNote}>Bars show score out of 100</p>
          ) : (
            <div className={styles.donutLegend} aria-hidden="true">
              <span><span className={`${styles.legendDot} ${styles.dotSuccess}`} /> Strong (75%+)</span>
              <span><span className={`${styles.legendDot} ${styles.dotWarning}`} /> Moderate (50–74%)</span>
              <span><span className={`${styles.legendDot} ${styles.dotNeutral}`} /> Developing (below 50%)</span>
            </div>
          )}
        </div>
        <ul className={styles.healthList}>
          {healthMetrics.map((hm, i) => (
            <li key={`${hm.label}-${i}`} className={styles.healthRow}>
              <span className={styles.healthCategory}>{hm.label}</span>
              <div className={styles.barTrack} aria-hidden="true">
                <div className={`${styles.barFill} ${fillFor(hm.score)}`} style={{ width: `${hm.score}%` }} />
              </div>
              <span className={styles.healthScoreNum}>{hm.score}%</span>
              {recruiter ? null : (
                <span className={`${styles.healthPerformanceTag} ${styles.statusPill} ${toneFor(hm.score)}`}>
                  {hm.tag}
                </span>
              )}
            </li>
          ))}
        </ul>

        {separateCategoryScores ? (
          <>
            <h3 className={styles.subTitle}>Category scores</h3>
            <ul className={styles.donutRow}>
              {donuts.map((d, i) => (
                <li key={`${d.label}-${i}`} className={styles.donutCol}>
                  <span className={styles.donutValue}>{d.score}%</span>
                  <span className={styles.donutLabel}>{d.label}</span>
                  {recruiter ? null : (
                    <span className={`${styles.donutTag} ${styles.statusPill} ${toneFor(d.score)}`}>
                      {d.tag}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* ── Strengths / to improve ── */}
      <section className={styles.rowGridTwo} aria-label="Strengths and areas to improve">
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Top strengths</h2>
          <ul className={styles.strengthsList}>
            {(result.strengths.length > 0 ? result.strengths : ['Complete an interview to generate AI strengths.']).map(
              (text, i) => (
                <li key={`${i}-${text}`}>
                  <HrIcon name="check" size={14} /> <span>{text}</span>
                </li>
              ),
            )}
          </ul>
        </div>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Top growth areas</h2>
          <ul className={styles.growthAreasList}>
            {(result.improvements.length > 0
              ? result.improvements
              : ['AI growth areas appear after your first scored interview.']
            ).map((text, i) => (
              <li key={`${i}-${text}`}>
                <HrIcon name="trending" size={14} /> <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Per-question detail: only on the detailed report (profile, recruiter review), never the one-pager ── */}
      {variant === 'detailed' ? (
      <section className={`${styles.card} ${styles.tableCard}`} aria-labelledby="report-questions-heading">
        <div className={styles.cardHead}>
          <h2 id="report-questions-heading" className={styles.cardTitle}>Questions and scores</h2>
          <p className={styles.cardNote}>
            {sessionStats?.interviewType ?? `${displayRole} · Adaptive AI interview`}
          </p>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.qaTable}>
            <thead>
              <tr>
                <th scope="col" className={styles.numCol}>#</th>
                <th scope="col">Topic</th>
                <th scope="col" className={styles.questionCol}>Question</th>
                <th scope="col" className={styles.scoreCol}>Correct</th>
                <th scope="col" className={styles.scoreCol}>Depth</th>
                <th scope="col" className={styles.scoreCol}>Clarity</th>
                <th scope="col" className={styles.scoreCol}>Overall</th>
                <th scope="col" className={styles.ratingCol}>Rating</th>
                <th scope="col">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {qaRows.map((q) => (
                <tr key={q.index}>
                  <td className={styles.numCol}>
                    <span className={styles.rowCircle}>{q.index}</span>
                  </td>
                  <td><span className={styles.topicTag}>{q.topic}</span></td>
                  <td className={styles.questionCell}>{q.question}</td>
                  <td className={styles.totalScoreCell}>
                    {typeof q.correctnessScore === 'number' ? `${q.correctnessScore}%` : '—'}
                  </td>
                  <td className={styles.totalScoreCell}>
                    {typeof q.depthScore === 'number'
                      ? `${q.depthScore}%`
                      : typeof q.depth === 'number'
                        ? `${q.depth * 10}%`
                        : '—'}
                  </td>
                  <td className={styles.totalScoreCell}>
                    {typeof q.communicationScore === 'number'
                      ? `${q.communicationScore}%`
                      : typeof q.clarity === 'number'
                        ? `${q.clarity * 10}%`
                        : '—'}
                  </td>
                  <td className={styles.totalScoreCell}>
                    <strong>
                      {typeof q.questionScore === 'number'
                        ? `${q.questionScore}%`
                        : typeof q.total30 === 'number'
                          ? `${Math.round((q.total30 / 30) * 100)}%`
                          : '—'}
                    </strong>
                  </td>
                  <td className={styles.starsCell}>
                    <span aria-hidden="true">{q.stars}</span>
                    <span className="ds-sr-only">{starCount(q.stars)} of 5 stars</span>
                  </td>
                  <td className={styles.feedbackCell}>{q.feedback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {ratingByTopic.length > 0 ? (
        <section className={styles.card} aria-labelledby="report-topics-heading">
            <h3 id="report-topics-heading" className={styles.subTitle}>Interview performance summary</h3>
            <ul className={styles.starSummaryGrid}>
              {ratingByTopic.map((p, i) => (
                <li key={`${p.name}-${i}`} className={styles.starSummaryItem}>
                  <span className={styles.starCategoryName}>{p.name}</span>
                  <span className={styles.starString}>
                    <span aria-hidden="true">{p.stars}</span>
                    <span className="ds-sr-only">{starCount(p.stars)} of 5 stars</span>
                  </span>
                  {recruiter ? null : <span className={styles.starLevelTag}>{p.level}</span>}
                </li>
              ))}
            </ul>
            {variant === 'summary' ? (
              <p className={styles.cardNote} data-download-exclude>
                The question-by-question breakdown is on <a href="/profile">your profile</a>.
              </p>
            ) : null}
        </section>
      ) : null}

      {/* ── What to do next (candidate coaching; not on the recruiter view) ── */}
      {recruiter ? null : (
      <section className={styles.rowGridTwo} aria-label="Improvement plan">
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>What to work on</h2>
          <ol className={styles.priorityList}>
            {priorities.map((p) => (
              <li key={p.num} className={styles.priorityItem}>
                <span className={styles.priorityNum} aria-hidden="true">{p.num}</span>
                <div>
                  <div className={styles.priorityTitle}>{p.title}</div>
                  <div className={styles.priorityText}>{p.text}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Coach notes</h2>
          <div className={styles.coachBubble}>
            <div className={styles.coachAvatar} aria-hidden="true">
              <HrIcon name="bot" size={22} />
            </div>
            <div>
              <p className={styles.coachQuote}>{coachNotes}</p>
              <div className={styles.coachSignature}>HireRight AI career coach</div>
            </div>
          </div>
        </div>
      </section>
      )}

      {/* ── Career fit ── */}
      <section className={styles.rowGridThree} aria-label="Career fit">
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Skill profile</h2>
          <svg className={styles.radarSvg} viewBox="0 0 220 220" role="img" aria-label="Skill strength by area">
            {[0.25, 0.5, 0.75, 1].map((lvl) => {
              const r = 75 * lvl
              const pts = radarAxes
                .map((_, i) => {
                  const angle = (Math.PI * 2 * i) / radarAxes.length - Math.PI / 2
                  return `${(110 + r * Math.cos(angle)).toFixed(1)},${(110 + r * Math.sin(angle)).toFixed(1)}`
                })
                .join(' ')
              return <polygon key={lvl} points={pts} fill="none" stroke="#e5e5ef" strokeWidth="1" />
            })}

            {radarAxes.map((axis, i) => {
              const angle = (Math.PI * 2 * i) / radarAxes.length - Math.PI / 2
              const x2 = 110 + 75 * Math.cos(angle)
              const y2 = 110 + 75 * Math.sin(angle)
              const lx = 110 + 94 * Math.cos(angle)
              const ly = 110 + 94 * Math.sin(angle)
              return (
                <g key={`${axis.label}-${i}`}>
                  <line x1="110" y1="110" x2={x2} y2={y2} stroke="#e5e5ef" strokeWidth="1" />
                  <text x={lx} y={ly + 3} textAnchor="middle" fontSize="7" fontWeight="600" fill="#5f6686">
                    {axis.label}
                  </text>
                  <text x={lx} y={ly + 11} textAnchor="middle" fontSize="7" fontWeight="700" fill="#141638">
                    {axis.val}%
                  </text>
                </g>
              )
            })}

            <polygon points={radarPoints} fill="rgba(80, 70, 229, 0.14)" stroke="#5046e5" strokeWidth="1.75" />
          </svg>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Role skills fit</h2>
          {roleSkillRows.length > 0 ? (
            <ul className={styles.growthList}>
              {roleSkillRows.map((g) => (
                <li key={g.skill}>
                  <div className={styles.growthItemHeader}>
                    <span>{g.skill}</span>
                    <span>{g.points}/100</span>
                  </div>
                  <div className={styles.barTrack} aria-hidden="true">
                    <div className={styles.barFill} style={{ width: `${g.points}%` }} />
                  </div>
                  <p className={styles.alignCaption}>
                    {g.onResume ? 'On résumé' : 'Not on résumé'} ·{' '}
                    {g.demonstrated ? 'shown in interview' : 'not shown in interview'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.cardNote}>No per-skill breakdown for this report.</p>
          )}
          {roleSkillsMeta?.method ? <p className={styles.cardNote}>{roleSkillsMeta.method}</p> : null}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Resume match</h2>
          <div className={styles.alignRow}>
            <span className={styles.alignValue}>{industryAlignment}%</span>
            <p className={styles.alignCaption}>{industryAlignmentCaption}</p>
          </div>
          <div className={styles.barTrack} aria-hidden="true">
            <div className={styles.barFill} style={{ width: `${industryAlignment}%` }} />
          </div>
          {recruiter ? null : (
            <p className={styles.privateNote}>
              <HrIcon name="lock" size={14} /> Your resume is currently kept private and not shared with recruiters.
            </p>
          )}
        </div>
      </section>

      {/* ── Resume positioning + skills (candidate advice; not on the recruiter view) ── */}
      {recruiter ? null : (
      <section className={styles.card} aria-labelledby="report-positioning-heading">
        <h2 id="report-positioning-heading" className={styles.cardTitle}>Resume suggestions</h2>
        {positioningItems.length > 0 ? (
          <ul className={styles.positioningIcons}>
            {positioningItems.map((text, i) => (
              <li key={`${i}-${text.slice(0, 24)}`} className={styles.posIconBox}>
                {text}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.cardNote}>
            No positioning gaps flagged. Your interview feedback is in the strengths list.
          </p>
        )}
        <p className={styles.positioningFooter}>{positioningFooter}</p>

        <div className={styles.skillsRibbon}>
          <span className={styles.skillsRibbonLabel}>Primary skills</span>
          {skillPills.length > 0 ? (
            skillPills.map((sk, i) => (
              <span key={`${sk}-${i}`} className={styles.skillPill}>
                {sk}
              </span>
            ))
          ) : (
            <span className={styles.skillsEmpty}>Skills from your profile appear here after onboarding</span>
          )}
        </div>
      </section>
      )}

      {/* ── Footer: status, recommended roles, one forward action ── */}
      <footer className={styles.footerRibbon}>
        <div className={styles.footerTopRow}>
          <div className={styles.finalStatusGroup}>
            <span className={styles.footerLabel}>{recruiter ? 'Interview score' : 'Career score'}</span>
            <span className={`${styles.statusPill} ${styles.finalStatusPill} ${recruiter ? styles.toneNeutral : statusTone}`}>
              <HrIcon name="check" size={14} /> {careerScore}/100 · {statusLabel}
            </span>
          </div>

          {recruiter ? null : (
          <div className={styles.recommendedRoles}>
            <span className={styles.footerLabel}>Recommended for</span>
            <div className={styles.rolePills}>
              {recommendedRoles.map((role, i) => (
                <span key={`${role}-${i}`} className={styles.rolePill}>
                  {role}
                </span>
              ))}
            </div>
          </div>
          )}
        </div>

        {recruiter ? null : (
        <div className={styles.nextStepBox}>
          <strong>Next step</strong>
          <span>{nextRecommendedStep}</span>
        </div>
        )}

        {onRetake || onContinue ? (
          <div className={styles.actionButtonRow} data-download-exclude>
            {onRetake && (
              <button type="button" className={styles.secondaryBtn} onClick={onRetake}>
                Retake interview with Ava
              </button>
            )}
            {onContinue && (
              <button type="button" className={styles.primaryBtn} onClick={onContinue}>
                Go to dashboard
                <HrIcon name="arrow-right" size={16} />
              </button>
            )}
          </div>
        ) : null}
      </footer>
    </div>
  )
}
