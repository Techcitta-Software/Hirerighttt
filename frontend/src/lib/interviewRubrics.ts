/** Mirrors backend INTERVIEW_RUBRICS weights (backend/node/interviewAgent.mjs). */
export const INTERVIEW_RUBRICS = [
  { id: 'evidence', label: 'Evidence & Relevance', weight: 0.4 },
  { id: 'structure', label: 'Structure & Clarity', weight: 0.35 },
  { id: 'impact', label: 'Impact & Specificity', weight: 0.25 },
] as const

const STRUCTURE_SIGNALS = [
  'for example',
  'first',
  'then',
  'finally',
  'as a result',
  'because',
  'situation',
  'task',
  'action',
  'result',
]

function wordCountBandScore(wordCount: number) {
  if (wordCount < 8) return 15
  if (wordCount < 25) return 45
  if (wordCount < 45) return 72
  if (wordCount <= 180) return 100
  if (wordCount <= 260) return 78
  return 55
}

export function scoreAnswerRubrics(
  question: { keywords?: string[] },
  answer: string,
  profileSkills: string[] = [],
) {
  const text = answer.trim()
  const lower = text.toLowerCase()
  const wordCount = text.split(/\s+/).filter(Boolean).length

  const keywords = (question.keywords || []).map((k) => k.toLowerCase())
  const keywordsHit = keywords.filter((k) => lower.includes(k))
  const keywordCoverage =
    keywords.length > 0
      ? Math.round((keywordsHit.length / Math.min(keywords.length, 6)) * 100)
      : wordCount >= 20
        ? 70
        : 35

  const skillsHit = profileSkills.filter((s) => s.length >= 2 && lower.includes(s.toLowerCase()))
  const resumeEvidence = Math.min(100, skillsHit.length * 25 + (wordCount > 35 ? 15 : 0))
  const evidence = Math.min(100, Math.round(keywordCoverage * 0.55 + resumeEvidence * 0.45))

  const structureHits = STRUCTURE_SIGNALS.filter((s) => lower.includes(s)).length
  const structure = Math.min(
    100,
    Math.round(wordCountBandScore(wordCount) * 0.6 + Math.min(100, (structureHits / 3) * 100) * 0.4),
  )

  const hasNumbers = /\d/.test(text)
  const hasTools = /\b(react|node|python|sql|aws|docker|typescript|java)\b/i.test(text)
  let impact = 25
  if (hasNumbers) impact += 30
  if (hasTools) impact += 20
  impact = Math.min(100, impact)

  const rubrics = INTERVIEW_RUBRICS.map((r) => ({
    id: r.id,
    label: r.label,
    weight: r.weight,
    score: r.id === 'evidence' ? evidence : r.id === 'structure' ? structure : impact,
  }))
  const score = Math.min(100, Math.round(rubrics.reduce((s, r) => s + r.score * r.weight, 0)))
  return { rubrics, score }
}
