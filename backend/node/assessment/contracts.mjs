export class AssessmentError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
export function check(condition, message, status = 400) {
  if (!condition) throw new AssessmentError(status, message)
}
export function text(value, name, max = 2000) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Invalid ${name}`)
  return value.trim()
}
export function strings(value, name, max = 20) {
  check(Array.isArray(value) && value.length <= max, `Invalid ${name}`)
  return value.map(v => text(v, name))
}
export const VERSION = 'structured-assessment-v1'
export const BLUEPRINT = [
  'ownership', 'core_knowledge', 'practical_application', 'problem_solving',
  'troubleshooting', 'specialization', 'deeper_reasoning',
]
export function validateCompetencies(value) {
  check(Array.isArray(value) && value.length === 7, 'Exactly seven competencies required')
  const result = value.map(c => {
    check(c && typeof c === 'object' && !Array.isArray(c), 'Invalid competency')
    return {
      id: text(c.id, 'competency id', 80), name: text(c.name, 'competency name', 200),
      requirement: text(c.requirement, 'job requirement', 2000), weight: c.weight,
    }
  })
  check(new Set(result.map(c => c.id)).size === 7, 'Competency IDs must be unique')
  check(result.every(c => Number.isFinite(c.weight) && c.weight > 0 && c.weight <= 100), 'Invalid competency weights')
  check(Math.abs(result.reduce((n, c) => n + c.weight, 0) - 100) < 0.000001, 'Weights must total 100')
  return result
}
export function validatePlan(value, job, resumeText = '') {
  check(value && Array.isArray(value.questions) && value.questions.length === 7, 'Exactly seven questions required')
  const questions = value.questions.map((q, index) => {
    check(q && typeof q === 'object', 'Invalid question')
    const competency = job.competencies.find(c => c.id === q.competency)
    check(competency, 'Unknown competency')
    check(['basic', 'intermediate', 'advanced'].includes(q.difficulty), 'Invalid difficulty')
    check(['experience', 'conceptual', 'scenario', 'practical', 'design', 'behavioral'].includes(q.question_type), 'Invalid question type')
    check(q.max_score === 4, 'Maximum score must be 4')
    check(q.scoring_rubric && typeof q.scoring_rubric === 'object', 'Rubric required')
    const rubric = Object.fromEntries([0, 1, 2, 3, 4].map(n => [n, text(q.scoring_rubric[n], 'rubric anchor')]))
    const evidence = text(q.resume_or_job_evidence, 'relevance evidence', 2000)
    check([resumeText, job.description, competency.requirement].some(source => source.includes(evidence)), 'Relevance evidence must quote the supplied resume or job requirement')
    const points = strings(q.expected_answer_points, 'expected answer points')
    check(points.length > 0, 'Expected answer points required')
    return {
      question_id: text(q.question_id, 'question id', 80),
      question_text: text(q.question_text, 'question text', 3000),
      competency: competency.id, difficulty: q.difficulty, question_type: q.question_type,
      selection_reason: text(q.selection_reason, 'selection reason'), resume_or_job_evidence: evidence,
      expected_answer_points: points, scoring_rubric: rubric,
      suggested_follow_up: text(q.suggested_follow_up, 'follow-up', 1500),
      max_score: 4, time_guidance: typeof q.time_guidance === 'string' ? q.time_guidance.slice(0, 200) : null,
      position: index,
    }
  })
  check(new Set(questions.map(q => q.question_id)).size === 7, 'Duplicate question IDs')
  check(new Set(questions.map(q => q.question_text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim())).size === 7, 'Duplicate questions')
  check(new Set(questions.map(q => q.competency)).size === 7, 'Each competency must be covered once')
  return { questions, rubric_version: VERSION }
}
export function validateEvaluation(value, answer) {
  check(value && Number.isInteger(value.score) && value.score >= 0 && value.score <= 4, 'Invalid evaluation score')
  const evidence = strings(value.evidence, 'evidence')
  check(evidence.every(quote => answer.includes(quote)), 'Evaluation evidence must quote the answer exactly')
  check(value.score === 0 || evidence.length > 0, 'Positive scores require answer evidence')
  check(Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1, 'Invalid confidence')
  check(typeof value.needs_human_review === 'boolean', 'Review flag required')
  return {
    score: value.score, evidence, strengths: strings(value.strengths, 'strengths'), gaps: strings(value.gaps, 'gaps'),
    reasoning: text(value.reasoning, 'reasoning', 4000), confidence: value.confidence,
    needs_human_review: value.needs_human_review || value.confidence < 0.7,
    review_reason: value.needs_human_review ? text(value.review_reason, 'review reason') : value.confidence < 0.7 ? 'Low assessment confidence' : '',
  }
}
export function publicQuestion(q) {
  if (!q) return null
  return { question_id: q.question_id, question_text: q.question_text, competency: q.competency, difficulty: q.difficulty, question_type: q.question_type, time_guidance: q.time_guidance }
}
export function validateResumeAnalysis(value, source) {
  check(value && Array.isArray(value.claims) && value.claims.length <= 100, 'Invalid resume claims')
  const claims = value.claims.map(claim => {
    check(['skill', 'experience', 'project', 'education', 'certification', 'achievement', 'tool'].includes(claim.type), 'Invalid resume claim type')
    const evidence = text(claim.evidence, 'resume evidence', 2000)
    check(source.includes(evidence), 'Resume evidence must quote the source')
    return { type: claim.type, value: text(claim.value, 'resume claim', 1000), evidence, uncertain: claim.uncertain !== false }
  })
  return { claims, uncertainties: strings(value.uncertainties, 'extraction uncertainties'), requires_candidate_review: true }
}
export function aggregate(job, questions, answers, evaluations, reviews = []) {
  validateCompetencies(job.competencies)
  const scores = questions.map(q => {
    const answer = answers.find(a => a.question_id === q.question_id)
    const evaluation = answer && evaluations.find(e => e.answer_id === answer.id)
    const review = evaluation && reviews.filter(r => r.evaluation_id === evaluation.id).at(-1)
    const score = review ? review.score : evaluation?.data.score ?? null
    const weight = job.competencies.find(c => c.id === q.competency).weight
    return { competency: q.competency, question_id: q.question_id, weight, score, contribution: score === null ? null : score / 4 * weight, needs_human_review: !evaluation || (!review && evaluation.data.needs_human_review) }
  })
  const complete = scores.every(s => s.score !== null)
  return { competencies: scores, overall: complete ? Math.round(scores.reduce((n, s) => n + s.contribution, 0) * 100) / 100 : null, evaluated_weight: scores.filter(s => s.score !== null).reduce((n, s) => n + s.weight, 0), needs_human_review: scores.some(s => s.needs_human_review), notice: 'AI-generated assessment for human review; not a hiring decision. Missing evidence is not proof of incompetence.' }
}
