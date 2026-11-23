import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InterviewProctoringSummary } from '../lib/store'

vi.mock('../lib/adminAccess', () => ({ canViewInterviewVideo: () => true }))

const { VideoProctorTimeline } = await import('./VideoProctorTimeline')

/* The shape the server stores (review_logs_to_flag_sections + persist_proctoring_flags). */
const serverProctoring = {
  integrityScore: 85,
  status: 'REVIEW',
  counts: { total: 3, lookingSide: 1, multiplePeople: 1, noFace: 1 },
  flaggedSections: [
    { id: 'a', type: 'MULTIPLE_FACES_DETECTED', startOffsetSec: 95, durationSec: 12 },
    { id: 'b', type: 'NO_FACE_SEEN', startOffsetSec: 260, durationSec: 20 },
    { id: 'c', type: 'SIDE_GAZE_LOOKING_AWAY', startOffsetSec: 410, durationSec: 9 },
  ],
} as unknown as InterviewProctoringSummary

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(VideoProctorTimeline, props))

afterEach(() => vi.clearAllMocks())

describe('VideoProctorTimeline with real server data', () => {
  it('labels each section by its type with real times, never NaN', () => {
    const html = render({ proctoring: serverProctoring })
    expect(html).not.toContain('NaN')
    expect(html).toContain('Multiple people')
    expect(html).toContain('No face in frame')
    expect(html).toContain('Looking away')
    expect(html).toContain('1:35–1:47')
    expect(html).not.toContain('Turn #0')
  })

  it('a REVIEW status reads "Review recommended", never "No major flags"', () => {
    const html = render({ proctoring: serverProctoring })
    expect(html).toContain('Review recommended')
    expect(html).not.toContain('No major flags')
    expect(html).toContain('3 flagged sections')
  })

  it('does not contradict itself when there are events but no sustained sections', () => {
    const html = render({ proctoring: { ...serverProctoring, flaggedSections: [] } })
    expect(html).toContain('3 brief events · no sustained sections')
    expect(html).not.toContain('No sustained proctoring flags for this session')
  })

  it('can drop its own heading when the page already has one (drawer)', () => {
    expect(render({ proctoring: serverProctoring })).toContain('Interview recording &amp; proctoring')
    expect(render({ proctoring: serverProctoring, hideTitle: true })).not.toContain('Interview recording &amp; proctoring')
  })
})
