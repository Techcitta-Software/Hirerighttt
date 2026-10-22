import { apiFetch } from './api'
export { ReviewEventTracker } from './reviewEventTracker'
import type { IntegrityLogEvent } from './store'

export async function saveReviewEvents(sessionId: string, events: IntegrityLogEvent[]) {
  const response = await apiFetch('/api/interview/review-events', {
    method: 'POST', body: JSON.stringify({ sessionId, events }),
  })
  if (!response.ok) throw new Error('Camera review events have not synced. Please retry.')
}
