import { describe, expect, it } from 'vitest'
import { buildStatus, type FaceObservation } from './faceTracker'
import { MAX_REVIEW_EVENTS, ReviewEventTracker } from './reviewEventTracker'

const ok = buildStatus(1, { yaw: 0, area: 0.2 })
const away = buildStatus(1, { yaw: 0.6, area: 0.2, lookingForward: false })

function obs(over: Partial<FaceObservation> = {}): FaceObservation {
  return { faceCount: 1, yawDeg: 0, pitchDeg: 0, gazeScore: 0, gazeDirection: 'center', ...over }
}

describe('ReviewEventTracker', () => {
  it('records a looked-away interval with its offset from the recording start and its duration', () => {
    const t = new ReviewEventTracker()
    for (let s = 0; s <= 20; s += 0.5) t.sample(s >= 10 && s < 17 ? away : ok, s)
    t.finish(20)
    expect(t.events).toHaveLength(1)
    expect(t.events[0]).toMatchObject({ eventType: 'SIDE_GAZE_LOOKING_AWAY', startOffsetSec: 10, durationSec: 7 })
  })

  it('ignores brief glances below the 1.5 s threshold', () => {
    const t = new ReviewEventTracker()
    for (let s = 0; s <= 10; s += 0.5) t.sample(s >= 4 && s < 5 ? away : ok, s)
    expect(t.events).toEqual([])
  })

  it('records frequent head movement as its own interval, alongside the face status', () => {
    const t = new ReviewEventTracker()
    // Head swinging ±25° every third of a second from 5 s to 12 s; still "ok" for the face channel.
    for (let i = 0; i <= 60; i++) {
      const s = i / 3
      const swinging = s >= 5 && s < 12
      t.sample(ok, s, Date.now(), obs({ yawDeg: swinging ? (i % 2 ? 25 : -25) : 0 }))
    }
    t.finish(20)
    const moves = t.events.filter((e) => e.eventType === 'EXCESSIVE_MOVEMENT')
    expect(moves).toHaveLength(1)
    expect(moves[0].startOffsetSec).toBeGreaterThanOrEqual(5)
    expect(moves[0].startOffsetSec).toBeLessThan(6)
    expect(moves[0].durationSec).toBeGreaterThan(5)
  })

  it('does not flag a steady head or small nods', () => {
    const t = new ReviewEventTracker()
    for (let i = 0; i <= 60; i++) t.sample(ok, i / 3, Date.now(), obs({ pitchDeg: i % 2 ? 3 : -3 }))
    expect(t.events).toEqual([])
  })

  it('records a phone in view once it stays visible', () => {
    const t = new ReviewEventTracker()
    for (let s = 0; s <= 10; s += 0.5) t.sample(ok, s, Date.now(), obs({ phoneDetected: s >= 3 && s < 8 }))
    t.finish(10)
    const phones = t.events.filter((e) => e.eventType === 'PHONE_DETECTED')
    expect(phones).toHaveLength(1)
    expect(phones[0]).toMatchObject({ startOffsetSec: 3, durationSec: 5 })
  })

  it('stops adding intervals at the server cap', () => {
    const t = new ReviewEventTracker()
    let s = 0
    for (let n = 0; n < MAX_REVIEW_EVENTS + 20; n++) {
      for (let k = 0; k < 6; k++, s += 1) t.sample(k < 5 ? away : ok, s)
    }
    expect(t.events.length).toBe(MAX_REVIEW_EVENTS)
  })

  it('records face-tracker observations (eye gaze) with ms offsets, confidence and a reason', () => {
    const t = new ReviewEventTracker()
    // ~6 fps: gaze off to the side from 12.0 s to 18.0 s (eyes only, head straight).
    for (let i = 0; i <= 150; i++) {
      const s = i / 6
      t.sample(ok, s, Date.now(), obs({ eyeX: s >= 12 && s < 18 ? 0.7 : 0.02, irisX: 0 }))
    }
    t.finish(25)
    expect(t.events).toHaveLength(1)
    const e = t.events[0]
    expect(e).toMatchObject({ eventType: 'SIDE_GAZE_LOOKING_AWAY', message: 'Eyes looking to the side', startOffsetMs: 12000 })
    expect(e.endOffsetMs).toBe(18000)
    expect(e.durationSec).toBeCloseTo(6, 3)
    expect(e.confidence).toBe(1)
    expect(e.level).toBe('medium')
  })

  it('records "camera unavailable" when frames cannot be analysed, without crashing', () => {
    const t = new ReviewEventTracker()
    const unavailable = { ...buildStatus(0), issue: 'unable_to_assess' as const, label: 'Camera unavailable — check that it is connected and allowed' }
    for (let i = 0; i <= 60; i++) {
      const s = i / 6
      if (s < 4) t.sample(ok, s, Date.now(), obs())
      else t.sample(unavailable, s, Date.now(), null)
    }
    t.finish(10)
    expect(t.events).toHaveLength(1)
    expect(t.events[0]).toMatchObject({ eventType: 'UNABLE_TO_ASSESS', startOffsetSec: 4, endOffsetMs: 10000 })
    expect(t.events[0].message).toMatch(/Camera unavailable/)
  })

  it('keeps the same event (id and start) while it grows, so periodic syncs update it in place', () => {
    const t = new ReviewEventTracker()
    for (let i = 0; i <= 60; i++) t.sample(ok, i / 6, Date.now(), obs())
    const ids: string[] = []
    for (let i = 61; i <= 120; i++) {
      t.sample(ok, i / 6, Date.now(), obs({ faceCount: 0 }))
      if (t.events[0]) ids.push(`${t.events[0].id}@${t.events[0].startOffsetSec}`)
    }
    expect(new Set(ids).size).toBe(1)
    expect(t.events[0].durationSec).toBeGreaterThan(8)
  })
})
