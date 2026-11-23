/**
 * Role Skills Fit — an exact port of backend/app/services/role_skills_fit_scoring.py.
 *
 * The API is the source of truth: reports display `roleSkillsAnalysis.fitScore` from the server. This port is
 * only used by the offline fallback scorer (no API) and must give the same number for the same input:
 * each required skill earns 40 points when it is on the resume and 60 points when it was demonstrated in the
 * interview (an answer about it scored 60+, or an answer naming it scored 50+); the fit is the average.
 */
import type { RoleSkillFitRow, RoleSkillsAnalysis } from './store'

export const MAX_REQUIRED_SKILLS = 6
export const RESUME_POINTS = 40
export const INTERVIEW_POINTS = 60
export const TARGETED_MIN_SCORE = 60
export const MENTION_MIN_SCORE = 50

export const ROLE_SKILLS_FIT_METHOD =
  `Each required skill earns ${RESUME_POINTS} points when it is on the resume and ${INTERVIEW_POINTS} points ` +
  `when it was demonstrated in the interview (an answer about it scored ${TARGETED_MIN_SCORE}+ or an answer ` +
  `naming it scored ${MENTION_MIN_SCORE}+). Role Skills Fit is the average across the required skills.`

type Ctx = { skills?: string[]; resumeSnippet?: string }
type Q = { text?: string; topic?: string }

const clean = (s: unknown) => String(s ?? '').trim()

/** Python's round() (banker's rounding) so .5 cases match the API exactly. */
function pyRound(n: number) {
  const f = Math.floor(n)
  const diff = n - f
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1
  return Math.round(n)
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, pyRound(Number(n) || 0)))
}

function canonicalSkillKey(value: string) {
  return value.toLowerCase().replace(/\.js/g, '').replace(/[^a-z0-9+#]/g, '')
}

function skillTokens(skill: string) {
  const c = canonicalSkillKey(skill)
  const parts = clean(skill)
    .toLowerCase()
    .split(/[\s/&,+-]+/)
    .map((p) => p.replace(/[^a-z0-9+#]/g, ''))
    .filter((p) => p.length >= 2)
  const out = [c, ...parts]
  // "LLMs" must match an answer that says "LLM" (and "APIs" -> "API").
  out.push(...out.filter((p) => p.length >= 4 && p.endsWith('s') && !p.endsWith('ss')).map((p) => p.slice(0, -1)))
  return [...new Set(out.filter(Boolean))]
}

function blobIncludesSkill(blob: string, skill: string) {
  const lower = blob.toLowerCase()
  for (const token of skillTokens(skill)) {
    if (token.length >= 4 && lower.includes(token)) return true
    if (
      token.length >= 2 &&
      new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(lower)
    )
      return true
  }
  const key = canonicalSkillKey(skill)
  if (key.includes('machinelearning') || key.includes('mlfundamental')) {
    return /\bmachine learning\b|\bml\b|scikit|sklearn|classifier|model/i.test(lower)
  }
  if (key.includes('pythonprogramming') || key === 'python') return /\bpython\b/i.test(lower)
  return false
}

export function normalizeRequiredRoleSkills(requiredSkills: string[] = [], limit = MAX_REQUIRED_SKILLS) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of requiredSkills) {
    const s = clean(raw)
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

export function skillEvidenceOnResume(skill: string, ctx: Ctx) {
  return blobIncludesSkill([...(ctx.skills || []).map(String), clean(ctx.resumeSnippet)].join(' '), skill)
}

export function skillEvidenceInAnswer(skill: string, answer = '') {
  return blobIncludesSkill(clean(answer), skill)
}

export function questionTargetsSkill(question: Q, skill: string) {
  const qText = `${clean(question.topic)} ${clean(question.text)}`.toLowerCase()
  return qText.includes(clean(skill).toLowerCase()) || skillTokens(skill).some((t) => t.length >= 3 && qText.includes(t))
}

/** Per-answer rubric for a question about one required skill; null when the question is about none. */
export function computeQuestionRoleSkillsFit(question: Q, answer: string, ctx: Ctx, requiredSkills: string[]): number | null {
  const required = normalizeRequiredRoleSkills(requiredSkills)
  if (!required.length) return null
  const qText = `${clean(question.topic)} ${clean(question.text)}`.toLowerCase()
  const targeted =
    required.find((s) => qText.includes(clean(s).toLowerCase())) ||
    required.find((s) => questionTargetsSkill(question, s))
  if (!targeted) return null
  return (
    (skillEvidenceOnResume(targeted, ctx) ? RESUME_POINTS : 0) +
    (skillEvidenceInAnswer(targeted, answer) ? INTERVIEW_POINTS : 0)
  )
}

function emptyResult(skillSource: RoleSkillsAnalysis['skillSource']): RoleSkillsAnalysis {
  return {
    fitScore: 0,
    requiredSkills: [],
    skills: [],
    matchedSkills: [],
    missingSkills: [],
    onResume: [],
    evidencedInAnswers: [],
    resumeMatchCount: 0,
    answerMatchCount: 0,
    skillSource,
    weights: { resume: RESUME_POINTS, interview: INTERVIEW_POINTS },
    method: ROLE_SKILLS_FIT_METHOD,
  }
}

export function computeRoleSkillsFit(
  ctx: Ctx,
  requiredSkills: string[] | null | undefined,
  questions: Q[] = [],
  answers: string[] = [],
  answerScores: (number | null | undefined)[] = [],
  skillSource: RoleSkillsAnalysis['skillSource'] = 'role',
): RoleSkillsAnalysis {
  const required = normalizeRequiredRoleSkills(requiredSkills ?? [])
  if (!required.length) return emptyResult(skillSource)
  const rows: RoleSkillFitRow[] = required.map((skill) => {
    const onResume = skillEvidenceOnResume(skill, ctx)
    let evidenceQuestion: number | null = null
    for (let i = 0; i < answers.length; i++) {
      const score = answerScores[i]
      if (score == null || !clean(answers[i])) continue
      const q = questions[i] ?? {}
      if (
        (score >= TARGETED_MIN_SCORE && questionTargetsSkill(q, skill)) ||
        (score >= MENTION_MIN_SCORE && skillEvidenceInAnswer(skill, answers[i]))
      ) {
        evidenceQuestion = i + 1
        break
      }
    }
    const points = (onResume ? RESUME_POINTS : 0) + (evidenceQuestion ? INTERVIEW_POINTS : 0)
    return {
      skill,
      onResume,
      demonstrated: evidenceQuestion != null,
      evidenceQuestion,
      points,
      status: points === 100 ? 'matched' : points ? 'partial' : 'missing',
    }
  })
  const onResume = rows.filter((r) => r.onResume).map((r) => r.skill)
  const evidenced = rows.filter((r) => r.demonstrated).map((r) => r.skill)
  return {
    ...emptyResult(skillSource),
    fitScore: clamp(rows.reduce((s, r) => s + r.points, 0) / rows.length),
    requiredSkills: required,
    skills: rows,
    matchedSkills: rows.filter((r) => r.points > 0).map((r) => r.skill),
    missingSkills: rows.filter((r) => r.points === 0).map((r) => r.skill),
    onResume,
    evidencedInAnswers: evidenced,
    resumeMatchCount: onResume.length,
    answerMatchCount: evidenced.length,
  }
}

/** Resume-only view (no interview scores yet): interview evidence counts as not demonstrated. */
export function computeSessionRoleSkillsFit(ctx: Ctx, requiredSkills: string[]): RoleSkillsAnalysis {
  return computeRoleSkillsFit(ctx, requiredSkills)
}
