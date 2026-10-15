import { computeAtsScore, extractPrimarySkillsFromJd } from './atsScore.mjs'
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

/**
 * Strong ATS: heuristic baseline + optional LLM refinement (same provider as interviews).
 */
export async function evaluateResumeAgainstJd({ resumeText, jobDescription, requiredSkills, roleTitle }) {
  const baseline = computeAtsScore({ resumeText, jobDescription, requiredSkills })
  const llm = await callLlmApi({
    tier: 'quality',
    temperature: 0.15,
    maxTokens: 1200,
    system: `You are HireRight's vendor ATS engine. Score resume fit to the job description.
Return ONLY valid JSON:
{
  "atsScore": 0-100,
  "jdMatchScore": 0-100,
  "resumeSkillCoverage": 0-100,
  "primarySkills": ["..."],
  "matchedSkills": ["..."],
  "missingSkills": ["..."],
  "strengths": ["..."],
  "gaps": ["..."],
  "summary": "2-3 sentences for recruiters",
  "confidence": "high"|"medium"|"low"
}
Rules: Never invent resume facts. Penalize missing must-have skills. Reward evidenced experience.`,
    user: JSON.stringify({
      roleTitle: roleTitle || '',
      jobDescription: String(jobDescription || '').slice(0, 8000),
      requiredSkills: requiredSkills || [],
      resumeText: String(resumeText || '').slice(0, 12000),
      baseline,
    }),
  })

  if (!llm?.text) {
    return { ...baseline, aiEnhanced: false, strengths: [], gaps: [], summary: '', confidence: 'medium' }
  }

  const parsed = parseJsonBlock(llm.text)
  if (!parsed || typeof parsed.atsScore !== 'number') {
    return { ...baseline, aiEnhanced: false, strengths: [], gaps: [], summary: '', confidence: 'medium' }
  }

  const clamp = (n) => Math.min(100, Math.max(0, Math.round(Number(n) || 0)))
  return {
    atsScore: clamp(parsed.atsScore),
    jdMatchScore: clamp(parsed.jdMatchScore ?? baseline.jdMatchScore),
    resumeSkillCoverage: clamp(parsed.resumeSkillCoverage ?? baseline.resumeSkillCoverage),
    primarySkills: Array.isArray(parsed.primarySkills) ? parsed.primarySkills.map(String) : baseline.primarySkills,
    matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills.map(String) : baseline.matchedSkills,
    missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills.map(String) : baseline.missingSkills,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 8) : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String).slice(0, 8) : [],
    summary: String(parsed.summary || '').slice(0, 2000),
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
    aiEnhanced: true,
  }
}

/**
 * Final vendor sheet — same section template, all narrative/scores from AI + evidence.
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
  const template = {
    generatedAt: new Date().toISOString(),
    candidateName,
    jobTitle,
    company,
    atsScore: atsEvaluation?.atsScore ?? null,
    jdMatchScore: atsEvaluation?.jdMatchScore ?? null,
    interviewOverall: interviewResult?.overall ?? null,
    resumeFitScore: interviewResult?.resumeFitScore ?? null,
    compositeScore: null,
    executiveSummary: '',
    atsAnalysis: '',
    skillAlignment: [],
    interviewHighlights: [],
    categoryNarratives: [],
    risksAndGaps: [],
    recommendation: '',
    confidence: 'medium',
    aiGenerated: false,
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
Use interview Q&A and ATS data. No generic filler like "High Match Candidate". Every sentence must cite evidence.`,
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
    compositeScore: clamp(parsed.compositeScore),
    executiveSummary: String(parsed.executiveSummary || ''),
    atsAnalysis: String(parsed.atsAnalysis || ''),
    skillAlignment: Array.isArray(parsed.skillAlignment) ? parsed.skillAlignment.slice(0, 20) : [],
    interviewHighlights: Array.isArray(parsed.interviewHighlights)
      ? parsed.interviewHighlights.map(String).slice(0, 10)
      : [],
    categoryNarratives: Array.isArray(parsed.categoryNarratives)
      ? parsed.categoryNarratives.slice(0, 8)
      : [],
    risksAndGaps: Array.isArray(parsed.risksAndGaps) ? parsed.risksAndGaps.map(String).slice(0, 10) : [],
    recommendation: String(parsed.recommendation || ''),
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
    aiGenerated: true,
  }
}

export { extractPrimarySkillsFromJd }
