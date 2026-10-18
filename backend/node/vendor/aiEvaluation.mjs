import {
  computeFinalAtsScore,
  parseResumeStructure,
} from '../atsScorer.mjs'
import { computeAtsScore, extractPrimarySkillsFromJd } from './atsScore.mjs'
import { evaluateAtsSemanticSubscores } from './atsSemanticEval.mjs'
import { callLlmApi } from '../interviewAgent.mjs'

function parseJsonBlock(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function inferPreferredSkills(jd, requiredSkills) {
  const primary = extractPrimarySkillsFromJd(jd, requiredSkills || [])
  const requiredSet = new Set((requiredSkills || []).map((s) => String(s).toLowerCase()))
  return primary.filter((s) => !requiredSet.has(String(s).toLowerCase())).slice(0, 12)
}

/**
 * Hybrid ATS: deterministic keyword/format math + LLM semantic sub-scores only.
 */
export async function evaluateResumeAgainstJd({
  resumeText,
  jobDescription,
  requiredSkills,
  roleTitle,
  usedOcrFallback = false,
  skipLlm = false,
}) {
  const jd = String(jobDescription || '')
  const resume = String(resumeText || '')
  const baseline = computeAtsScore({ resumeText: resume, jobDescription: jd, requiredSkills })
  const parsedResume = parseResumeStructure(resume)
  for (const s of baseline.primarySkills || []) {
    const n = String(s).toLowerCase()
    if (!parsedResume.skills.some((x) => x === n || x.includes(n))) {
      parsedResume.skills.push(n)
    }
  }

  const required = (requiredSkills?.length ? requiredSkills : baseline.primarySkills).map(String)
  const preferred = inferPreferredSkills(jd, required)

  const llmEvaluation = skipLlm
    ? null
    : await evaluateAtsSemanticSubscores({
        resumeText: resume,
        jobDescription: jd,
        roleTitle: roleTitle || '',
      })

  const hybrid = computeFinalAtsScore({
    rawResumeText: resume,
    parsedResume,
    jobDescription: { requiredSkills: required, preferredSkills: preferred, title: roleTitle },
    llmEvaluation: llmEvaluation || undefined,
    usedOcrFallback,
  })

  const strengths = []
  if (hybrid.matchedKeywords.length >= 3) {
    strengths.push(`Strong keyword overlap: ${hybrid.matchedKeywords.slice(0, 5).join(', ')}`)
  }
  if (hybrid.breakdown.parseabilityAndImpact >= 70) {
    strengths.push('Resume is ATS-parseable with measurable impact signals.')
  }

  const gaps = [
    ...hybrid.missingKeywords.slice(0, 6).map((s) => `Missing required skill: ${s}`),
    ...hybrid.improvementTips.slice(0, 4),
  ]

  return {
    atsScore: hybrid.overallScore,
    jdMatchScore: hybrid.jdMatchScore,
    resumeSkillCoverage: hybrid.resumeSkillCoverage,
    primarySkills: baseline.primarySkills,
    matchedSkills: hybrid.matchedSkills,
    missingSkills: hybrid.missingSkills,
    strengths: strengths.slice(0, 8),
    gaps: gaps.slice(0, 8),
    summary: hybrid.summary || '',
    confidence: llmEvaluation ? 'high' : 'medium',
    aiEnhanced: Boolean(llmEvaluation),
    atsBreakdown: hybrid.breakdown,
    improvementTips: hybrid.improvementTips,
    niceToHaveMissing: hybrid.niceToHaveMissing,
  }
}

/** @param {Record<string, unknown>} appData */
export function vendorReportNeedsRefresh(appData, force = false) {
  if (force) return true
  const ir = /** @type {any} */ (appData?.interviewResult)
  const vr = /** @type {any} */ (appData?.vendorReport)
  if (!ir?.answers?.length) return !vr
  if (!vr) return true
  const iTime = new Date(ir.date || appData?.evaluatedAt || 0).getTime()
  const rTime = new Date(vr.generatedAt || 0).getTime()
  if (Number.isFinite(iTime) && Number.isFinite(rTime) && iTime > rTime) return true
  if (vr.interviewOverall != null && ir.overall != null && vr.interviewOverall !== ir.overall) return true
  if (vr.interviewAnswerCount !== ir.answers.length) return true
  if (!Array.isArray(vr.interviewHighlights) || vr.interviewHighlights.length === 0) return true
  return false
}

function buildInterviewGroundedVendorReport({
  candidateName,
  jobTitle,
  company,
  atsEvaluation,
  interviewResult,
}) {
  const answers = Array.isArray(interviewResult?.answers) ? interviewResult.answers : []
  const overall = typeof interviewResult?.overall === 'number' ? interviewResult.overall : null
  const ats = atsEvaluation?.atsScore ?? null
  const compositeScore =
    overall != null && ats != null
      ? Math.round(overall * 0.55 + ats * 0.45)
      : overall ?? ats ?? null

  const interviewHighlights = answers.slice(0, 8).map((a, i) => {
    const q = String(a.question || `Question ${i + 1}`).slice(0, 140)
    const ans = String(a.answer || '').trim().slice(0, 220)
    const score = typeof a.score === 'number' ? a.score : null
    const fb = String(a.feedback || '').trim()
    const scoreBit = score != null ? `Score ${score}/100. ` : ''
    return `${scoreBit}Q: ${q} A: ${ans || '(no answer)'}${fb ? ` — ${fb.slice(0, 120)}` : ''}`
  })

  const categoryNarratives = (interviewResult?.categories || []).map((c) => ({
    label: c.label,
    score: c.score,
    narrative: `From this interview, ${c.label} averaged ${c.score}/100 across the questions in that area.`,
  }))

  const strengths = (interviewResult?.strengths || []).slice(0, 4)
  const improvements = (interviewResult?.improvements || []).slice(0, 4)
  const risksAndGaps = [
    ...improvements.map((x) => `Interview: ${x}`),
    ...(atsEvaluation?.gaps || []).slice(0, 3).map((x) => `Resume/JD: ${x}`),
  ].slice(0, 8)

  let recommendation = 'hold — complete interview or gather more evidence'
  if (overall != null) {
    if (overall >= 72 && (ats == null || ats >= 60)) recommendation = 'hire — strong interview with acceptable JD fit'
    else if (overall >= 58) recommendation = 'hold — mixed interview; review Q&A below'
    else recommendation = 'reject — interview answers below bar for this role'
  }

  const executiveSummary =
    answers.length > 0
      ? `${candidateName} finished a ${answers.length}-question interview for ${jobTitle} at ${company}. Interview score ${overall ?? '—'}/100${
          ats != null ? `; resume/JD match ${ats}/100` : ''
        }. Highlights and per-question notes below come from what they said in this session.`
      : `${candidateName} has not completed an interview with saved Q&A for ${jobTitle} yet. ATS/resume data only.`

  const atsAnalysis =
    atsEvaluation?.summary ||
    (ats != null
      ? `Resume/JD match is ${ats}/100 (${atsEvaluation?.matchedSkills?.length || 0} skills matched).`
      : 'No ATS summary on file.')

  const skillAlignment = (atsEvaluation?.primarySkills || []).slice(0, 12).map((skill) => {
    const matched = (atsEvaluation?.matchedSkills || []).some(
      (m) => String(m).toLowerCase() === String(skill).toLowerCase(),
    )
    const missing = (atsEvaluation?.missingSkills || []).some(
      (m) => String(m).toLowerCase() === String(skill).toLowerCase(),
    )
    return {
      skill: String(skill),
      status: matched ? 'strong' : missing ? 'missing' : 'partial',
      evidence: matched
        ? 'Listed on resume and matched to JD'
        : missing
          ? 'Required in JD; not clearly on resume'
          : 'Partial overlap',
    }
  })

  return {
    compositeScore,
    executiveSummary,
    atsAnalysis,
    skillAlignment,
    interviewHighlights,
    categoryNarratives,
    risksAndGaps,
    recommendation,
    confidence: answers.length >= 4 ? 'high' : answers.length ? 'medium' : 'low',
    interviewAnswerCount: answers.length,
    interviewOverall: overall,
    resumeFitScore: interviewResult?.resumeFitScore ?? null,
  }
}

/**
 * Final vendor sheet — grounded in this interview's Q&A, optional LLM narrative on top.
 */
export async function generateVendorAssessmentSheet({
  candidateName,
  jobTitle,
  company,
  jobDescription,
  resumeText,
  atsEvaluation,
  interviewResult,
}) {
  const generatedAt = new Date().toISOString()
  const grounded = buildInterviewGroundedVendorReport({
    candidateName,
    jobTitle,
    company,
    atsEvaluation,
    interviewResult,
  })

  const template = {
    generatedAt,
    candidateName,
    jobTitle,
    company,
    atsScore: atsEvaluation?.atsScore ?? null,
    jdMatchScore: atsEvaluation?.jdMatchScore ?? null,
    interviewOverall: grounded.interviewOverall,
    resumeFitScore: grounded.resumeFitScore,
    compositeScore: grounded.compositeScore,
    executiveSummary: grounded.executiveSummary,
    atsAnalysis: grounded.atsAnalysis,
    skillAlignment: grounded.skillAlignment,
    interviewHighlights: grounded.interviewHighlights,
    categoryNarratives: grounded.categoryNarratives,
    risksAndGaps: grounded.risksAndGaps,
    recommendation: grounded.recommendation,
    confidence: grounded.confidence,
    interviewAnswerCount: grounded.interviewAnswerCount,
    aiGenerated: Boolean(interviewResult?.answers?.length),
  }

  if (!interviewResult?.answers?.length) {
    return template
  }

  const llm = await callLlmApi({
    tier: 'quality',
    temperature: 0.2,
    maxTokens: 2200,
    system: `You are HireRight's recruiter report writer. Fill the assessment sheet template with specific, evidence-based content.
Return ONLY JSON matching:
{
  "compositeScore": 0-100,
  "executiveSummary": "paragraph",
  "atsAnalysis": "paragraph on JD/resume fit",
  "skillAlignment": [{"skill":"", "status":"strong|partial|missing", "evidence":""}],
  "interviewHighlights": ["bullet"],
  "categoryNarratives": [{"label":"Technical|Communication|...", "score":0-100, "narrative":""}],
  "risksAndGaps": ["bullet"],
  "recommendation": "hire|hold|reject with reason",
  "confidence": "high|medium|low"
}
Use ONLY the interview Q&A provided (each question and answer). No generic filler. Every bullet must quote or paraphrase their actual answers.`,
    user: JSON.stringify({
      candidateName,
      jobTitle,
      company,
      jobDescription: String(jobDescription || '').slice(0, 6000),
      resumeExcerpt: String(resumeText || '').slice(0, 6000),
      atsEvaluation,
      interview: {
        overall: interviewResult?.overall,
        resumeFitScore: interviewResult?.resumeFitScore,
        categories: interviewResult?.categories,
        strengths: interviewResult?.strengths,
        improvements: interviewResult?.improvements,
        feedback: interviewResult?.feedback,
        answers: (interviewResult?.answers || []).slice(0, 12).map((a) => ({
          question: a.question,
          answer: a.answer,
          score: a.score,
        })),
      },
    }),
  })

  if (!llm?.text) return template

  const parsed = parseJsonBlock(llm.text)
  if (!parsed) return template

  const clamp = (n) => Math.min(100, Math.max(0, Math.round(Number(n) || 0)))
  return {
    ...template,
    compositeScore:
      typeof parsed.compositeScore === 'number' ? clamp(parsed.compositeScore) : template.compositeScore,
    executiveSummary: String(parsed.executiveSummary || template.executiveSummary),
    atsAnalysis: String(parsed.atsAnalysis || template.atsAnalysis),
    skillAlignment: Array.isArray(parsed.skillAlignment) && parsed.skillAlignment.length
      ? parsed.skillAlignment.slice(0, 20)
      : template.skillAlignment,
    interviewHighlights:
      Array.isArray(parsed.interviewHighlights) && parsed.interviewHighlights.length
        ? parsed.interviewHighlights.map(String).slice(0, 10)
        : template.interviewHighlights,
    categoryNarratives:
      Array.isArray(parsed.categoryNarratives) && parsed.categoryNarratives.length
        ? parsed.categoryNarratives.slice(0, 8)
        : template.categoryNarratives,
    risksAndGaps:
      Array.isArray(parsed.risksAndGaps) && parsed.risksAndGaps.length
        ? parsed.risksAndGaps.map(String).slice(0, 10)
        : template.risksAndGaps,
    recommendation: String(parsed.recommendation || template.recommendation),
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
      ? parsed.confidence
      : template.confidence,
    aiGenerated: true,
  }
}

export { extractPrimarySkillsFromJd }
