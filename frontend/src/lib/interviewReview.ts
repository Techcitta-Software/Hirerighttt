import { apiFetch } from './api'
export { ReviewEventTracker } from './reviewEventTracker'
import { MAX_REVIEW_EVENTS } from './reviewEventTracker'
import type { IntegrityLogEvent } from './store'

export async function saveReviewEvents(sessionId: string, events: IntegrityLogEvent[]) {
  const response = await apiFetch('/api/interview/review-events', {
    // Periodic sync during the interview and a final sync after it: never raise the loading veil.
    method: 'POST', body: JSON.stringify({ sessionId, events: events.slice(0, MAX_REVIEW_EVENTS) }), background: true,
  })
  if (!response.ok) throw new Error('Camera review events have not synced. Please retry.')
}
