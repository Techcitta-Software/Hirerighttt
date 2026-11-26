import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { indexApplicant } from '../../lib/applicantSearch'
import type { EmployerApplicant, IntegrityLogEvent, InterviewResult } from '../../lib/store'
import { ApplicantResumePanel } from './ApplicantResumePanel'
import { InterviewVideoView } from './InterviewVideoSection'
import { NO_VIDEO_TIMELINE_NOTE, noVideoState, type InterviewVideoState } from './interviewVideoState'

vi.mock('../../lib/adminAccess', () => ({ canViewInterviewVideo: () => true }))

function result(over: Partial<InterviewResult> = {}): InterviewResult {
  return {
    sessionId: 'sess-1',
    role: 'Frontend Engineer',
    level: 'mid',
    date: '2026-11-20T10:00:00Z',
    overall: 72,
    categories: [{ label: 'React', score: 80 }],
    strengths: ['Clear'],
    improvements: ['Depth'],
    answers: [
      {
        question: 'How do you speed up a slow React list?',
        answer: 'Profile the list, then measure again.',
        score: 82,
        wordCount: 8,
        keywordsHit: [],
        feedback: 'Strong, structured answer.',
        topic: 'Performance',
      },
    ],
    ...over,
  }
}

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Interview video section', () => {
  const view = (state: InterviewVideoState, onRetry?: () => void) =>
    renderToStaticMarkup(createElement(InterviewVideoView, { state, candidateName: 'Kavya Iyer', onRetry }))

  it('shows the video once with the face-gaze bar directly under it', () => {
    const html = view({ status: 'ready', url: 'https://example.test/v.webm', events: [], proctoring: null, durationSec: 120 })
    expect(html.match(/<video/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Interview recording of Kavya Iyer"')
    expect(html).toMatch(/<video[\s\S]*<\/video>[\s\S]*data-testid="proctor-timeline"/)
  })

  it('draws the face-gaze bar on interview time when no video was saved', () => {
    const events = [
      { id: 'g1', eventType: 'SIDE_GAZE_LOOKING_AWAY', severity: 'warn', message: '', timestamp: '', formattedTime: '', startOffsetSec: 60, durationSec: 5 },
      { id: 'g2', eventType: 'NO_FACE_SEEN', severity: 'warn', message: '', timestamp: '', formattedTime: '', startOffsetSec: 240, durationSec: 3 },
    ] as IntegrityLogEvent[]
    const state = noVideoState(events, null, 300)
    expect(state.status).toBe('timeline')
    const html = view(state)
    expect(html).not.toContain('<video')
    expect(html).toContain(NO_VIDEO_TIMELINE_NOTE)
    expect(html).toContain('data-testid="proctor-timeline"')
    expect(html.match(/data-testid="proctor-marker"/g)).toHaveLength(2)
    expect(html).toContain('2 deviations · Looked away 1 · No face 1')
    expect(html).toContain('Hover one to see when.')
    expect(html).not.toContain('Click one to jump there.')
  })

  it('keeps the plain "No recording" note when nothing was flagged', () => {
    expect(noVideoState([], null, 300)).toEqual({ status: 'none' })
    // Old logs without offsets cannot be placed, so no empty bar either.
    const old = [{ id: 'x', eventType: 'SIDE_GAZE_LOOKING_AWAY', severity: 'warn', message: '', timestamp: '', formattedTime: '' }] as IntegrityLogEvent[]
    expect(noVideoState(old, null, null)).toEqual({ status: 'none' })
  })

  it('says when there is no recording, and offers Retry when loading failed', () => {
    expect(view({ status: 'none' })).toContain('No recording for this interview.')
    const failed = view({ status: 'error', message: 'The recording could not be loaded.' }, () => {})
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('>Retry</button>')
    expect(failed).not.toContain('<video')
  })
})

describe('Interview report tab order', () => {
  function app(over: Partial<EmployerApplicant>): EmployerApplicant {
    return {
      id: 'kav',
      jobId: 'job-fe',
      jobTitle: 'Frontend Engineer',
      company: 'Acme',
      candidateName: 'Kavya Iyer',
      candidateEmail: 'kavya@example.com',
      experienceYears: '4 years',
      resumeName: 'Kavya_Iyer_Resume.pdf',
      resumeText: 'SKILLS\nReact, TypeScript',
      appliedAt: '2026-11-19T12:00:00Z',
      status: 'New',
      recordSource: 'application',
      aiScore: 72,
      ...over,
    }
  }

  function panel(applicant: EmployerApplicant) {
    const noop = () => {}
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(ApplicantResumePanel, {
        row: indexApplicant(applicant),
        terms: [],
        position: { index: 0, total: 1 },
        tab: 'report',
        onTab: noop,
        onClose: noop,
        onShortlist: noop,
        onInvite: noop,
        onDownload: noop,
        onOpenFullReport: noop,
        now: Date.parse('2026-11-20T12:00:00Z'),
      })),
    )
  }

  it('reads the scorecard, then the interview video, and the video section appears exactly once', () => {
    const html = panel(app({ interviewResult: result() }))
    const report = html.indexOf('id="report-summary-heading"')
    const video = html.indexOf('data-testid="interview-video"')
    expect(report).toBeGreaterThan(-1)
    expect(html).not.toContain('data-testid="questions-asked"')
    expect(html).not.toContain('Questions asked')
    expect(video).toBeGreaterThan(report)
    expect(html.match(/data-testid="interview-video"/g)).toHaveLength(1)
    expect(html.match(/data-testid="proctor-timeline"/g) ?? []).toHaveLength(0) // still loading: no second bar anywhere
    expect(html).not.toContain('Interview recording and proctoring timeline')
    expect(html).toContain('aria-label="On this tab"')
  })

  it('with no session id the video section says there is no recording', () => {
    const html = panel(app({ interviewResult: result({ sessionId: undefined }) }))
    expect(html).toContain('No recording for this interview.')
  })

  it('a candidate not interviewed keeps the single empty state and no new sections', () => {
    const html = panel(app({ aiScore: undefined, interviewResult: undefined }))
    expect(html).toContain('data-testid="report-empty"')
    expect(html).not.toContain('data-testid="questions-asked"')
    expect(html).not.toContain('data-testid="interview-video"')
  })
})
