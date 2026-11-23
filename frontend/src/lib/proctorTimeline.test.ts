import { describe, expect, it } from 'vitest'
import type { IntegrityLogEvent, InterviewFlagSection } from './store'
import {
  MIN_SEGMENT_PCT,
  buildTimelineMarkers,
  countByCategory,
  formatTimelineClock,
  markerIndexAtTime,
  markerTooltip,
  placeMarkers,
  resolveTimelineDuration,
  seekTargetForMarker,
  seekTargetForRatio,
  stepMarkerIndex,
} from './proctorTimeline'

function ev(over: Partial<IntegrityLogEvent> = {}): IntegrityLogEvent {
  return {
    id: over.id ?? `e-${Math.random()}`,
    eventType: 'SIDE_GAZE_LOOKING_AWAY',
    severity: 'warn',
    message: 'Face the camera',
    timestamp: '2026-11-20T10:00:00Z',
    formattedTime: '0:00',
    startOffsetSec: 10,
    durationSec: 6,
    ...over,
  }
}

function flag(over: Partial<InterviewFlagSection> = {}): InterviewFlagSection {
  return {
    id: 'f1',
    type: 'LOOKING_SIDE',
    severity: 'medium',
    turnIndex: 1,
    questionText: 'Q',
    startSec: 10,
    endSec: 16,
    durationSec: 6,
    reason: 'Looked to the side',
    ...over,
  }
}

describe('buildTimelineMarkers', () => {
  it('maps every deviation kind to a labelled marker, sorted by time', () => {
    const markers = buildTimelineMarkers([
      ev({ id: 'tab', eventType: 'TAB_OR_WINDOW_LEFT', startOffsetSec: 90, durationSec: 0, severity: 'block' }),
      ev({ id: 'gaze', startOffsetSec: 10, durationSec: 6 }),
      ev({ id: 'move', eventType: 'EXCESSIVE_MOVEMENT', startOffsetSec: 30, durationSec: 4 }),
      ev({ id: 'phone', eventType: 'PHONE_DETECTED', startOffsetSec: 40, durationSec: 3 }),
      ev({ id: 'multi', eventType: 'MULTIPLE_FACES_DETECTED', startOffsetSec: 50 }),
      ev({ id: 'none', eventType: 'NO_FACE_SEEN', startOffsetSec: 60 }),
    ])
    expect(markers.map((m) => [m.id, m.label])).toEqual([
      ['gaze', 'Looked away'],
      ['move', 'Head movement'],
      ['phone', 'Phone in view'],
      ['multi', 'Multiple faces'],
      ['none', 'No face'],
      ['tab', 'Left tab / window'],
    ])
    expect(markers.find((m) => m.id === 'tab')).toMatchObject({ instant: true, severity: 'high' })
    expect(markers.find((m) => m.id === 'gaze')).toMatchObject({ instant: false, startSec: 10, endSec: 16 })
  })

  it('prefers the server millisecond offsets when present', () => {
    const [m] = buildTimelineMarkers([ev({ startOffsetSec: 1, durationSec: 1, startOffsetMs: 12500, endOffsetMs: 18750 })])
    expect(m.startSec).toBe(12.5)
    expect(m.endSec).toBe(18.75)
  })

  it('treats a hidden-tab camera pause as a tab switch', () => {
    const [m] = buildTimelineMarkers([
      ev({ eventType: 'UNABLE_TO_ASSESS', message: 'Camera paused — keep this tab open' }),
    ])
    expect(m.category).toBe('tab')
  })

  it('drops unknown types, missing or negative offsets and duplicate ids', () => {
    const markers = buildTimelineMarkers([
      ev({ id: 'a' }),
      ev({ id: 'a', startOffsetSec: 50 }),
      ev({ id: 'b', eventType: 'HACKED' as IntegrityLogEvent['eventType'] }),
      ev({ id: 'c', startOffsetSec: undefined }),
      ev({ id: 'd', startOffsetSec: -3 }),
      ev({ id: 'e', startOffsetSec: Number.NaN }),
      null as unknown as IntegrityLogEvent,
    ])
    expect(markers.map((m) => m.id)).toEqual(['a'])
  })

  it('adds proctor-engine flags only where no event of the same kind covers that time', () => {
    const markers = buildTimelineMarkers(
      [ev({ id: 'gaze', startOffsetSec: 10, durationSec: 6 })],
      [
        flag({ id: 'dup', startSec: 11, endSec: 15 }),
        flag({ id: 'later', startSec: 120, endSec: 125 }),
        flag({ id: 'multi', type: 'MULTI_FACE', startSec: 12, endSec: 14 }),
      ],
    )
    expect(markers.map((m) => m.id)).toEqual(['gaze', 'flag-multi', 'flag-later'])
  })

  it('uses flagged sections alone for older interviews without review events', () => {
    const markers = buildTimelineMarkers(undefined, [flag()])
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ category: 'gaze', startSec: 10, endSec: 16 })
  })

  it('returns no markers for an interview without any recorded deviation', () => {
    expect(buildTimelineMarkers([], [])).toEqual([])
    expect(buildTimelineMarkers(null, null)).toEqual([])
  })
})

describe('resolveTimelineDuration', () => {
  it('uses the video duration when the browser knows it', () => {
    expect(resolveTimelineDuration(300, 280)).toEqual({ durationSec: 300, known: true })
  })

  it('falls back to the stored duration for WebM files reporting Infinity', () => {
    expect(resolveTimelineDuration(Infinity, 280)).toEqual({ durationSec: 280, known: true })
    expect(resolveTimelineDuration(Number.NaN, 280)).toEqual({ durationSec: 280, known: true })
  })

  it('falls back to the last deviation when nothing else is known', () => {
    const markers = buildTimelineMarkers([ev({ startOffsetSec: 40, durationSec: 5 })])
    expect(resolveTimelineDuration(null, null, markers)).toEqual({ durationSec: 45, known: false })
    expect(resolveTimelineDuration(0, 0, [])).toEqual({ durationSec: 1, known: false })
  })
})

describe('placeMarkers', () => {
  it('positions segments and ticks proportionally to the video length', () => {
    const placed = placeMarkers(
      buildTimelineMarkers([
        ev({ id: 'seg', startOffsetSec: 50, durationSec: 20 }),
        ev({ id: 'tick', eventType: 'COPY_PASTE_ATTEMPT', startOffsetSec: 150, durationSec: 0 }),
      ]),
      200,
    )
    expect(placed[0]).toMatchObject({ id: 'seg', leftPct: 25, widthPct: 10, clamped: false })
    expect(placed[1]).toMatchObject({ id: 'tick', leftPct: 75, widthPct: 0, instant: true })
  })

  it('keeps very short segments visible', () => {
    const [m] = placeMarkers(buildTimelineMarkers([ev({ startOffsetSec: 100, durationSec: 1 })]), 3600)
    expect(m.widthPct).toBe(MIN_SEGMENT_PCT)
  })

  it('clamps events that run past, or start after, the end of the video', () => {
    const placed = placeMarkers(
      buildTimelineMarkers([
        ev({ id: 'over', startOffsetSec: 90, durationSec: 30 }),
        ev({ id: 'after', startOffsetSec: 500, durationSec: 10 }),
        ev({ id: 'tickAfter', eventType: 'TAB_OR_WINDOW_LEFT', startOffsetSec: 400, durationSec: 0 }),
      ]),
      100,
    )
    const by = Object.fromEntries(placed.map((p) => [p.id, p]))
    expect(by.over).toMatchObject({ leftPct: 90, widthPct: 10, clamped: true })
    expect(by.after.clamped).toBe(true)
    expect(by.after.leftPct + by.after.widthPct).toBeLessThanOrEqual(100)
    expect(by.after.leftPct).toBeGreaterThanOrEqual(0)
    expect(by.tickAfter).toMatchObject({ leftPct: 100, clamped: true })
    for (const p of placed) {
      expect(p.leftPct).toBeGreaterThanOrEqual(0)
      expect(p.leftPct + p.widthPct).toBeLessThanOrEqual(100)
    }
  })

  it('survives a zero or invalid duration', () => {
    const placed = placeMarkers(buildTimelineMarkers([ev({ startOffsetSec: 5 })]), 0)
    expect(Number.isFinite(placed[0].leftPct)).toBe(true)
  })
})

describe('seeking', () => {
  it('seeks to the start of the clicked marker, clamped to the video', () => {
    expect(seekTargetForMarker({ startSec: 42 }, 300)).toBe(42)
    expect(seekTargetForMarker({ startSec: 420 }, 300)).toBe(300)
    expect(seekTargetForMarker({ startSec: -2 }, 300)).toBe(0)
  })

  it('maps a click on the track to a time', () => {
    expect(seekTargetForRatio(0.5, 200)).toBe(100)
    expect(seekTargetForRatio(1.4, 200)).toBe(200)
    expect(seekTargetForRatio(-1, 200)).toBe(0)
    expect(seekTargetForRatio(Number.NaN, 200)).toBe(0)
  })
})

describe('labels, legend and keyboard', () => {
  it('formats tooltips like "Looked away · 03:42 (6s)"', () => {
    expect(markerTooltip({ label: 'Looked away', startSec: 222, endSec: 228, instant: false })).toBe(
      'Looked away · 03:42 (6s)',
    )
    expect(markerTooltip({ label: 'Left tab / window', startSec: 61, endSec: 61, instant: true })).toBe(
      'Left tab / window · 01:01',
    )
    expect(markerTooltip({ label: 'No face', startSec: 0, endSec: 95, instant: false })).toBe('No face · 00:00 (1m 35s)')
  })

  it('formats long recordings with hours', () => {
    expect(formatTimelineClock(3725)).toBe('1:02:05')
    expect(formatTimelineClock(Number.NaN)).toBe('00:00')
  })

  it('counts deviations by type in legend order', () => {
    const counts = countByCategory(
      buildTimelineMarkers([
        ev({ id: '1', eventType: 'TAB_OR_WINDOW_LEFT', durationSec: 0 }),
        ev({ id: '2' }),
        ev({ id: '3', startOffsetSec: 40 }),
      ]),
    )
    expect(counts).toEqual([
      { category: 'gaze', label: 'Looked away', count: 2 },
      { category: 'tab', label: 'Left tab / window', count: 1 },
    ])
  })

  it('steps between marks with the arrow keys, wrapping at both ends', () => {
    expect(stepMarkerIndex(3, 0, 'ArrowRight')).toBe(1)
    expect(stepMarkerIndex(3, 2, 'ArrowRight')).toBe(0)
    expect(stepMarkerIndex(3, 0, 'ArrowLeft')).toBe(2)
    expect(stepMarkerIndex(3, 1, 'Home')).toBe(0)
    expect(stepMarkerIndex(3, 1, 'End')).toBe(2)
    expect(stepMarkerIndex(3, 1, 'Tab')).toBe(1)
    expect(stepMarkerIndex(0, 0, 'ArrowRight')).toBe(-1)
  })

  it('starts keyboard focus at the first mark at or after the playhead', () => {
    const markers = buildTimelineMarkers([
      ev({ id: 'a', startOffsetSec: 10, durationSec: 2 }),
      ev({ id: 'b', startOffsetSec: 50, durationSec: 2 }),
    ])
    expect(markerIndexAtTime(markers, 0)).toBe(0)
    expect(markerIndexAtTime(markers, 30)).toBe(1)
    expect(markerIndexAtTime(markers, 999)).toBe(1)
    expect(markerIndexAtTime([], 5)).toBe(-1)
  })
})
