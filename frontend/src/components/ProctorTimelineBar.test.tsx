import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { IntegrityLogEvent } from '../lib/store'
import { ProctorTimelineBar } from './ProctorTimelineBar'

function ev(over: Partial<IntegrityLogEvent>): IntegrityLogEvent {
  return {
    id: 'e',
    eventType: 'SIDE_GAZE_LOOKING_AWAY',
    severity: 'warn',
    message: '',
    timestamp: '2026-11-20T10:00:00Z',
    formattedTime: '',
    startOffsetSec: 0,
    durationSec: 0,
    ...over,
  }
}

function render(props: Partial<Parameters<typeof ProctorTimelineBar>[0]> = {}) {
  const videoRef = createRef<HTMLVideoElement>()
  return renderToStaticMarkup(createElement(ProctorTimelineBar, { videoRef, ...props }))
}

describe('ProctorTimelineBar', () => {
  it('still shows the bar for old recordings without events', () => {
    const html = render({ events: [], durationHint: 120 })
    expect(html).toContain('No deviations recorded')
    expect(html).toContain('role="slider"')
    expect(html).not.toContain('data-testid="proctor-marker"')
  })

  it('draws one accessible red mark per deviation, with a legend and count', () => {
    const html = render({
      durationHint: 400,
      events: [
        ev({ id: 'a', startOffsetSec: 222, durationSec: 6 }),
        ev({ id: 'b', eventType: 'TAB_OR_WINDOW_LEFT', startOffsetSec: 300, durationSec: 0 }),
        ev({ id: 'c', startOffsetSec: 380, durationSec: 4 }),
      ],
    })
    expect(html.match(/data-testid="proctor-marker"/g)).toHaveLength(3)
    expect(html).toContain('3 deviations')
    expect(html).toContain('aria-label="Looked away · 03:42 (6s)"')
    expect(html).toContain('aria-label="Left tab / window · 05:00"')
    expect(html).toMatch(/left:55\.5\d*%/)
    // Legend: counts per type.
    expect(html).toMatch(/Looked away<span[^>]*>2<\/span>/)
    expect(html).toMatch(/Left tab \/ window<span[^>]*>1<\/span>/)
    // Roving tabindex: exactly one mark is in the tab order.
    expect(html.match(/tabindex="0"/g)).toHaveLength(2) // the track slider + one mark
  })

  it('clamps marks past the end of the video onto the track', () => {
    const html = render({ durationHint: 100, events: [ev({ id: 'late', startOffsetSec: 150, durationSec: 5 })] })
    expect(html).toContain('after the end of the video')
    const left = Number(/left:([\d.]+)%/.exec(html.slice(html.indexOf('proctor-marker')))?.[1])
    expect(left).toBeLessThanOrEqual(100)
  })
})
