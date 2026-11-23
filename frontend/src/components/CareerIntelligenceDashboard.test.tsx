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

describe('interview report', () => {
  it('keeps the career score report: 0-1000 score, status, questions, and download', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(CareerIntelligenceDashboard, { result, candidateName: 'Priya Nair' }),
      ),
    )
    expect(html).toContain('720')
    expect(html).toContain('/1000')
    expect(html).toContain('Industry Ready')
    expect(html).toContain('Questions and scores')
    expect(html).toContain(QUESTION)
    expect(html).toContain('Download report')
  })
})
