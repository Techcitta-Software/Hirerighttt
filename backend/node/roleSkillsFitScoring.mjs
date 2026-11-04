/**
 * Role-required skills (roleSkills.json) vs résumé + interview answer evidence.
 */

function clean(s) {
  return String(s ?? '').trim()
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(n) || 0)))
}

function canonicalSkillKey(value) {
  return value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9+#]/g, '')
}

function skillTokens(skill) {
  const c = canonicalSkillKey(skill)
  const parts = clean(skill)
    .toLowerCase()
    .split(/[\s/&,+-]+/)
    .map((p) => p.replace(/[^a-z0-9+#]/g, ''))
    .filter((p) => p.length >= 2)
  return unique([c, ...parts])
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))]
}

function blobIncludesSkill(blob, skill) {
  const lower = blob.toLowerCase()
  for (const token of skillTokens(skill)) {
    if (token.length >= 4 && lower.includes(token)) return true
    if (token.length >= 2 && new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(lower))
      return true
  }
  if (/machinelearning|mlfundamental/i.test(canonicalSkillKey(skill))) {
    return /\bmachine learning\b|\bml\b|scikit|sklearn|classifier|model/i.test(lower)
  }
  if (/pythonprogramming|^python$/i.test(canonicalSkillKey(skill))) {
    return /\bpython\b/i.test(lower)
  }
  return false
}

/** @param {string[]} requiredSkills — top role skills from catalog (max 3). */
export function normalizeRequiredRoleSkills(requiredSkills = []) {
  return unique(requiredSkills.map(clean).filter(Boolean)).slice(0, 3)
}

export function skillEvidenceOnResume(skill, ctx = {}) {
  const resumeBlob = unique([...(ctx.skills || []), clean(ctx.resumeSnippet)]).join(' ')
  return blobIncludesSkill(resumeBlob, skill)
}

export function skillEvidenceInAnswer(skill, answer = '') {
  return blobIncludesSkill(clean(answer), skill)
}

/**
 * Per-question fit: targeted catalog skill vs résumé + this answer.
 * @returns {number|null} 0–100, or null when no required skills configured.
 */
export function computeQuestionRoleSkillsFit(question, answer, ctx, requiredSkills) {
  const required = normalizeRequiredRoleSkills(requiredSkills)
  if (!required.length) return null

  const qText = `${clean(question.topic)} ${clean(question.text)}`.toLowerCase()
  const targeted =
    required.find((s) => qText.includes(clean(s).toLowerCase())) ||
    required.find((s) => skillTokens(s).some((t) => t.length >= 3 && qText.includes(t)))

  if (targeted) {
    const onResume = skillEvidenceOnResume(targeted, ctx)
    const inAnswer = skillEvidenceInAnswer(targeted, answer)
    if (onResume && inAnswer) return 100
    if (onResume && !inAnswer) return 52
    if (!onResume && inAnswer) return 68
    return 22
  }

  const hits = required.filter((s) => skillEvidenceInAnswer(s, answer)).length
  return clamp(Math.round((hits / required.length) * 88))
}

/** Session summary: how many required skills appear on résumé vs in answers. */
export function computeSessionRoleSkillsFit(ctx, requiredSkills, answers = []) {
  const required = normalizeRequiredRoleSkills(requiredSkills)
  if (!required.length) {
    return {
      fitScore: 0,
      requiredSkills: [],
      onResume: [],
      evidencedInAnswers: [],
      resumeMatchCount: 0,
      answerMatchCount: 0,
    }
  }

  const joined = answers.map((a) => clean(a)).join(' ')
  const onResume = required.filter((s) => skillEvidenceOnResume(s, ctx))
  const evidencedInAnswers = required.filter((s) => skillEvidenceInAnswer(s, joined))
  const n = required.length
  const resumePart = (onResume.length / n) * 50
  const answerPart = (evidencedInAnswers.length / n) * 50
  const fitScore = clamp(Math.round(resumePart + answerPart))

  return {
    fitScore,
    requiredSkills: required,
    onResume,
    evidencedInAnswers,
    resumeMatchCount: onResume.length,
    answerMatchCount: evidencedInAnswers.length,
  }
}
