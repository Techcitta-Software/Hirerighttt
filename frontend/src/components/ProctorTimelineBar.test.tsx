import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { IntegrityLogEvent } from '../lib/store'
import { buildTimelineMarkers, placeMarkers, seekTargetForMarker, seekVideo } from '../lib/proctorTimeline'
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

const leftOf = (html: string, n = 0) => {
  const marks = html.split('data-testid="proctor-marker"').slice(1)
  return Number(/left:([\d.]+)%/.exec(marks[n])?.[1])
}

describe('ProctorTimelineBar', () => {
  it('still shows the single line for old recordings without events', () => {
    const html = render({ events: [], durationHint: 120 })
    expect(html).toContain('No deviations recorded')
    expect(html.match(/role="slider"/g)).toHaveLength(1)
    expect(html).not.toContain('data-testid="proctor-marker"')
  })

  it('is one line: a single track, no legend list, no header row, one summary line', () => {
    const html = render({
      durationHint: 400,
      events: [
        ev({ id: 'a', startOffsetSec: 222, durationSec: 6 }),
        ev({ id: 'b', eventType: 'TAB_OR_WINDOW_LEFT', startOffsetSec: 300, durationSec: 0 }),
        ev({ id: 'c', eventType: 'NO_FACE_SEEN', startOffsetSec: 380, durationSec: 4 }),
      ],
    })
    expect(html.match(/role="slider"/g)).toHaveLength(1)
    expect(html).not.toMatch(/<ul|<li/)
    expect(html.match(/<p /g)).toHaveLength(1)
    expect(html).toContain('3 deviations · Looked away 1 · No face 1 · Left tab / window 1')
    // All marks share the one track container.
    expect(html.match(/role="group"/g)).toHaveLength(1)
  })

  it('positions one accessible red mark per deviation at its time', () => {
    const html = render({
      durationHint: 400,
      events: [
        ev({ id: 'a', startOffsetSec: 222, durationSec: 6 }),
        ev({ id: 'b', eventType: 'TAB_OR_WINDOW_LEFT', startOffsetSec: 300, durationSec: 0 }),
      ],
    })
    expect(html.match(/data-testid="proctor-marker"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Looked away · 03:42 (6s)"')
    expect(html).toContain('aria-label="Left tab / window · 05:00"')
    expect(leftOf(html, 0)).toBeCloseTo(55.5, 3)
    expect(leftOf(html, 1)).toBeCloseTo(75, 3)
    // Roving tabindex: exactly one mark is in the tab order (plus the track slider).
    expect(html.match(/tabindex="0"/g)).toHaveLength(2)
  })

  it('uses the event ms offsets when present', () => {
    const html = render({ durationHint: 100, events: [ev({ id: 'a', startOffsetSec: 1, startOffsetMs: 25_000, endOffsetMs: 31_000 })] })
    expect(leftOf(html)).toBeCloseTo(25, 3)
    expect(html).toContain('Looked away · 00:25 (6s)')
  })

  it('clamps marks past the end of the video onto the track', () => {
    const html = render({ durationHint: 100, events: [ev({ id: 'late', startOffsetSec: 150, durationSec: 5 })] })
    expect(html).toContain('after the end of the video')
    expect(leftOf(html)).toBeLessThanOrEqual(100)
  })

  it('flags overlapping marks so they get a distinct shade/outline', () => {
    const html = render({
      durationHint: 600,
      events: [
        ev({ id: 'a', startOffsetSec: 100, durationSec: 20 }),
        ev({ id: 'b', eventType: 'PHONE_DETECTED', startOffsetSec: 110, durationSec: 5 }),
        ev({ id: 'c', eventType: 'NO_FACE_SEEN', startOffsetSec: 400, durationSec: 5 }),
      ],
    })
    const classes = [...html.matchAll(/data-testid="proctor-marker" data-category="\w+" class="([^"]+)"/g)].map((m) => m[1])
    expect(classes).toHaveLength(3)
    expect(classes[0]).not.toMatch(/overlap/)
    expect(classes[1]).toMatch(/overlap/)
    expect(classes[2]).not.toMatch(/overlap/)
  })

  it('renders the dark tone for the dark review panel', () => {
    expect(render({ tone: 'dark', durationHint: 10 })).toContain('data-tone="dark"')
  })
})

describe('without a video', () => {
  const noVideo = (props: Partial<Parameters<typeof ProctorTimelineBar>[0]> = {}) =>
    renderToStaticMarkup(createElement(ProctorTimelineBar, props))

  it('still draws the one line with red marks at interview time and the same count line', () => {
    const html = noVideo({
      durationHint: 400,
      events: [
        ev({ id: 'a', startOffsetSec: 100, durationSec: 6 }),
        ev({ id: 'b', eventType: 'TAB_OR_WINDOW_LEFT', startOffsetSec: 300, durationSec: 0 }),
      ],
    })
    expect(html).toContain('data-seekable="false"')
    expect(html.match(/data-testid="proctor-marker"/g)).toHaveLength(2)
    expect(leftOf(html, 0)).toBeCloseTo(25)
    expect(leftOf(html, 1)).toBeCloseTo(75)
    expect(html).toContain('2 deviations · Looked away 1 · Left tab / window 1')
    expect(html).toContain('Interview length 06:40')
  })

  it('is not a seek slider and each mark shows its time instead', () => {
    const html = noVideo({ durationHint: 400, events: [ev({ id: 'a', startOffsetSec: 222, durationSec: 6 })] })
    expect(html).not.toContain('role="slider"')
    expect(html).not.toContain('00:00 /')
    expect(html).toContain('title="Looked away · 03:42 (6s)"')
    expect(html).toContain('aria-label="Looked away · 03:42 (6s)"')
  })
})

describe('seeking', () => {
  it('moves the video to the start of a mark, clamped to the recording', () => {
    const video = { currentTime: 0 }
    const [m] = placeMarkers(buildTimelineMarkers([ev({ id: 'a', startOffsetSec: 42, durationSec: 6 })]), 100)
    expect(seekVideo(video, seekTargetForMarker(m, 100), 100)).toBe(42)
    expect(video.currentTime).toBe(42)
    expect(seekVideo(video, 500, 100)).toBe(100)
    expect(seekVideo(video, -3, 100)).toBe(0)
    expect(seekVideo(null, 12, 100)).toBe(12)
  })

  it('survives a video that is not seekable yet', () => {
    const video = {
      get currentTime() {
        return 0
      },
      set currentTime(_v: number) {
        throw new Error('InvalidStateError')
      },
    }
    expect(() => seekVideo(video, 5, 10)).not.toThrow()
  })
})

// ── Contrast of the marks (WCAG non-text contrast >= 3:1), from the actual CSS tokens ──

const css = readFileSync(join(__dirname, 'ProctorTimelineBar.module.css'), 'utf8')
const system = readFileSync(join(__dirname, '..', 'styles', 'system.css'), 'utf8')

function block(source: string, selector: string): string {
  // A CRLF checkout (core.autocrlf=true) must not break multi-line selectors such as '.rail,\n.played' (BUG-005).
  source = source.replace(/\r\n/g, '\n')
  const i = source.indexOf(`${selector} {`)
  return source.slice(i, source.indexOf('}', i))
}

function tokens(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of source.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const ds = tokens(block(system, ':root'))

function resolve(value: string, local: Record<string, string>): string {
  for (let i = 0; i < 5; i++) {
    const v = /^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/.exec(value)
    if (!v) break
    value = local[v[1]] ?? ds[v[1]] ?? v[2] ?? value
  }
  return value
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe('mark colours', () => {
  const light = tokens(block(css, '.root'))
  const dark = { ...light, ...tokens(block(css, '.dark')) }
  // Light panels the bar sits on: the modal/drawer surfaces.
  const cases: [string, Record<string, string>, string[]][] = [
    ['light', light, ['#ffffff', '#faf9ff', '#f8fafc']],
    ['dark', dark, ['#0f172a']],
  ]

  it('uses the danger token for the marks', () => {
    expect(light['--pt-mark']).toBe('var(--ds-danger-solid)')
    expect(light['--pt-mark-overlap']).toBe('var(--ds-danger)')
  })

  for (const [name, t, panels] of cases) {
    it(`${name}: every mark colour is >= 3:1 against the rail, the played part and the panel`, () => {
      const backgrounds = [resolve(t['--pt-rail'], t), resolve(t['--pt-played'], t), resolve(t['--pt-panel'], t), ...panels]
      for (const markVar of ['--pt-mark', '--pt-mark-overlap']) {
        const mark = resolve(t[markVar], t)
        expect(mark).toMatch(/^#[0-9a-f]{6}$/i)
        for (const bg of backgrounds) expect(contrast(mark, bg), `${markVar} ${mark} on ${bg}`).toBeGreaterThanOrEqual(3)
      }
      // The playhead stays visible on the rail.
      expect(contrast(resolve(t['--pt-playhead'], t), resolve(t['--pt-rail'], t))).toBeGreaterThanOrEqual(3)
    })
  }

  it('keeps marks at least 4px wide and taller than the 4px rail', () => {
    const mark = block(css, '.mark')
    expect(mark).toMatch(/min-width:\s*4px/)
    expect(Number(/height:\s*(\d+)px/.exec(mark)?.[1])).toBeGreaterThan(4)
    expect(block(css, '.tick')).toMatch(/width:\s*4px/)
    expect(block(css, '.rail,\n.played')).toMatch(/height:\s*4px/)
    expect(block(css, '.summary')).toMatch(/white-space:\s*nowrap/)
  })

  it('finds multi-line selectors in a CRLF copy of the CSS', () => {
    const lf = css.replace(/\r\n/g, '\n')
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(crlf).toContain('.rail,\r\n.played {')
    expect(block(crlf, '.rail,\n.played')).toMatch(/height:\s*4px/)
    expect(block(crlf, '.rail,\n.played')).toBe(block(lf, '.rail,\n.played'))
  })
})
