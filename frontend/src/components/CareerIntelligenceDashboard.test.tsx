import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { InterviewResult } from '../lib/store'
import { CareerIntelligenceDashboard } from './CareerIntelligenceDashboard'

const QUESTION = 'Explain how the Node.js event loop handles many concurrent requests.'

const result = {
  role: 'Backend Developer',
  level: '3-5 years',
  date: '2026-11-20T10:00:00Z',
  overall: 72,
  categories: [{ label: 'Correctness', score: 74 }],
  strengths: ['Clear explanation of the event loop.'],
  improvements: ['Add measurable outcomes.'],
  answers: [],
  scorecard: {
    careerScore: 720,
    finalCareerStatus: 'Industry Ready',
    qaRows: [
      {
        index: 1,
        topic: 'Node.js',
        question: QUESTION,
        questionScore: 80,
        stars: '★★★★☆',
        feedback: 'Good answer.',
      },
    ],
  },
} as unknown as InterviewResult

const renderReport = (r: InterviewResult) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CareerIntelligenceDashboard, { result: r, candidateName: 'Priya Nair' }),
    ),
  )

describe('interview report', () => {
  it('keeps the career score report: 0-1000 score, status, summary sections, and download', () => {
    const html = renderReport(result)
    expect(html).toContain('720')
    expect(html).toContain('/1000')
    expect(html).toContain('Industry Ready')
    expect(html).toContain('Score bands')
    expect(html).toContain('Score by area')
    expect(html).toContain('Top strengths')
    expect(html).toContain('Top growth areas')
    expect(html).toContain('What to work on')
    expect(html).toContain('Coach notes')
    expect(html).toContain('Resume suggestions')
    expect(html).toContain('Final career status')
    expect(html).toContain('Download report')
    // The question count stat in the summary is still shown.
    expect(html).toMatch(/<dt>Questions<\/dt><dd>1<\/dd>/)
  })

  it('never renders the questions table or the question / feedback text', () => {
    const html = renderReport(result)
    expect(html).not.toContain('Questions and scores')
    expect(html).not.toContain('<table')
    expect(html).not.toContain(QUESTION)
    expect(html).not.toContain('Good answer.')
  })

  it('still renders the interview performance summary (rating by topic) as the card heading', () => {
    const html = renderReport(result)
    expect(html).toMatch(/<h2 id="report-performance-heading"[^>]*>Interview performance summary<\/h2>/)
    expect(html).toContain('aria-labelledby="report-performance-heading"')
    expect(html).toContain('Node.js')
    expect(html).toContain('★★★★☆')
    expect(html).toContain('4 of 5 stars')
    expect(html).toContain('Strong')
  })

  it('renders no empty performance card when there is nothing to rate', () => {
    const empty = {
      ...result,
      answers: [],
      scorecard: { ...result.scorecard, qaRows: [], starPatterns: [] },
    } as unknown as InterviewResult
    const html = renderReport(empty)
    expect(html).not.toContain('Interview performance summary')
    expect(html).not.toContain('report-performance-heading')
    expect(html).toContain('Top strengths')
  })
})
