/**
 * Turns per-frame face measurements (MediaPipe FaceLandmarker: face count, head pose from the transformation matrix,
 * eye-look blendshapes and iris position) into debounced proctoring intervals. Pure logic: no DOM, no model, so it is
 * tested with recorded fixtures.
 *
 * - Calibration: the candidate's neutral pose over the first few seconds becomes the baseline, so a camera placed off
 *   to one side does not read as "looking away" for the whole interview.
 * - Hysteresis: a condition must persist START_MS before it becomes an interval and must be absent END_MS before the
 *   interval ends, so blinks, quick glances and single noisy frames create nothing and never split a real interval.
 * - Offsets are milliseconds from the recording start (the caller passes elapsed time since the recording began).
 */

export type GazeObservation = {
  faceCount: number
  yawDeg: number
  pitchDeg: number
  /** Signed horizontal eye gaze from blendshapes, -1 (candidate's left) .. 1 (candidate's right). */
  eyeX?: number
  /** Signed vertical eye gaze from blendshapes, -1 (up) .. 1 (down). */
  eyeY?: number
  /** Iris offset from the centre of the eye opening, -0.5 .. 0.5, averaged over both eyes. */
  irisX?: number
  /** Eyes-closed score 0..1 (blink). */
  blink?: number
}

export type GazeCondition = 'no_face' | 'multi_face' | 'looking_away' | 'unavailable'

export type GazeInterval = {
  /** Stable for the life of the interval (used as the stored event id). */
  key: string
  type: GazeCondition
  startMs: number
  endMs: number
  /** Still open (the condition is ongoing). */
  open: boolean
  /** Share of analysed frames inside the interval that showed the condition, 0..1. */
  confidence: number
  /** Most frequent reason inside the interval ("Head turned away", "Eyes looking down", …). */
  reason: string
  severity: 'medium' | 'high'
}

export const GAZE_THRESHOLDS = {
  /** Head turned left/right beyond the calibrated baseline. */
  yawDeg: 25,
  /** Head tilted up/down beyond the calibrated baseline. */
  pitchDeg: 20,
  /** Eyes looking sideways (blendshape difference, 0..1). */
  eyeX: 0.45,
  /** Eyes looking down/up (blendshape difference). Higher than sideways: glancing at the keyboard is common. */
  eyeY: 0.55,
  /** Iris offset inside the eye opening. */
  irisX: 0.17,
  /** Above this the eyes are closed (blink): the frame says nothing about gaze. */
  blink: 0.55,
} as const

export const CALIBRATION_MS = 3000
/** Minimum calibration frames before the baseline is trusted. */
const CALIBRATION_MIN_FRAMES = 6
/** A condition must persist this long to become an interval … */
export const START_MS = 1500
/** … and must be absent this long for the interval to end. */
export const END_MS = 1000
/** Camera problems are noisier at the start (auto-exposure), so they need a little longer. */
const START_MS_BY_TYPE: Partial<Record<GazeCondition, number>> = { unavailable: 2000 }
/** While an interval is still pending, a gap this short (one or two noisy frames) does not reset it. */
const PENDING_GAP_MS = 500
/** No frames for this long (tab throttled, camera stalled): close what is open at the last frame seen. */
const STALL_MS = 4000
/** Intervals at least this long are high severity (multiple faces always are). */
const HIGH_SEVERITY_MS = 10_000

/** Calibration only accepts plausibly-neutral frames, and the baseline is clamped to these. */
const BASELINE_LIMIT = { yawDeg: 25, pitchDeg: 18, eyeX: 0.3, eyeY: 0.3, irisX: 0.12 }

type Baseline = { yawDeg: number; pitchDeg: number; eyeX: number; eyeY: number; irisX: number }
const ZERO_BASELINE: Baseline = { yawDeg: 0, pitchDeg: 0, eyeX: 0, eyeY: 0, irisX: 0 }

export type FrameVerdict = { condition: GazeCondition | null; reason: string } | 'hold'

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function clamp(v: number, limit: number) {
  return Math.max(-limit, Math.min(limit, v))
}

function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Per-frame classification against a baseline. Exposed for tests. */
export function classifyFrame(o: GazeObservation | null, baseline: Baseline = ZERO_BASELINE, unavailableReason = 'Camera unavailable'): FrameVerdict {
  if (!o) return { condition: 'unavailable', reason: unavailableReason }
  if (o.faceCount <= 0) return { condition: 'no_face', reason: 'No face in view' }
  if (o.faceCount > 1) return { condition: 'multi_face', reason: `${o.faceCount} faces in view` }
  if (!Number.isFinite(o.yawDeg) || !Number.isFinite(o.pitchDeg)) return 'hold'

  const dYaw = o.yawDeg - baseline.yawDeg
  const dPitch = o.pitchDeg - baseline.pitchDeg
  if (Math.abs(dYaw) >= GAZE_THRESHOLDS.yawDeg) return { condition: 'looking_away', reason: 'Head turned away' }
  if (Math.abs(dPitch) >= GAZE_THRESHOLDS.pitchDeg) return { condition: 'looking_away', reason: 'Head tilted away' }

  // Eyes: a closed eye has no gaze, so a blink neither starts nor ends anything.
  if (num(o.blink) >= GAZE_THRESHOLDS.blink) return 'hold'
  const dEyeX = num(o.eyeX) - baseline.eyeX
  const dEyeY = num(o.eyeY) - baseline.eyeY
  const dIris = num(o.irisX) - baseline.irisX
  if (Math.abs(dEyeX) >= GAZE_THRESHOLDS.eyeX || Math.abs(dIris) >= GAZE_THRESHOLDS.irisX) {
    return { condition: 'looking_away', reason: 'Eyes looking to the side' }
  }
  if (dEyeY >= GAZE_THRESHOLDS.eyeY) return { condition: 'looking_away', reason: 'Eyes looking down' }
  if (dEyeY <= -GAZE_THRESHOLDS.eyeY) return { condition: 'looking_away', reason: 'Eyes looking up' }
  return { condition: null, reason: '' }
}

type Channel = {
  type: GazeCondition
  state: 'pending' | 'active'
  key: string
  startMs: number
  lastOnMs: number
  /** First frame without the condition after the last frame with it (the interval's end once it closes). */
  offSinceMs?: number
  onFrames: number
  frames: number
  /** Frames without the condition since it was last seen (not part of the interval if it ends). */
  trailingOff: number
  reasons: Map<string, number>
  interval?: GazeInterval
}

const CONDITIONS: GazeCondition[] = ['no_face', 'multi_face', 'looking_away', 'unavailable']

export class GazeDetector {
  private baseline: Baseline = { ...ZERO_BASELINE }
  private calib: { firstMs: number; samples: Baseline[] } | null = { firstMs: -1, samples: [] }
  private channels = new Map<GazeCondition, Channel>()
  private lastFrameMs = -1
  private seq = 0
  /** Every interval that has started (open ones are updated in place). */
  readonly intervals: GazeInterval[] = []

  private readonly onInterval?: (interval: GazeInterval, phase: 'start' | 'update' | 'end') => void

  constructor(onInterval?: (interval: GazeInterval, phase: 'start' | 'update' | 'end') => void) {
    this.onInterval = onInterval
  }

  get calibrated(): boolean {
    return this.calib === null
  }

  get calibrationBaseline(): Readonly<Baseline> {
    return this.baseline
  }

  /**
   * Feed one sampled frame. `tMs` = ms since the recording started (monotonic). `observation` null = the frame could not
   * be analysed (camera missing/blocked/too dark, model unavailable); `unavailableReason` says why.
   */
  update(observation: GazeObservation | null, tMs: number, unavailableReason?: string): void {
    if (!Number.isFinite(tMs)) return
    if (this.lastFrameMs >= 0 && tMs - this.lastFrameMs > STALL_MS) this.closeAll(this.lastFrameMs)
    this.lastFrameMs = Math.max(this.lastFrameMs, tMs)

    this.calibrate(observation, tMs)
    let verdict = classifyFrame(observation, this.baseline, unavailableReason)
    // Until the neutral pose is known, only report what does not depend on it.
    if (!this.calibrated && verdict !== 'hold' && verdict.condition === 'looking_away') verdict = 'hold'
    // A held frame (blink, unreadable pose) neither confirms nor refutes anything.
    if (verdict === 'hold') return

    for (const type of CONDITIONS) this.step(type, verdict.condition === type, tMs, verdict.reason)
  }

  /** Close every open interval (end of the interview). */
  finish(tMs?: number): GazeInterval[] {
    this.closeAll(Number.isFinite(tMs) && tMs !== undefined ? Math.max(tMs, this.lastFrameMs) : this.lastFrameMs, true)
    return this.intervals
  }

  private calibrate(o: GazeObservation | null, tMs: number) {
    const c = this.calib
    if (!c) return
    if (
      o &&
      o.faceCount === 1 &&
      Number.isFinite(o.yawDeg) &&
      Number.isFinite(o.pitchDeg) &&
      Math.abs(o.yawDeg) <= 35 &&
      Math.abs(o.pitchDeg) <= 25 &&
      num(o.blink) < GAZE_THRESHOLDS.blink
    ) {
      if (c.firstMs < 0) c.firstMs = tMs
      c.samples.push({ yawDeg: o.yawDeg, pitchDeg: o.pitchDeg, eyeX: num(o.eyeX), eyeY: num(o.eyeY), irisX: num(o.irisX) })
    }
    if (c.firstMs >= 0 && tMs - c.firstMs >= CALIBRATION_MS && c.samples.length >= CALIBRATION_MIN_FRAMES) {
      const pick = (k: keyof Baseline) => clamp(median(c.samples.map((s) => s[k])), BASELINE_LIMIT[k])
      this.baseline = { yawDeg: pick('yawDeg'), pitchDeg: pick('pitchDeg'), eyeX: pick('eyeX'), eyeY: pick('eyeY'), irisX: pick('irisX') }
      this.calib = null
    } else if (tMs >= CALIBRATION_MS * 4) {
      // Never saw a usable neutral face (camera blocked, no face): carry on with a zero baseline.
      this.calib = null
    }
  }

  private step(type: GazeCondition, on: boolean, tMs: number, reason: string) {
    let ch = this.channels.get(type)
    if (!ch) {
      if (!on) return
      ch = {
        type,
        state: 'pending',
        key: `${type}-${++this.seq}`,
        startMs: tMs,
        lastOnMs: tMs,
        onFrames: 0,
        frames: 0,
        trailingOff: 0,
        reasons: new Map(),
      }
      this.channels.set(type, ch)
    }
    ch.frames += 1
    if (!on) {
      ch.trailingOff += 1
      if (ch.offSinceMs === undefined) ch.offSinceMs = tMs
    }
    if (on) {
      ch.offSinceMs = undefined
      ch.trailingOff = 0
      ch.onFrames += 1
      ch.lastOnMs = tMs
      ch.reasons.set(reason, (ch.reasons.get(reason) ?? 0) + 1)
    }

    if (ch.state === 'pending') {
      if (!on && tMs - ch.lastOnMs >= PENDING_GAP_MS) {
        this.channels.delete(type)
        return
      }
      if (ch.lastOnMs - ch.startMs >= (START_MS_BY_TYPE[type] ?? START_MS)) {
        ch.state = 'active'
        ch.interval = this.snapshot(ch, true)
        this.intervals.push(ch.interval)
        this.onInterval?.(ch.interval, 'start')
      }
      return
    }

    if (!on && tMs - ch.lastOnMs >= END_MS) {
      this.close(ch)
      return
    }
    Object.assign(ch.interval!, this.snapshot(ch, true))
    this.onInterval?.(ch.interval!, 'update')
  }

  private snapshot(ch: Channel, open: boolean, endAtMs = ch.lastOnMs): GazeInterval {
    let reason = ''
    let best = -1
    for (const [r, n] of ch.reasons) if (n > best) [reason, best] = [r, n]
    const endMs = Math.max(ch.startMs, endAtMs)
    return {
      key: ch.key,
      type: ch.type,
      startMs: Math.round(ch.startMs),
      endMs: Math.round(endMs),
      open,
      confidence: ch.frames - ch.trailingOff > 0 ? Number((ch.onFrames / (ch.frames - ch.trailingOff)).toFixed(2)) : 1,
      reason,
      severity: ch.type === 'multi_face' || endMs - ch.startMs >= HIGH_SEVERITY_MS ? 'high' : 'medium',
    }
  }

  private close(ch: Channel, endAtMs?: number) {
    this.channels.delete(ch.type)
    if (ch.state !== 'active' || !ch.interval) return
    const end = endAtMs !== undefined ? Math.max(ch.lastOnMs, endAtMs) : (ch.offSinceMs ?? ch.lastOnMs)
    Object.assign(ch.interval, this.snapshot(ch, false, end))
    this.onInterval?.(ch.interval, 'end')
  }

  private closeAll(atMs: number, extendToNow = false) {
    for (const ch of [...this.channels.values()]) {
      // An interval still showing its condition on the last frame runs to the end of the recording.
      const stillOn = extendToNow && ch.lastOnMs >= this.lastFrameMs
      if (ch.state === 'pending') {
        // A pending condition that reached the start threshold by the end still counts.
        if (ch.lastOnMs - ch.startMs >= (START_MS_BY_TYPE[ch.type] ?? START_MS)) {
          ch.state = 'active'
          ch.interval = this.snapshot(ch, true)
          this.intervals.push(ch.interval)
          this.onInterval?.(ch.interval, 'start')
        } else {
          this.channels.delete(ch.type)
          continue
        }
      }
      this.close(ch, stillOn ? atMs : undefined)
    }
  }
}
