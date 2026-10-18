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

const DEFAULT_SUBSCORES = {
  semanticProjectScore: 70,
  experienceScore: 75,
  educationScore: 85,
  summary: '',
}

/**
 * LLM evaluates only contextual sub-scores (not the final ATS number).
 * @param {{ resumeText: string, jobDescription: string, roleTitle?: string, minYearsExp?: number }} input
 */
export async function evaluateAtsSemanticSubscores(input) {
  const resumeText = String(input.resumeText || '').slice(0, 12000)
  const jobDescription = String(input.jobDescription || '').slice(0, 8000)
  if (!resumeText.trim() || !jobDescription.trim()) {
    return { ...DEFAULT_SUBSCORES, summary: 'Insufficient resume or job description for semantic evaluation.' }
  }

  const llm = await callLlmApi({
    tier: 'fast',
    temperature: 0.15,
    maxTokens: 800,
    system: `You are a strict technical ATS evaluator. Compare the Candidate Resume against the Job Description.
Return ONLY valid JSON with these exact keys:
{
  "semanticProjectScore": <0-100 integer: Do work/project descriptions prove hands-on depth with required tech, not keyword stuffing?>,
  "experienceScore": <0-100 integer: Do years or project complexity match role seniority?>,
  "educationScore": <0-100 integer: Does degree/background fit role requirements?>,
  "summary": "<2-sentence recruiter summary of strongest fit and biggest gap>"
}
Never invent resume facts. Penalize gaps honestly.`,
    user: JSON.stringify({
      roleTitle: input.roleTitle || '',
      minYearsExp: input.minYearsExp ?? null,
      jobDescription,
      resumeText,
    }),
  })

  if (!llm?.text) return { ...DEFAULT_SUBSCORES }

  const parsed = parseJsonBlock(llm.text)
  if (!parsed) return { ...DEFAULT_SUBSCORES }

  const clamp = (n, fallback) =>
    Math.min(100, Math.max(0, Math.round(Number(n) || fallback)))

  return {
    semanticProjectScore: clamp(parsed.semanticProjectScore, DEFAULT_SUBSCORES.semanticProjectScore),
    experienceScore: clamp(parsed.experienceScore, DEFAULT_SUBSCORES.experienceScore),
    educationScore: clamp(parsed.educationScore, DEFAULT_SUBSCORES.educationScore),
    summary: String(parsed.summary || '').slice(0, 2000),
  }
}
