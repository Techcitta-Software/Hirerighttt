import { apiFetch } from './api'
import { getUser, type InterviewResult } from './store'
import type { InterviewStartResponse, JobLinkedInterviewMeta } from './interviewAgentClient'

function sessionKey(jobLink?: JobLinkedInterviewMeta) {
  return `hireright.activeInterview:${getUser()?.id || getUser()?.email}:${jobLink?.applicationId || 'practice'}`
}
export async function interviewRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Interview request failed (${response.status}). Please retry.`)
  return data as T
}
export async function beginPersonalizedInterview(body: Record<string, unknown>, link?: JobLinkedInterviewMeta): Promise<InterviewStartResponse> {
  const key = sessionKey(link)
  const saved = sessionStorage.getItem(key)
  if (saved) {
    const response = await apiFetch(`/api/interview/session/${encodeURIComponent(saved)}`)
    if (response.ok) return response.json()
    if (response.status !== 404) throw new Error('Could not recover your interview. Please retry or sign in again.')
    sessionStorage.removeItem(key)
  }
  let requestId = sessionStorage.getItem(`${key}:request`)
  if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem(`${key}:request`, requestId) }
  const result = await interviewRequest<InterviewStartResponse>('/api/interview/start', { ...body, requestId, consent: true })
  if (result.sessionId) sessionStorage.setItem(key, result.sessionId)
  return result
}
export function clearActiveInterview(link?: JobLinkedInterviewMeta) {
  const key = sessionKey(link)
  sessionStorage.removeItem(key)
  sessionStorage.removeItem(`${key}:request`)
}
export async function finishPersonalizedInterview(body: Record<string, unknown>): Promise<InterviewResult> {
  const result = await interviewRequest<{ interview: InterviewResult }>('/api/interview/score', body)
  return result.interview
}
