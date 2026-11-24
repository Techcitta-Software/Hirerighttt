import type { FaceObservation, FaceTrackStatus } from './faceTracker'
import { GazeDetector, START_MS, END_MS, type GazeCondition, type GazeInterval, type GazeObservation } from './gazeDetector'
import type { IntegrityLogEvent } from './store'

type EventType = IntegrityLogEvent['eventType']

/** Same cap the server keeps per session: past it, new intervals are no longer recorded. */
export const MAX_REVIEW_EVENTS = 1000

/** Head movement: total head rotation (yaw + pitch, degrees) within this window ... */
const MOVEMENT_WINDOW_SEC = 3
/** ... at or above this is "moving a lot" (≈30°/s sustained; nodding while talking stays well below). */
const MOVEMENT_PATH_DEG = 90

const CONDITION_EVENT: Record<GazeCondition, EventType> = {
  looking_away: 'SIDE_GAZE_LOOKING_AWAY',
  no_face: 'NO_FACE_SEEN',
  multi_face: 'MULTIPLE_FACES_DETECTED',
  unavailable: 'UNABLE_TO_ASSESS',
}

const CONDITION_MESSAGE: Record<GazeCondition, string> = {
  looking_away: 'Looked away from the screen',
  no_face: 'No face in view',
  multi_face: 'More than one face in view',
  unavailable: 'Camera unavailable',
}

function clock(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}

/** Status-only samples (no observation): what the face-status channel says, in observation form. */
function observationFromStatus(status: FaceTrackStatus): GazeObservation | null | 'skip' {
  switch (status.issue) {
    case 'ok':
    case 'too_far':
      return { faceCount: 1, yawDeg: 0, pitchDeg: 0 }
    case 'no_face':
      return { faceCount: 0, yawDeg: 0, pitchDeg: 0 }
    case 'multi_person':
      return { faceCount: Math.max(2, status.faceCount), yawDeg: 0, pitchDeg: 0 }
    case 'looking_away':
      return { faceCount: 1, yawDeg: (status.yaw || 0.6) * 60, pitchDeg: 0 }
    case 'scanning':
      return 'skip'
    default:
      return null
  }
}

type Simple = { type: EventType; startMs: number; lastOnMs: number; offSinceMs?: number; message: string; event?: IntegrityLogEvent }

/**
 * Turns per-frame camera measurements into review intervals stored with the interview. Offsets are relative to the
 * start of the recording (`elapsed`, seconds), so each interval lines up with the stored video.
 *
 * Face / gaze / camera intervals come from the calibrated, debounced {@link GazeDetector}. Head movement and phone
 * intervals use the same start/end hysteresis.
 */
export class ReviewEventTracker {
  private gaze = new GazeDetector((interval) => this.onGaze(interval))
  private byKey = new Map<string, IntegrityLogEvent>()
  private movement: Simple | null = null
  private phone: Simple | null = null
  private poses: { t: number; yaw: number; pitch: number }[] = []
  private now = Date.now()
  private lastMs = 0
  events: IntegrityLogEvent[] = []

  /**
   * One sampled frame. `elapsed` = seconds since the recording started. `observation` is the FaceLandmarker
   * measurement for this frame; null means the frame could not be analysed (the status label says why). Without an
   * observation argument the face status alone is used.
   */
  sample(status: FaceTrackStatus, elapsed: number, now = Date.now(), observation?: FaceObservation | null) {
    if (!Number.isFinite(elapsed)) return
    const tMs = Math.max(0, elapsed * 1000)
    this.now = now
    this.lastMs = Math.max(this.lastMs, tMs)

    if (observation) {
      this.gaze.update(observation, tMs)
    } else {
      const derived = observation === null && status.issue !== 'scanning' ? null : observationFromStatus(status)
      if (derived !== 'skip') this.gaze.update(derived, tMs, status.label || CONDITION_MESSAGE.unavailable)
    }

    const moving = observation ? this.headMoving(observation, elapsed) : false
    this.movement = this.track(this.movement, moving ? 'EXCESSIVE_MOVEMENT' : null, 'Frequent head movement', tMs, 2000)
    this.phone = this.track(this.phone, observation?.phoneDetected ? 'PHONE_DETECTED' : null, 'A phone was visible on camera', tMs, START_MS)
  }

  finish(elapsed: number) {
    const tMs = Number.isFinite(elapsed) ? Math.max(0, elapsed * 1000) : this.lastMs
    this.gaze.finish(tMs)
    for (const p of [this.movement, this.phone]) {
      if (p?.event) this.setSpan(p.event, p.startMs, p.lastOnMs >= this.lastMs ? Math.max(p.lastOnMs, tMs) : p.lastOnMs)
    }
    this.movement = null
    this.phone = null
    this.poses = []
  }

  private onGaze(interval: GazeInterval) {
    let event = this.byKey.get(interval.key)
    if (!event) {
      if (this.events.length >= MAX_REVIEW_EVENTS) return
      const startSec = interval.startMs / 1000
      event = {
        id: crypto.randomUUID(),
        eventType: CONDITION_EVENT[interval.type],
        severity: 'warn',
        message: '',
        timestamp: new Date(this.now - Math.max(0, this.lastMs - interval.startMs)).toISOString(),
        formattedTime: clock(startSec),
        startOffsetSec: startSec,
        durationSec: 0,
        reviewOnly: true,
      }
      this.byKey.set(interval.key, event)
      this.events.push(event)
    }
    event.message = interval.reason || CONDITION_MESSAGE[interval.type]
    event.confidence = interval.confidence
    event.level = interval.severity
    this.setSpan(event, interval.startMs, interval.endMs)
  }

  private setSpan(event: IntegrityLogEvent, startMs: number, endMs: number) {
    const end = Math.max(startMs, endMs)
    event.startOffsetSec = startMs / 1000
    event.durationSec = Number(((end - startMs) / 1000).toFixed(3))
    event.startOffsetMs = Math.round(startMs)
    event.endOffsetMs = Math.round(end)
  }

  /** One debounced channel: opens after `startMs` of the condition, ends after END_MS without it. */
  private track(p: Simple | null, type: EventType | null, message: string, tMs: number, startMs: number): Simple | null {
    if (p && !type) {
      p.offSinceMs ??= tMs
      if (tMs - p.lastOnMs < (p.event ? END_MS : 500)) return p
      // Ends where the condition was first seen gone.
      if (p.event) this.setSpan(p.event, p.startMs, p.offSinceMs)
      return null
    }
    if (!type) return p
    if (!p) p = { type, startMs: tMs, lastOnMs: tMs, message }
    p.lastOnMs = tMs
    p.offSinceMs = undefined
    if (!p.event && p.lastOnMs - p.startMs >= startMs && this.events.length < MAX_REVIEW_EVENTS) {
      p.event = {
        id: crypto.randomUUID(),
        eventType: p.type,
        severity: 'warn',
        message: p.message,
        timestamp: new Date(this.now - (tMs - p.startMs)).toISOString(),
        formattedTime: clock(p.startMs / 1000),
        startOffsetSec: p.startMs / 1000,
        durationSec: 0,
        reviewOnly: true,
      }
      this.events.push(p.event)
    }
    if (p.event) this.setSpan(p.event, p.startMs, p.lastOnMs)
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
