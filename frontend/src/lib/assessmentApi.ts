import { apiFetch } from './api'

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

export type AssessmentCompetency = {
  id: string
  name: string
  requirement: string
  weight: number
}

export type AssessmentJob = {
  id: string
  title: string
  description: string
  experience_level: string
  competencies?: AssessmentCompetency[]
  organization_id?: string
  organization_name?: string
  created_at?: string
}

export type AssessmentSessionView = {
  session_id: string
  status: string
  version: number
  current_question_index: number
  current_question?: { question_id: string; question_text: string; competency?: string } | null
  remaining_questions: number
  total_questions: number
  plan_status?: string
  awaiting_recruiter_approval?: boolean
  response?: string
  intent?: string
  source?: string
  used_llm?: boolean
}

const DEFAULT_COMPETENCIES: AssessmentCompetency[] = [
  { id: 'ownership', name: 'Project ownership', requirement: 'Own delivery and outcomes on relevant work.', weight: 15 },
  { id: 'core_knowledge', name: 'Core technical knowledge', requirement: 'Demonstrate role fundamentals.', weight: 15 },
  { id: 'practical_application', name: 'Practical application', requirement: 'Apply skills to realistic tasks.', weight: 15 },
  { id: 'problem_solving', name: 'Problem solving', requirement: 'Structured reasoning under constraints.', weight: 15 },
  { id: 'troubleshooting', name: 'Troubleshooting', requirement: 'Debug and improve reliability.', weight: 15 },
  { id: 'specialization', name: 'Role specialization', requirement: 'Domain depth for the target role.', weight: 15 },
  { id: 'deeper_reasoning', name: 'Deeper reasoning', requirement: 'Trade-offs, design, or behavioral depth.', weight: 10 },
]

export function defaultCompetencies() {
  return DEFAULT_COMPETENCIES.map((c) => ({ ...c }))
}

export async function fetchAssessmentJobs(organizationId?: string) {
  const qs = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : ''
  const res = await apiFetch(`/api/assessments/jobs${qs}`)
  return parse<{ jobs: AssessmentJob[] }>(res)
}

export async function createAssessmentJob(payload: {
  organization_id: string
  title: string
  description: string
  experience_level: string
  competencies: AssessmentCompetency[]
}) {
  const res = await apiFetch('/api/assessments/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return parse<{ job: AssessmentJob }>(res)
}

export async function listAssessmentInterviews(organizationId: string) {
  const res = await apiFetch(
    `/api/assessments?organization_id=${encodeURIComponent(organizationId)}&limit=50`,
  )
  return parse<{ interviews: { id: string; candidate_id: string; status: string; created_at: string; completed_at?: string }[] }>(res)
}

export async function uploadAssessmentResume(filename: string, fileBase64: string) {
  const res = await apiFetch('/api/assessments/resumes', {
    method: 'POST',
    body: JSON.stringify({ filename, file_base64: fileBase64 }),
  })
  return parse<{ resume_id: string; extracted_text: string; notice?: string }>(res)
}

export async function generateAssessment(payload: { job_id: string; resume_id: string; consent: true }) {
  const res = await apiFetch('/api/assessments/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return parse<AssessmentSessionView & { plan_id: string }>(res)
}

export async function getAssessmentSession(sessionId: string) {
  const res = await apiFetch(`/api/assessments/${sessionId}`)
  return parse<AssessmentSessionView & { answers?: unknown[]; plan_status?: string }>(res)
}

export async function startAssessmentSession(sessionId: string, version: number) {
  const res = await apiFetch(`/api/assessments/${sessionId}/start`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
  return parse<AssessmentSessionView>(res)
}

function unwrapSessionView(data: AssessmentSessionView & Record<string, unknown>): AssessmentSessionView & Record<string, unknown> {
  const nested = data.response
  if (nested && typeof nested === 'object' && 'session_id' in nested) {
    const { response: _drop, ...rest } = data
    return { ...(nested as AssessmentSessionView), ...rest }
  }
  return data
}

export async function submitAssessmentAnswer(
  sessionId: string,
  payload: { message: string; question_id: string; version: number; request_id: string },
) {
  const res = await apiFetch(`/api/assessments/${sessionId}/answers`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const data = await parse<AssessmentSessionView & { evaluation_status?: string; response?: AssessmentSessionView }>(res)
  return unwrapSessionView(data)
}

export async function repeatAssessmentQuestion(sessionId: string) {
  const res = await apiFetch(`/api/assessments/${sessionId}/repeat-question`, { method: 'POST', body: '{}' })
  const data = await parse<AssessmentSessionView & { response?: string | AssessmentSessionView }>(res)
  const view = unwrapSessionView(data as AssessmentSessionView & { response?: AssessmentSessionView })
  const spoken = typeof data.response === 'string' ? data.response : view.response
  return { ...view, response: spoken }
}

export async function fetchAssessmentPlan(sessionId: string) {
  const res = await apiFetch(`/api/assessments/${sessionId}/plan`)
  return parse<{ plan: { status: string }; questions: unknown[]; job: AssessmentJob }>(res)
}

export async function approveAssessmentPlan(sessionId: string, version: number) {
  const res = await apiFetch(`/api/assessments/${sessionId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
  return parse<AssessmentSessionView>(res)
}

export async function fetchAssessmentReport(sessionId: string) {
  const res = await apiFetch(`/api/assessments/${sessionId}/report`)
  return parse<Record<string, unknown>>(res)
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}
