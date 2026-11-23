import type { FaceObservation, FaceTrackStatus } from './faceTracker'
import type { IntegrityLogEvent } from './store'

type EventType = IntegrityLogEvent['eventType']
type Pending = { type: EventType; start: number; message: string; event?: IntegrityLogEvent }

/** Same cap the server keeps per session: past it, new intervals are no longer recorded. */
export const MAX_REVIEW_EVENTS = 1000

/** Head movement: total head rotation (yaw + pitch, degrees) within this window ... */
const MOVEMENT_WINDOW_SEC = 3
/** ... at or above this is "moving a lot" (≈30°/s sustained; nodding while talking stays well below). */
const MOVEMENT_PATH_DEG = 90

const THRESHOLD_SEC: Partial<Record<EventType, number>> = {
  SIDE_GAZE_LOOKING_AWAY: 4,
  UNABLE_TO_ASSESS: 2,
  EXCESSIVE_MOVEMENT: 2,
  PHONE_DETECTED: 1.5,
}

function clock(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}

/**
 * Turns per-frame camera status into review intervals. Offsets (`startOffsetSec`) are elapsed seconds since the
 * interview recording started, so each interval lines up with the stored video. Durations are elapsed video time,
 * never question-number estimates.
 */
export class ReviewEventTracker {
  /** Face-status channel (no face / multiple faces / looking away / cannot assess). */
  private pending: Pending | null = null
  private movement: Pending | null = null
  private phone: Pending | null = null
  private poses: { t: number; yaw: number; pitch: number }[] = []
  events: IntegrityLogEvent[] = []

  sample(status: FaceTrackStatus, elapsed: number, now = Date.now(), observation?: FaceObservation | null) {
    const type: EventType | null = status.issue === 'ok' ? null
      : status.issue === 'no_face' ? 'NO_FACE_SEEN'
      : status.issue === 'multi_person' ? 'MULTIPLE_FACES_DETECTED'
      : status.issue === 'looking_away' ? 'SIDE_GAZE_LOOKING_AWAY' : 'UNABLE_TO_ASSESS'
    this.pending = this.track(this.pending, type, status.label, elapsed, now)

    const moving = observation ? this.headMoving(observation, elapsed) : false
    this.movement = this.track(
      this.movement,
      moving ? 'EXCESSIVE_MOVEMENT' : null,
      'Frequent head movement',
      elapsed,
      now,
    )
    this.phone = this.track(
      this.phone,
      observation?.phoneDetected ? 'PHONE_DETECTED' : null,
      'A phone was visible on camera',
      elapsed,
      now,
    )
  }

  finish(elapsed: number) {
    for (const p of [this.pending, this.movement, this.phone]) {
      if (p?.event) p.event.durationSec = Math.max(0, elapsed - p.start)
    }
    this.pending = null
    this.movement = null
    this.phone = null
    this.poses = []
  }

  /** One continuous channel: open an interval when `type` appears, record it once it lasts long enough. */
  private track(p: Pending | null, type: EventType | null, message: string, elapsed: number, now: number) {
    if (p?.type !== type) {
      if (p?.event) p.event.durationSec = Math.max(0, elapsed - p.start)
      p = type ? { type, start: elapsed, message } : null
    }
    if (!p) return null
    const duration = Math.max(0, elapsed - p.start)
    const threshold = THRESHOLD_SEC[p.type] ?? 3
    if (!p.event && duration >= threshold && this.events.length < MAX_REVIEW_EVENTS) {
      p.event = {
        id: crypto.randomUUID(), eventType: p.type, severity: 'warn', message: p.message,
        timestamp: new Date(now - duration * 1000).toISOString(),
        formattedTime: clock(p.start),
        startOffsetSec: p.start, durationSec: duration, reviewOnly: true,
      }
      this.events.push(p.event)
    }
    if (p.event) p.event.durationSec = duration
    return p
  }

  /** True while the head has rotated a lot within the last few seconds (looking around, turning repeatedly). */
  private headMoving(o: FaceObservation, elapsed: number): boolean {
    if (o.faceCount !== 1 || !Number.isFinite(o.yawDeg) || !Number.isFinite(o.pitchDeg)) {
      this.poses = []
      return false
    }
    this.poses.push({ t: elapsed, yaw: o.yawDeg, pitch: o.pitchDeg })
    while (this.poses.length && elapsed - this.poses[0].t > MOVEMENT_WINDOW_SEC) this.poses.shift()
    if (this.poses.length < 3) return false
    let path = 0
    for (let i = 1; i < this.poses.length; i++) {
      path += Math.abs(this.poses[i].yaw - this.poses[i - 1].yaw) + Math.abs(this.poses[i].pitch - this.poses[i - 1].pitch)
    }
    return path >= MOVEMENT_PATH_DEG
  }
}
