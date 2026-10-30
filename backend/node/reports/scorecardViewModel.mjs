function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return hash
}

function tagFor(score) {
  return score >= 75 ? 'Strong' : score >= 50 ? 'Moderate' : score >= 25 ? 'Developing' : 'Needs work'
}

function colorFor(score) {
  return score >= 75 ? '#16a34a' : score >= 50 ? '#ea580c' : '#dc2626'
}

function formatInterviewDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Mirrors CareerIntelligenceDashboard derived fields for HTML/PDF export.
 * @param {{
 *   result: Record<string, unknown>,
 *   candidateName: string,
 *   candidateRole?: string,
 *   candidateExperience?: string,
 *   skills?: string[],
 * }} input
 */
export function buildScorecardViewModel(input) {
  const result = input.result || {}
  const sc = /** @type {Record<string, unknown>} */ (result.scorecard || {})
  const overall = Number(result.overall) || 0
  const candidateName = String(input.candidateName || 'Candidate').trim() || 'Candidate'
  const displayRole = input.candidateRole || String(result.role || 'Candidate')
  const displayExperience = String(input.candidateExperience || '').trim() || 'Experience on profile'
  const roleKey = displayRole
  const candidateId = `HRT-AI-IND-${(Math.abs(hashString(candidateName + roleKey) % 90000) + 10000)}`
  const careerScore =
    typeof sc.careerScore === 'number'
      ? sc.careerScore
      : Math.min(980, Math.max(50, Math.round(overall * 10)))

  const statusLabel =
    sc.finalCareerStatus ??
    (careerScore >= 850
      ? 'Premium Market-Ready'
      : careerScore >= 700
        ? 'Industry Ready'
        : careerScore >= 550
          ? 'Growth Potential'
          : 'Skill Enhancement Recommended')

  const strengths = Array.isArray(result.strengths) ? result.strengths.map(String) : []
  const improvements = Array.isArray(result.improvements) ? result.improvements.map(String) : []

  const bandInterpretation =
    sc.bandInterpretation ??
    `${candidateName} scored ${overall}/100 for ${result.role || displayRole}. ${strengths[0] || ''} ${improvements[0] ? `Focus: ${improvements[0]}` : ''}`.trim()

  const scoreSubHint =
    sc.scoreSubHint ??
    (improvements[0] ? 'AI-identified priorities below' : strengths[0] || statusLabel)

  const industryAlignment =
    typeof sc.industryAlignment === 'number'
      ? sc.industryAlignment
      : Math.max(1, Math.min(99, Number(result.resumeFitScore) || overall))

  const industryAlignmentCaption =
    sc.industryAlignmentCaption ??
    (result.resumeFitScore != null
      ? `Resume fit score ${result.resumeFitScore}% from this interview`
      : `Overall alignment ${industryAlignment}%`)

  const categories = Array.isArray(result.categories) ? result.categories : []
  const donuts = categories.length
    ? categories.map((c) => {
        const row = /** @type {{ label?: string, score?: number }} */ (c)
        const score = Number(row.score) || 0
        return { label: String(row.label || ''), score, tag: tagFor(score), color: colorFor(score) }
      })
    : Array.isArray(sc.donuts)
      ? /** @type {any[]} */ (sc.donuts)
      : [{ label: 'Overall', score: overall, tag: tagFor(overall), color: colorFor(overall) }]

  const healthMetrics = Array.isArray(sc.healthMetrics)
    ? /** @type {any[]} */ (sc.healthMetrics)
    : donuts.map((d) => ({ label: d.label, score: d.score, tag: d.tag, color: d.color }))

  const qaRows = Array.isArray(sc.qaRows) && sc.qaRows.length
    ? /** @type {any[]} */ (sc.qaRows)
    : (Array.isArray(result.answers) ? result.answers : []).map((a, i) => {
        const row = /** @type {Record<string, unknown>} */ (a)
        const score = Number(row.score) || 0
        return {
          index: i + 1,
          topic: String(row.category || 'General'),
          question: String(row.question || ''),
          questionScore: score,
          stars: score >= 75 ? '★★★★☆' : score >= 50 ? '★★★☆☆' : '★★☆☆☆',
          feedback: String(row.feedback || row.summary || ''),
        }
      })

  const radarAxes = categories.length
    ? categories.map((c) => {
        const row = /** @type {{ label?: string, score?: number }} */ (c)
        return { label: String(row.label || ''), val: Number(row.score) || 0 }
      })
    : Array.isArray(sc.radarAxes)
      ? /** @type {any[]} */ (sc.radarAxes)
      : [{ label: 'Overall', val: overall }]

  const radarPoints = radarAxes
    .map((axis, i) => {
      const angle = (Math.PI * 2 * i) / radarAxes.length - Math.PI / 2
      const r = (axis.val / 100) * 75
      const x = 110 + r * Math.cos(angle)
      const y = 110 + r * Math.sin(angle)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const sessionStats = sc.sessionStats || {
    durationMinutes: Math.max(8, qaRows.length * 4),
    questionCount: qaRows.length,
    overallInterviewScore: overall,
    interviewType: `${displayRole} · Adaptive AI Interview`,
  }

  const starPatterns =
    Array.isArray(sc.starPatterns) && sc.starPatterns.length
      ? sc.starPatterns
      : qaRows.slice(0, 7).map((q, i) => ({
          name: q.topic || `Topic ${i + 1}`,
          stars: q.stars || '★★★☆☆',
          level: (q.total30 ?? 0) >= 22 ? 'Strong' : 'Moderate',
        }))

  const careerPaths =
    Array.isArray(sc.careerPaths) && sc.careerPaths.length
      ? sc.careerPaths
      : [
          { role: displayRole, match: Math.max(1, Math.min(99, overall)) },
          { role: `${displayRole} (Senior)`, match: Math.max(1, Math.min(99, overall - 3)) },
          { role: String(result.role || displayRole), match: Math.max(1, Math.min(99, Math.round(overall * 0.92))) },
        ]

  const priorities =
    Array.isArray(sc.priorities) && sc.priorities.length
      ? sc.priorities
      : improvements.slice(0, 4).map((text, i) => ({
          num: i + 1,
          title: text.slice(0, 50),
          text,
        }))

  const positioningItems =
    Array.isArray(sc.positioningRecommendations) && sc.positioningRecommendations.length
      ? sc.positioningRecommendations
      : improvements.slice(0, 5)

  const recommendedRoles =
    Array.isArray(sc.recommendedRoles) && sc.recommendedRoles.length
      ? sc.recommendedRoles
      : [String(result.role || displayRole), ...categories.slice(0, 2).map((c) => `${c.label} strength`)].filter(Boolean)

  const coachNotes =
    String(sc.coachNotes || '') ||
    `${candidateName}, your overall interview score is ${overall}/100. Review strengths and growth areas below to improve your market readiness.`

  const nextRecommendedStep =
    sc.nextRecommendedStep ??
    improvements[0] ??
    'Retake the interview after practicing structured STAR answers tied to your resume.'

  const positioningFooter =
    sc.positioningFooter ??
    (improvements[0] ? `Prioritize: ${improvements[0]}` : 'Keep anchoring answers in measurable outcomes from your experience.')

  const skillPills = (input.skills || []).slice(0, 10)
  const speedoOffset = 251.2 - (251.2 * careerScore) / 1000
  const angleDeg = -180 + (careerScore / 1000) * 180
  const needleRad = (angleDeg * Math.PI) / 180
  const needleX = 100 + 64 * Math.cos(needleRad)
  const needleY = 100 + 64 * Math.sin(needleRad)

  return {
    candidateName,
    displayRole,
    displayExperience,
    candidateId,
    interviewDate: formatInterviewDate(String(result.date || '')),
    careerScore,
    statusLabel,
    bandInterpretation,
    scoreSubHint,
    industryAlignment,
    industryAlignmentCaption,
    overall,
    donuts,
    healthMetrics,
    qaRows,
    radarAxes,
    radarPoints,
    sessionStats,
    starPatterns,
    careerPaths,
    priorities,
    positioningItems,
    recommendedRoles,
    coachNotes,
    nextRecommendedStep,
    positioningFooter,
    skillPills,
    strengths,
    improvements,
    speedoOffset,
    needleX,
    needleY,
    roleTitle: String(result.role || displayRole),
    level: String(result.level || ''),
  }
}
