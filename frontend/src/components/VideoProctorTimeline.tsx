import { useEffect, useRef, useState } from 'react'
import type { IntegrityLogEvent } from '../lib/store'
import { apiFetch } from '../lib/api'
import styles from './VideoProctorTimeline.module.css'

type Props = { sessionId?: string; videoUrl?: string | null; logs?: IntegrityLogEvent[]; durationSec?: number }
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function VideoProctorTimeline({ sessionId, logs = [], durationSec = 0 }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const clipEnd = useRef<number | null>(null)
  const [events, setEvents] = useState(logs)
  const [source, setSource] = useState<string | null>(null)
  const [message, setMessage] = useState('No recording available for this interview.')
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(durationSec)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setSource(null); setEvents(logs); setTime(0); setDuration(durationSec)
    if (sessionId) {
      setMessage('Loading authorized vendor review…')
      void apiFetch(`/api/vendor/interview-review?sessionId=${encodeURIComponent(sessionId)}`)
        .then(async r => { if (!r.ok) throw new Error('Video review is restricted to authorized vendor reviewers.'); return r.json() })
        .then(data => { if (active) { setEvents(data.events || []); setSource(data.videoUrl); setMessage(data.recordingStatus) } })
        .catch(e => { if (active) setMessage(e.message) })
    }
    return () => { active = false }
  }, [sessionId, retry]) // Caller logs are only a legacy fallback; live review comes from the authorized API.
  const end = Math.max(duration, ...events.map(e => (e.startOffsetSec || 0) + (e.durationSec || 0)), 1)
  function seek(sec: number, stop: number | null = null) {
    if (!video.current || !source) return
    clipEnd.current = stop
    video.current.currentTime = Math.max(0, sec)
    void video.current.play().catch(() => setMessage('Press Play to review this event.'))
  }
  return <section className={styles.container} aria-label="Interview video review">
    <h3>Interview recording and review events</h3>
    <p>Red markers need human review; gray markers mean unable to assess. These are observations, not findings of cheating, and do not affect interview scores. Consider the candidate’s explanation.</p>
    {source ? <video ref={video} src={source} controls controlsList="nodownload" className={styles.video} onError={() => setMessage('Playback unavailable or expired. Reload recording to retry.')}
      onLoadedMetadata={() => { const d = video.current?.duration; if (d && Number.isFinite(d)) setDuration(d) }}
      onTimeUpdate={() => { if (video.current) { setTime(video.current.currentTime); if (clipEnd.current !== null && video.current.currentTime >= clipEnd.current) { video.current.pause(); clipEnd.current = null } } }} />
      : <p role="status">{message}</p>}
    {source && <p role="status">{message}</p>}
    {sessionId && <button type="button" onClick={() => setRetry(n => n + 1)}>Reload recording</button>}
    <div style={{ marginTop: 18 }}>
      <label>Playback position {clock(time)} / {clock(end)}<input aria-label="Playback position" type="range" min="0" max={end} step="0.1" value={Math.min(time, end)} disabled={!source} style={{ width: '100%' }} onChange={e => seek(Number(e.target.value))} /></label>
      <div style={{ position: 'relative', height: 24, background: '#e2e8f0', borderRadius: 5 }}>
        {events.filter(e => Number.isFinite(e.startOffsetSec)).map(e => <button key={e.id} type="button" disabled={!source}
          aria-label={`${e.eventType.replaceAll('_', ' ')} at ${clock(e.startOffsetSec!)} for ${(e.durationSec || 0).toFixed(1)} seconds`}
          title={`${e.message} · ${clock(e.startOffsetSec!)}`} onClick={() => seek(Math.max(0, e.startOffsetSec! - 2), e.startOffsetSec! + (e.durationSec || 0) + 2)}
          style={{ position: 'absolute', top: 3, left: `${Math.min(99, e.startOffsetSec! / end * 100)}%`, width: `${Math.max(.6, (e.durationSec || 0) / end * 100)}%`, minWidth: 6, height: 18, border: 0, borderRadius: 3, background: e.eventType === 'UNABLE_TO_ASSESS' ? '#64748b' : '#dc2626', cursor: source ? 'pointer' : 'default' }} />)}
      </div>
    </div>
    {events.length ? <ol>{events.map(e => <li key={e.id} style={{ marginTop: 12 }}>
      <strong>{e.eventType.replaceAll('_', ' ')}</strong> · {Number.isFinite(e.startOffsetSec) ? clock(e.startOffsetSec!) : 'Timestamp unavailable'} · {e.durationSec?.toFixed(1) ?? 'Unknown'} seconds
      <p>{e.message} <time dateTime={e.timestamp}>{new Date(e.timestamp).toLocaleString()}</time></p>
      <p>Candidate explanation: {e.candidateExplanation || 'Not yet provided. Ask the candidate before reaching a conclusion.'}</p>
      <button type="button" disabled={!source || !Number.isFinite(e.startOffsetSec)} onClick={() => seek(Math.max(0, e.startOffsetSec! - 2), e.startOffsetSec! + (e.durationSec || 0) + 2)}>Review clip</button>
    </li>)}</ol> : <p>No review events recorded. This does not establish interview integrity.</p>}
  </section>
}
