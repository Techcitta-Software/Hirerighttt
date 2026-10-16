const SKILL_STOP = new Set([
  'and', 'or', 'the', 'with', 'for', 'years', 'year', 'experience', 'required', 'must', 'have',
  'ability', 'strong', 'good', 'plus', 'including', 'using', 'work', 'team', 'role', 'job',
])

const SKILL_PATTERN =
  /\b(?:React(?:\.js)?|Node(?:\.js)?|TypeScript|JavaScript|Python|Java|Go|Golang|AWS|Azure|GCP|Docker|Kubernetes|SQL|PostgreSQL|MongoDB|Redis|Kafka|GraphQL|REST|API|CI\/CD|Agile|Scrum|Next\.js|Vue|Angular|Tailwind|Redux|Spring|Django|FastAPI|LLM|Gemini|OpenAI|Machine Learning|Data Engineering|DevOps|SRE|Microservices|System Design)\b/gi

/** @param {string} jd */
export function extractPrimarySkillsFromJd(jd, requiredSkills = []) {
  const fromList = (requiredSkills || []).map((s) => String(s).trim()).filter(Boolean)
  const found = new Set(fromList.map((s) => s.toLowerCase()))
  const text = String(jd || '')
  let m
  const re = new RegExp(SKILL_PATTERN.source, 'gi')
  while ((m = re.exec(text)) !== null) {
    const token = m[0].trim()
    if (token.length > 1) found.add(token.toLowerCase())
  }
  for (const word of text.toLowerCase().split(/[^a-z0-9+#./-]+/)) {
    if (word.length < 2 || word.length > 24 || SKILL_STOP.has(word)) continue
    if (/^[a-z]+(?:js|ts|py)?$/.test(word) && word.length >= 3) found.add(word)
  }
  return [...found].slice(0, 40).map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()))
}

function normalizeText(text) {
  return String(text || '').toLowerCase()
}

function tokenizeSkills(text) {
  const norm = normalizeText(text)
  const set = new Set()
  let m
  const re = new RegExp(SKILL_PATTERN.source, 'gi')
  while ((m = re.exec(norm)) !== null) set.add(m[0].toLowerCase())
  for (const part of norm.split(/[^a-z0-9+#./-]+/)) {
    if (part.length >= 3 && part.length <= 24 && !SKILL_STOP.has(part)) set.add(part)
  }
  return set
}

/**
 * Resume ↔ JD ATS-style match (0–100). Does not call an LLM.
 * @param {{ resumeText: string, jobDescription: string, requiredSkills?: string[] }} input
 */
export function computeAtsScore(input) {
  const jd = String(input.jobDescription || '')
  const resume = String(input.resumeText || '')
  const primarySkills = extractPrimarySkillsFromJd(jd, input.requiredSkills || [])
  if (!jd.trim() && !primarySkills.length) {
    return { atsScore: 0, jdMatchScore: 0, resumeSkillCoverage: 0, primarySkills, matchedSkills: [], missingSkills: [] }
  }

  const jdTokens = tokenizeSkills(jd)
  const resumeTokens = tokenizeSkills(resume)
  const skillKeys = primarySkills.map((s) => s.toLowerCase())

  const matchedSkills = []
  const missingSkills = []
  for (const skill of skillKeys.length ? skillKeys : [...jdTokens].slice(0, 25)) {
    const hit =
      resumeTokens.has(skill) ||
      resume.includes(skill) ||
      [...resumeTokens].some((t) => t.includes(skill) || skill.includes(t))
    if (hit) matchedSkills.push(skill)
    else missingSkills.push(skill)
  }

  const denom = Math.max(1, skillKeys.length || jdTokens.size || 1)
  const resumeSkillCoverage = Math.round((matchedSkills.length / denom) * 100)

  let jdOverlap = 0
  if (jdTokens.size) {
    let overlap = 0
    for (const t of jdTokens) if (resumeTokens.has(t)) overlap++
    jdOverlap = Math.round((overlap / jdTokens.size) * 100)
  }

  const atsScore = Math.min(100, Math.round(resumeSkillCoverage * 0.65 + jdOverlap * 0.35))
  return {
    atsScore,
    jdMatchScore: jdOverlap,
    resumeSkillCoverage,
    primarySkills,
    matchedSkills,
    missingSkills: missingSkills.slice(0, 20),
  }
}
