import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import type { IntegrityLogEvent } from '../lib/store'

export function CandidateReviewEvents({ sessionId }: { sessionId?: string }) {
  const [events, setEvents] = useState<IntegrityLogEvent[]>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    setEvents([])
    if (sessionId) void apiFetch(`/api/interview/review-events?sessionId=${encodeURIComponent(sessionId)}`)
      .then(async r => { if (!r.ok) throw new Error('Could not load camera review events.'); return r.json() })
      .then(data => { if (active) setEvents(data.events || []) })
      .catch(e => { if (active) setMessage(e.message) })
    return () => { active = false }
  }, [sessionId])
  if (!sessionId) return null
  async function save(event: IntegrityLogEvent) {
    setSaving(true)
    try {
      const r = await apiFetch('/api/interview/review-events', { method: 'PATCH', body: JSON.stringify({ sessionId, eventId: event.id, explanation: event.candidateExplanation || '' }) })
      if (!r.ok) throw new Error('Could not save your explanation. Please retry.')
      setMessage('Explanation saved for your vendor reviewer.')
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Save failed.') }
    finally { setSaving(false) }
  }
  return <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24, marginTop: 24 }}>
    <h2>Camera review and your explanations</h2>
    <p>These observations do not affect your interview score. Your vendor can review them and consider your explanation. Recordings are only available to authorized vendor reviewers.</p>
    {message && <p role="status">{message}</p>}
    {!events.length && <p>No camera review events to explain.</p>}
    {events.map(event => <div key={event.id} style={{ marginTop: 16 }}>
      <strong>{event.eventType.replaceAll('_', ' ')} · {event.formattedTime} · {event.durationSec?.toFixed(1)} seconds</strong>
      <p>{event.message}</p>
      <label>Your explanation<textarea maxLength={2000} rows={3} style={{ display: 'block', width: '100%' }} value={event.candidateExplanation || ''}
        onChange={e => setEvents(items => items.map(item => item.id === event.id ? { ...item, candidateExplanation: e.target.value } : item))} /></label>
      <button type="button" disabled={saving} onClick={() => void save(event)}>Save explanation</button>
    </div>)}
  </section>
}
