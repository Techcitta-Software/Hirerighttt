import type { FaceTrackStatus } from './faceTracker'
import type { IntegrityLogEvent } from './store'

/** Durations are elapsed video time, never question-number estimates. */
export class ReviewEventTracker {
  private pending: { type: IntegrityLogEvent['eventType']; start: number; message: string; event?: IntegrityLogEvent } | null = null
  events: IntegrityLogEvent[] = []
  sample(status: FaceTrackStatus, elapsed: number, now = Date.now()) {
    const type = status.issue === 'ok' ? null
      : status.issue === 'no_face' ? 'NO_FACE_SEEN'
      : status.issue === 'multi_person' ? 'MULTIPLE_FACES_DETECTED'
      : status.issue === 'looking_away' ? 'SIDE_GAZE_LOOKING_AWAY' : 'UNABLE_TO_ASSESS'
    if (this.pending?.type !== type) {
      this.finish(elapsed)
      this.pending = type ? { type, start: elapsed, message: status.label } : null
    }
    const p = this.pending
    if (!p) return
    const duration = Math.max(0, elapsed - p.start)
    const threshold = p.type === 'SIDE_GAZE_LOOKING_AWAY' ? 4 : p.type === 'UNABLE_TO_ASSESS' ? 2 : 3
    if (!p.event && duration >= threshold) {
      p.event = {
        id: crypto.randomUUID(), eventType: p.type, severity: 'warn', message: p.message,
        timestamp: new Date(now - duration * 1000).toISOString(),
        formattedTime: `${Math.floor(p.start / 60)}:${String(Math.floor(p.start % 60)).padStart(2, '0')}`,
        startOffsetSec: p.start, durationSec: duration, reviewOnly: true,
      }
      this.events.push(p.event)
    }
    if (p.event) p.event.durationSec = duration
  }
  finish(elapsed: number) {
    if (this.pending?.event) this.pending.event.durationSec = Math.max(0, elapsed - this.pending.start)
    this.pending = null
  }
}

