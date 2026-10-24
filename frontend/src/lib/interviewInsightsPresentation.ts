import type { InterviewResult } from './store'

export type CandidatePerformanceDimension = {
  key: string
  title: string
  caption: string
  score: number
  band: 'strong' | 'steady' | 'growth'
}

const GENERIC_ANSWER_FEEDBACK =
  /^(solid response|too brief|no response|\(no response)/i

function normalizeKey(label: string) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scoreBand(score: number): CandidatePerformanceDimension['band'] {
  if (score >= 72) return 'strong'
  if (score >= 45) return 'steady'
  return 'growth'
}

/** Candidate-facing dimension titles — never expose internal rubric ids on the dashboard. */
export function toCandidateDimension(label: string, score: number, role: string): CandidatePerformanceDimension {
  const key = normalizeKey(label)
  const rolePhrase = role?.trim() || 'this role'

  if (key.includes('correct') || key.includes('accuracy') || key.includes('role alignment')) {
    return {
      key: 'alignment',
      title: 'Role fit',
      caption: `How convincingly your answers connect to ${rolePhrase} and your background.`,
      score,
      band: scoreBand(score),
    }
  }
  if (key.includes('depth') || key.includes('impact') || key.includes('detail')) {
    return {
      key: 'impact',
      title: 'Impact & examples',
      caption: 'Outcomes, tools, and trade-offs you brought into your stories.',
      score,
      band: scoreBand(score),
    }
  }
  if (key.includes('communication') || key.includes('clarity') || key.includes('structure')) {
    return {
      key: 'clarity',
      title: 'Clarity',
      caption: 'How easy it is to follow your reasoning from start to finish.',
      score,
      band: scoreBand(score),
    }
  }
  if (key.includes('technical') || key.includes('system design')) {
    return {
      key: 'technical',
      title: 'Technical breadth',
      caption: `Concepts and skills relevant to ${rolePhrase}.`,
      score,
      band: scoreBand(score),
    }
  }
  if (key.includes('problem')) {
    return {
      key: 'problem',
      title: 'Structured thinking',
      caption: 'How you break down problems and explain your approach.',
      score,
      band: scoreBand(score),
    }
  }
  if (key.includes('experience')) {
    return {
      key: 'experience',
      title: 'Experience signal',
      caption: 'How well your past work supports the level you are targeting.',
      score,
      band: scoreBand(score),
    }
  }

  const cleaned = String(label || 'Interview signal')
    .replace(/^answer\s+/i, '')
    .replace(/\s*\(ai\)\s*/i, '')
    .trim()
  return {
    key: key || 'custom',
    title: cleaned.length > 2 ? cleaned : 'Interview signal',
    caption: `Personalized signal from your session for ${rolePhrase}.`,
    score,
    band: scoreBand(score),
  }
}

export function buildPerformanceDimensions(interview: InterviewResult | null | undefined): CandidatePerformanceDimension[] {
  if (!interview?.categories?.length) return []
  const role = interview.role || 'your target role'
  const seen = new Set<string>()
  const out: CandidatePerformanceDimension[] = []
  for (const row of interview.categories) {
    if (!Number.isFinite(row.score)) continue
    const dim = toCandidateDimension(row.label, row.score, role)
    if (seen.has(dim.key)) continue
    seen.add(dim.key)
    out.push(dim)
  }
  return out
}

function uniqueLines(lines: string[], max: number) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || seen.has(line.toLowerCase())) continue
    seen.add(line.toLowerCase())
    out.push(line)
    if (out.length >= max) break
  }
  return out
}

/** Highlights from this candidate's interview only (AI strengths or top answer feedback). */
export function buildCandidateHighlights(
  interview: InterviewResult | null | undefined,
  dimensions: CandidatePerformanceDimension[],
): string[] {
  if (!interview) return []

  const fromStrengths = uniqueLines(interview.strengths ?? [], 4)
  if (fromStrengths.length) return fromStrengths

  const fromAnswers = (interview.answers ?? [])
    .filter((a) => a.score >= 68 && a.feedback?.trim() && !GENERIC_ANSWER_FEEDBACK.test(a.feedback))
    .sort((a, b) => b.score - a.score)
    .map((a) => a.feedback.trim())

  if (fromAnswers.length) return uniqueLines(fromAnswers, 3)

  const topDims = [...dimensions].sort((a, b) => b.score - a.score).slice(0, 2)
  if (topDims.length) {
    return topDims.map(
      (d) =>
        `${d.title} is a relative strength (${d.score}/100) — lean on this in applications and interviews.`,
    )
  }

  return []
}

/** Growth areas from this candidate's interview only (AI improvements or weakest signals). */
export function buildCandidateFocusNext(
  interview: InterviewResult | null | undefined,
  dimensions: CandidatePerformanceDimension[],
): string[] {
  if (!interview) return []

  const fromImprovements = uniqueLines(interview.improvements ?? [], 4)
  if (fromImprovements.length) return fromImprovements

  const fromWeakAnswers = (interview.answers ?? [])
    .filter((a) => a.score < 58 && a.feedback?.trim() && !GENERIC_ANSWER_FEEDBACK.test(a.feedback))
    .sort((a, b) => a.score - b.score)
    .map((a) => {
      const topic =
        a.question.length > 72 ? `${a.question.slice(0, 69).trim()}…` : a.question.trim()
      return topic ? `When discussing “${topic}”, ${a.feedback.charAt(0).toLowerCase()}${a.feedback.slice(1)}` : a.feedback
    })

  if (fromWeakAnswers.length) return uniqueLines(fromWeakAnswers, 3)

  const growthDims = [...dimensions].sort((a, b) => a.score - b.score).slice(0, 2)
  return growthDims.map((d) => {
    if (d.band === 'growth') {
      return `Invest in ${d.title.toLowerCase()}: ${d.caption}`
    }
    return `Push ${d.title.toLowerCase()} further with one concrete metric or outcome in your next practice session.`
  })
}

export function buildInterviewInsights(interview: InterviewResult | null | undefined) {
  const dimensions = buildPerformanceDimensions(interview)
  return {
    dimensions,
    highlights: buildCandidateHighlights(interview, dimensions),
    focusNext: buildCandidateFocusNext(interview, dimensions),
  }
}
