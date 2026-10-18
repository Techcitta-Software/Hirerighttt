import { SKILL_PATTERN } from './vendor/atsScore.mjs'

/** @typedef {{
 *   skills?: string[]
 *   experience?: unknown[]
 *   projects?: unknown[]
 *   education?: unknown[]
 * }} ParsedResumeShape */

/** @typedef {{
 *   title?: string
 *   requiredSkills?: string[]
 *   preferredSkills?: string[]
 *   minYearsExp?: number
 * }} JobDescriptionShape */

/** @typedef {{
 *   semanticProjectScore?: number
 *   experienceScore?: number
 *   educationScore?: number
 *   summary?: string
 * }} LlmAtsSubscores */

const SKILL_SYNONYMS = {
  reactjs: 'react',
  'react.js': 'react',
  nodejs: 'node.js',
  node: 'node.js',
  expressjs: 'express',
  'express.js': 'express',
  postgres: 'postgresql',
  psql: 'postgresql',
  mongo: 'mongodb',
  nextjs: 'next.js',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  cpp: 'c++',
  aws: 'amazon web services',
  k8s: 'kubernetes',
  sklearn: 'scikit-learn',
  'scikit learn': 'scikit-learn',
  hf: 'hugging face',
  llms: 'llm',
  genai: 'generative ai',
  pytorch: 'pytorch',
  tensorflow: 'tensorflow',
  langchain: 'langchain',
  llama: 'llamaindex',
  rag: 'rag',
  mlops: 'mlops',
}

export function normalizeSkill(skill = '') {
  const cleaned = String(skill || '')
    .toLowerCase()
    .trim()
  return SKILL_SYNONYMS[cleaned] || cleaned
}

/**
 * Lightweight structure from raw resume text (no file parser required).
 * @param {string} rawText
 * @returns {ParsedResumeShape}
 */
export function parseResumeStructure(rawText = '') {
  const text = String(rawText || '')
  const skills = []
  const skillRe = new RegExp(SKILL_PATTERN.source, 'gi')
  let m
  while ((m = skillRe.exec(text)) !== null) {
    const s = normalizeSkill(m[0])
    if (s && !skills.includes(s)) skills.push(s)
  }
  const hasEducation = /\b(b\.?\s*tech|b\.?\s*e\.?|bachelor|m\.?\s*tech|master|ph\.?d|computer science|information technology)\b/i.test(
    text,
  )
  const expBlocks = text.split(/\n(?=[A-Z][^\n]{0,40}(?:engineer|developer|intern|analyst|lead|manager))/i)
  return {
    skills,
    experience: expBlocks.slice(0, 8).map((block) => ({ raw: block.slice(0, 500) })),
    projects: /\bproject(s)?\b/i.test(text) ? [{ present: true }] : [],
    education: hasEducation ? [{ present: true }] : [],
  }
}

/**
 * Deterministic ATS formatting, sections, and quantified impact (0–100 bucket).
 */
export function evaluateFormatAndImpact(rawText = '', parsedResume = {}, usedOcrFallback = false) {
  let score = 0
  /** @type {string[]} */
  const feedback = []

  if (!usedOcrFallback && rawText.trim().length > 300) {
    score += 30
  } else {
    feedback.push(
      'Resume required OCR or had very little selectable text. Avoid image-based PDF templates.',
    )
  }

  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/.test(rawText)
  const hasLinks = /github\.com|linkedin\.com/i.test(rawText)
  const hasSkills = (parsedResume.skills?.length || 0) >= 3
  const hasExpOrProjects =
    (parsedResume.experience?.length || 0) > 0 || (parsedResume.projects?.length || 0) > 0

  if (hasEmail) score += 8
  else feedback.push('Missing a clear, parseable email address.')

  if (hasLinks) score += 7
  else feedback.push('Add GitHub or LinkedIn profile links.')

  if (hasSkills) score += 7
  if (hasExpOrProjects) score += 8

  const metricMatches =
    rawText.match(
      /\b\d+(?:\.\d+)?\s*(?:%|percent|ms|seconds|x|users|requests|clients|rps|gb|mb|k\+)\b/gi,
    ) || []

  if (metricMatches.length >= 4) {
    score += 40
  } else if (metricMatches.length >= 2) {
    score += 25
    feedback.push('Good use of metrics, but try quantifying more bullet points.')
  } else {
    score += 10
    feedback.push('Add measurable impact numbers to project bullets.')
  }

  return { score: Math.min(100, score), metricCount: metricMatches.length, feedback }
}

/**
 * Deterministic keyword & skill match (0–100).
 */
export function calculateKeywordMatch(
  candidateSkills = [],
  rawResumeText = '',
  jdRequiredSkills = [],
  jdPreferredSkills = [],
) {
  const normalizedCandidateSkills = new Set(candidateSkills.map(normalizeSkill))
  const lowerResumeText = rawResumeText.toLowerCase()

  const checkSkillPresent = (skill) => {
    const norm = normalizeSkill(skill)
    return normalizedCandidateSkills.has(norm) || lowerResumeText.includes(norm)
  }

  const matchedRequired = []
  const missingRequired = []
  for (const reqSkill of jdRequiredSkills) {
    if (checkSkillPresent(reqSkill)) matchedRequired.push(reqSkill)
    else missingRequired.push(reqSkill)
  }

  const matchedPreferred = []
  const missingPreferred = []
  for (const prefSkill of jdPreferredSkills) {
    if (checkSkillPresent(prefSkill)) matchedPreferred.push(prefSkill)
    else missingPreferred.push(prefSkill)
  }

  const reqRatio =
    jdRequiredSkills.length > 0 ? matchedRequired.length / jdRequiredSkills.length : 1
  const prefRatio =
    jdPreferredSkills.length > 0 ? matchedPreferred.length / jdPreferredSkills.length : 1

  const skillScore = Math.round((reqRatio * 0.8 + prefRatio * 0.2) * 100)

  return {
    score: skillScore,
    matchedSkills: [...matchedRequired, ...matchedPreferred],
    missingRequiredSkills: missingRequired,
    missingPreferredSkills: missingPreferred,
  }
}

/** Standalone resume readiness (no JD) — format/impact heavy. */
export function computeGeneralResumeReadinessScore(rawText, parsedResume, usedOcrFallback = false) {
  const formatResult = evaluateFormatAndImpact(rawText, parsedResume, usedOcrFallback)
  const skillCount = parsedResume.skills?.length || 0
  const skillBonus = Math.min(30, skillCount * 4)
  const sectionBonus =
    (parsedResume.education?.length ? 10 : 0) +
    (parsedResume.experience?.length ? 10 : 0)
  const overall = Math.min(100, Math.round(formatResult.score * 0.6 + skillBonus + sectionBonus))
  return {
    overallScore: overall,
    breakdown: {
      parseabilityAndImpact: formatResult.score,
      skillsClarity: skillBonus,
      sectionCompleteness: sectionBonus,
    },
    improvementTips: formatResult.feedback,
  }
}

/**
 * Hybrid ATS (deterministic + LLM sub-scores). Weights: skills 40%, semantic 25%, exp 15%, edu 10%, format 10%.
 */
export function computeFinalAtsScore({
  rawResumeText,
  parsedResume,
  jobDescription,
  llmEvaluation,
  usedOcrFallback = false,
}) {
  const jd = jobDescription || {}
  const formatResult = evaluateFormatAndImpact(rawResumeText, parsedResume, usedOcrFallback)

  const required = jd.requiredSkills || []
  const preferred = jd.preferredSkills || []
  const keywordResult = calculateKeywordMatch(
    parsedResume.skills || [],
    rawResumeText,
    required,
    preferred,
  )

  const semanticScore = llmEvaluation?.semanticProjectScore ?? 70
  const experienceScore = llmEvaluation?.experienceScore ?? 75
  const educationScore = llmEvaluation?.educationScore ?? 85

  const overallScore = Math.round(
    keywordResult.score * 0.4 +
      semanticScore * 0.25 +
      experienceScore * 0.15 +
      educationScore * 0.1 +
      formatResult.score * 0.1,
  )

  return {
    overallScore: Math.min(100, Math.max(0, overallScore)),
    breakdown: {
      skillsAndKeywords: keywordResult.score,
      projectAndRoleDepth: semanticScore,
      experienceAlignment: experienceScore,
      educationMatch: educationScore,
      parseabilityAndImpact: formatResult.score,
    },
    matchedKeywords: keywordResult.matchedSkills,
    missingKeywords: keywordResult.missingRequiredSkills,
    niceToHaveMissing: keywordResult.missingPreferredSkills,
    improvementTips: [
      ...(keywordResult.missingRequiredSkills.length > 0
        ? [
            `Add or highlight missing required skills: ${keywordResult.missingRequiredSkills.join(', ')}`,
          ]
        : []),
      ...formatResult.feedback,
    ],
    summary: llmEvaluation?.summary || '',
    jdMatchScore: keywordResult.score,
    resumeSkillCoverage: keywordResult.score,
    matchedSkills: keywordResult.matchedSkills,
    missingSkills: keywordResult.missingRequiredSkills,
  }
}

/** Employer interview composite: interview performance + resume/JD ATS. */
export function computeEmployerInterviewComposite(interviewOverall, atsOverall) {
  const interview = Math.min(100, Math.max(0, Math.round(Number(interviewOverall) || 0)))
  const ats = Math.min(100, Math.max(0, Math.round(Number(atsOverall) || 0)))
  return {
    compositeScore: Math.round(interview * 0.65 + ats * 0.35),
    interviewScore: interview,
    atsScore: ats,
  }
}
