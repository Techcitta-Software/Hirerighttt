import { describe, expect, it } from 'vitest'
import {
  eyeGazeFromBlendshapes,
  headAnglesFromMatrix,
  irisOffsetFromLandmarks,
  observationFromResult,
} from './faceTracker'

/** Column-major 4x4 (MediaPipe layout) for a rotation of `yaw` about Y then `pitch` about X, scaled by `s`. */
function matrix(yawDeg: number, pitchDeg: number, s = 1): number[] {
  const y = (yawDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  // R = Ry(y) · Rx(p)
  const r = [
    [Math.cos(y), Math.sin(y) * Math.sin(p), Math.sin(y) * Math.cos(p)],
    [0, Math.cos(p), -Math.sin(p)],
    [-Math.sin(y), Math.cos(y) * Math.sin(p), Math.cos(y) * Math.cos(p)],
  ]
  const m = new Array(16).fill(0)
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) m[col * 4 + row] = r[row][col] * s
  m[12] = 1
  m[13] = 2
  m[14] = -40
  m[15] = 1
  return m
}

function blend(scores: Record<string, number>) {
  return Object.entries(scores).map(([categoryName, score]) => ({ categoryName, score }))
}

/** A 478-point face (with irises) in a box; `iris` shifts both iris centres within the eye opening. */
function face(cx: number, cy: number, size: number, iris = 0) {
  const pts = Array.from({ length: 478 }, (_, i) => ({
    x: cx + size * (((i * 37) % 100) / 100 - 0.5),
    y: cy + size * (((i * 53) % 100) / 100 - 0.5),
    z: 0,
  }))
  const eye = (a: number, b: number, irisIdx: number, x0: number) => {
    pts[a] = { x: x0, y: cy, z: 0 }
    pts[b] = { x: x0 + 0.1 * size, y: cy, z: 0 }
    pts[irisIdx] = { x: x0 + 0.05 * size + iris * 0.1 * size, y: cy, z: 0 }
  }
  eye(33, 133, 468, cx - 0.3 * size)
  eye(362, 263, 473, cx + 0.2 * size)
  return pts
}

describe('headAnglesFromMatrix', () => {
  it('recovers yaw and pitch from a column-major transformation matrix, ignoring scale', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [30, 0],
      [-40, 0],
      [0, 20],
      [25, -15],
    ]) {
      const a = headAnglesFromMatrix(matrix(yaw, pitch, 1.7))
      expect(a.yawDeg).toBeCloseTo(yaw, 4)
      expect(a.pitchDeg).toBeCloseTo(pitch, 4)
    }
  })

  it('returns a neutral pose for missing or degenerate matrices', () => {
    expect(headAnglesFromMatrix(undefined)).toEqual({ yawDeg: 0, pitchDeg: 0 })
    expect(headAnglesFromMatrix(new Array(16).fill(0))).toEqual({ yawDeg: 0, pitchDeg: 0 })
  })
})

describe('eyeGazeFromBlendshapes', () => {
  it('maps eyeLook blendshapes to a signed direction, and reports centre and blinks', () => {
    const right = eyeGazeFromBlendshapes(blend({ eyeLookOutRight: 0.8, eyeLookInLeft: 0.7 }))
    expect(right.gazeDirection).toBe('right')
    expect(right.eyeX).toBeCloseTo(0.75)
    const left = eyeGazeFromBlendshapes(blend({ eyeLookOutLeft: 0.6, eyeLookInRight: 0.6 }))
    expect(left).toMatchObject({ gazeDirection: 'left' })
    expect(left.eyeX).toBeCloseTo(-0.6)
    expect(eyeGazeFromBlendshapes(blend({ eyeLookOutLeft: 0.05 }))).toMatchObject({ gazeDirection: 'center' })
    const down = eyeGazeFromBlendshapes(blend({ eyeLookDownLeft: 0.7, eyeLookDownRight: 0.5, eyeBlinkLeft: 0.2, eyeBlinkRight: 0.4 }))
    expect(down.eyeY).toBeCloseTo(0.6)
    expect(down.blink).toBeCloseTo(0.3)
    expect(eyeGazeFromBlendshapes(undefined)).toMatchObject({ gazeScore: 0, gazeDirection: 'center', eyeX: 0, eyeY: 0 })
  })
})

describe('irisOffsetFromLandmarks', () => {
  it('measures the iris position within the eye opening', () => {
    expect(irisOffsetFromLandmarks(face(0.5, 0.5, 0.3, 0))).toBeCloseTo(0)
    expect(irisOffsetFromLandmarks(face(0.5, 0.5, 0.3, 0.3))).toBeCloseTo(0.3)
    expect(irisOffsetFromLandmarks(face(0.5, 0.5, 0.3).slice(0, 468))).toBeUndefined()
  })
})

describe('observationFromResult', () => {
  it('measures the largest face and ignores tiny background faces', () => {
    const result = {
      faceLandmarks: [face(0.15, 0.15, 0.05), face(0.5, 0.5, 0.4, 0.25)],
      faceBlendshapes: [
        { categories: blend({}), headIndex: 0, headName: '' },
        { categories: blend({ eyeLookOutRight: 0.6, eyeLookInLeft: 0.6 }), headIndex: 0, headName: '' },
      ],
      facialTransformationMatrixes: [
        { rows: 4, columns: 4, data: matrix(0, 0) },
        { rows: 4, columns: 4, data: matrix(35, 5) },
      ],
    }
    const { observation } = observationFromResult(result)
    expect(observation.faceCount).toBe(1) // the small face is under 15% of the main face
    expect(observation.yawDeg).toBeCloseTo(35, 3)
    expect(observation.pitchDeg).toBeCloseTo(5, 3)
    expect(observation.eyeX).toBeCloseTo(0.6)
    expect(observation.irisX).toBeCloseTo(0.25)
  })

  it('counts two real faces and reports none when the frame is empty', () => {
    const two = observationFromResult({
      faceLandmarks: [face(0.3, 0.5, 0.3), face(0.7, 0.5, 0.25)],
      faceBlendshapes: [],
      facialTransformationMatrixes: [],
    })
    expect(two.observation.faceCount).toBe(2)
    expect(observationFromResult({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }).observation).toMatchObject({
      faceCount: 0,
    })
  })
})
