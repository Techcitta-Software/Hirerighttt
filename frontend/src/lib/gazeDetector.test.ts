import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_MS,
  END_MS,
  GAZE_THRESHOLDS,
  GazeDetector,
  START_MS,
  classifyFrame,
  type GazeObservation,
} from './gazeDetector'

const FPS = 6
const STEP_MS = 1000 / FPS

const neutral: GazeObservation = { faceCount: 1, yawDeg: 2, pitchDeg: -3, eyeX: 0.02, eyeY: 0.05, irisX: 0.01, blink: 0.05 }

/** Feed a timeline: `at(tMs)` returns the observation for that frame (null = unanalysable). */
function run(durationMs: number, at: (tMs: number) => GazeObservation | null, detector = new GazeDetector()) {
  for (let t = 0; t <= durationMs; t += STEP_MS) detector.update(at(t), t, 'Camera unavailable')
  detector.finish(durationMs)
  return detector
}

const between = (t: number, a: number, b: number) => t >= a && t < b

describe('classifyFrame', () => {
  it('reads no face, multiple faces and an unanalysable frame', () => {
    expect(classifyFrame({ ...neutral, faceCount: 0 })).toMatchObject({ condition: 'no_face' })
    expect(classifyFrame({ ...neutral, faceCount: 2 })).toMatchObject({ condition: 'multi_face' })
    expect(classifyFrame(null, undefined, 'Camera unavailable')).toEqual({ condition: 'unavailable', reason: 'Camera unavailable' })
  })

  it('flags head yaw/pitch past the thresholds, relative to the baseline', () => {
    expect(classifyFrame({ ...neutral, yawDeg: GAZE_THRESHOLDS.yawDeg + 1 })).toMatchObject({ condition: 'looking_away', reason: 'Head turned away' })
    expect(classifyFrame({ ...neutral, yawDeg: -(GAZE_THRESHOLDS.yawDeg + 1) })).toMatchObject({ condition: 'looking_away' })
    expect(classifyFrame({ ...neutral, pitchDeg: GAZE_THRESHOLDS.pitchDeg + 1 })).toMatchObject({ reason: 'Head tilted away' })
    expect(classifyFrame({ ...neutral, yawDeg: GAZE_THRESHOLDS.yawDeg - 2 })).toEqual({ condition: null, reason: '' })
    // Camera off to the side: 30° is the candidate's neutral pose, 40° is only 10° away from it.
    const base = { yawDeg: 30, pitchDeg: 0, eyeX: 0, eyeY: 0, irisX: 0 }
    expect(classifyFrame({ ...neutral, yawDeg: 40 }, base)).toEqual({ condition: null, reason: '' })
    expect(classifyFrame({ ...neutral, yawDeg: 0 }, base)).toMatchObject({ condition: 'looking_away' })
  })

  it('flags eye gaze off screen from blendshapes or the iris, and holds on a blink', () => {
    expect(classifyFrame({ ...neutral, eyeX: 0.6 })).toMatchObject({ reason: 'Eyes looking to the side' })
    expect(classifyFrame({ ...neutral, irisX: -0.25 })).toMatchObject({ reason: 'Eyes looking to the side' })
    expect(classifyFrame({ ...neutral, eyeY: 0.7 })).toMatchObject({ reason: 'Eyes looking down' })
    expect(classifyFrame({ ...neutral, eyeY: -0.7 })).toMatchObject({ reason: 'Eyes looking up' })
    expect(classifyFrame({ ...neutral, eyeX: 0.3 })).toEqual({ condition: null, reason: '' })
    expect(classifyFrame({ ...neutral, eyeX: 0.9, blink: 0.9 })).toBe('hold')
  })
})

describe('GazeDetector', () => {
  it('records a sustained look-away with offsets relative to the recording start', () => {
    const d = run(20_000, (t) => (between(t, 8000, 14_000) ? { ...neutral, yawDeg: 40 } : neutral))
    expect(d.intervals).toHaveLength(1)
    const [iv] = d.intervals
    expect(iv).toMatchObject({ type: 'looking_away', open: false, reason: 'Head turned away' })
    expect(iv.startMs).toBeGreaterThanOrEqual(8000)
    expect(iv.startMs).toBeLessThanOrEqual(8000 + STEP_MS + 1)
    expect(iv.endMs).toBeGreaterThanOrEqual(14_000)
    expect(iv.endMs).toBeLessThanOrEqual(14_000 + STEP_MS + 1)
    expect(iv.confidence).toBeGreaterThan(0.8)
  })

  it('ignores blinks and glances shorter than the start threshold', () => {
    const d = run(20_000, (t) => {
      if (between(t, 5000, 5000 + START_MS - 400)) return { ...neutral, eyeX: 0.8 } // quick glance
      if (between(t, 9000, 9300)) return { ...neutral, blink: 0.95, eyeY: 0.8 } // blink
      if (between(t, 12_000, 13_000)) return { ...neutral, faceCount: 0 } // ducked out for 1 s
      return neutral
    })
    expect(d.intervals).toEqual([])
  })

  it('does not split one look-away on a single noisy frame, and ends only after END_MS normal', () => {
    let i = 0
    const d = run(20_000, (t) => {
      i += 1
      if (between(t, 6000, 12_000)) return i % 9 === 0 ? neutral : { ...neutral, eyeX: -0.7 }
      if (between(t, 12_000, 12_000 + END_MS - 300)) return neutral
      if (between(t, 12_000 + END_MS - 300, 14_000)) return { ...neutral, eyeX: -0.7 }
      return neutral
    })
    expect(d.intervals).toHaveLength(1)
    expect(d.intervals[0].startMs).toBeLessThan(6000 + STEP_MS)
    expect(d.intervals[0].endMs).toBeGreaterThanOrEqual(14_000)
  })

  it('calibrates to the neutral pose so an off-centre camera is not one long event', () => {
    const offCentre = { ...neutral, yawDeg: 30 }
    const d = run(30_000, (t) => (between(t, 15_000, 20_000) ? { ...neutral, yawDeg: 0 } : offCentre))
    expect(d.calibrated).toBe(true)
    expect(d.calibrationBaseline.yawDeg).toBeCloseTo(25) // clamped
    // Without calibration every frame at 30° would be "away"; with it only the 5 s at 0° (25° from neutral) is.
    expect(d.intervals).toHaveLength(1)
    expect(d.intervals[0].startMs).toBeGreaterThanOrEqual(15_000)
  })

  it('does not report looking away during calibration, but does report no face / multiple faces', () => {
    const d = run(CALIBRATION_MS + 500, (t) => (t < 2500 ? { ...neutral, faceCount: 2 } : { ...neutral, yawDeg: 60 }))
    expect(d.intervals.map((i) => i.type)).toEqual(['multi_face'])
    expect(d.intervals[0].severity).toBe('high')
  })

  it('records an unavailable camera, and a condition still open at the end runs to the end', () => {
    const d = run(10_000, (t) => (t < 4000 ? neutral : null))
    expect(d.intervals).toHaveLength(1)
    expect(d.intervals[0]).toMatchObject({ type: 'unavailable', reason: 'Camera unavailable', open: false, endMs: 10_000 })
    expect(d.intervals[0].startMs).toBeGreaterThanOrEqual(4000)
  })

  it('marks long intervals high severity', () => {
    const d = run(30_000, (t) => (between(t, 5000, 17_000) ? { ...neutral, faceCount: 0 } : neutral))
    expect(d.intervals[0]).toMatchObject({ type: 'no_face', severity: 'high' })
  })

  it('closes intervals when sampling stalls instead of stretching them over the gap', () => {
    const d = new GazeDetector()
    let t = 0
    for (; t <= 8000; t += STEP_MS) d.update(t >= 4000 ? { ...neutral, faceCount: 0 } : neutral, t)
    d.update(neutral, t + 20_000)
    expect(d.intervals[0].open).toBe(false)
    expect(d.intervals[0].endMs).toBeLessThanOrEqual(t)
  })

  it('reports start/update/end to the listener', () => {
    const phases: string[] = []
    run(10_000, (t) => (between(t, 4000, 7000) ? { ...neutral, faceCount: 0 } : neutral), new GazeDetector((_, p) => phases.push(p)))
    expect(phases[0]).toBe('start')
    expect(phases.at(-1)).toBe('end')
    expect(phases.filter((p) => p === 'end')).toHaveLength(1)
  })
})
