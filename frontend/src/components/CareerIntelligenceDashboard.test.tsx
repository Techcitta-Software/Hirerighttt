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
  categories: [
    { label: 'Correctness', score: 74 },
    { label: 'Role Skills Fit', score: 67 },
  ],
  strengths: ['Clear explanation of the event loop.'],
  improvements: ['Add measurable outcomes.'],
  answers: [],
  resumeFitScore: 67,
  proctorScorePenalty: 5,
  scoreBeforeProctorPenalty: 77,
  roleSkillsAnalysis: {
    fitScore: 67,
    requiredSkills: ['Node.js', 'PostgreSQL', 'REST APIs'],
    onResume: ['Node.js', 'PostgreSQL'],
    evidencedInAnswers: ['Node.js'],
    resumeMatchCount: 2,
    answerMatchCount: 1,
    skills: [
      { skill: 'Node.js', onResume: true, demonstrated: true, points: 100, status: 'matched' },
      { skill: 'PostgreSQL', onResume: true, demonstrated: false, points: 40, status: 'partial' },
      { skill: 'REST APIs', onResume: false, demonstrated: true, points: 60, status: 'partial' },
    ],
    method: 'Each required skill earns 40 points when it is on the resume and 60 points when demonstrated.',
  },
  scorecard: {
    // A report saved before the change: the old 0-1000 career score and tier label must not be shown.
    careerScore: 720,
    finalCareerStatus: 'Industry Ready',
    industryAlignment: 67,
    donuts: [],
    healthMetrics: [],
    qaRows: [
      {
        index: 1,
        topic: 'Node.js',
        question: QUESTION,
        questionScore: 80,
        accuracy: 8,
        clarity: 8,
        understanding: 8,
        depth: 8,
        total40: 24,
        stars: '★★★★☆',
        feedback: 'Good answer.',
      },
    ],
    radarAxes: [],
    careerPaths: [],
    starPatterns: [],
    priorities: [],
    coachNotes: 'Keep going.',
    sessionStats: { durationMinutes: 18, questionCount: 1, overallInterviewScore: 72, interviewType: 'Backend' },
  },
} as unknown as InterviewResult

function render(variant?: 'summary' | 'detailed') {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CareerIntelligenceDashboard, { result, candidateName: 'Priya Nair', variant }),
    ),
  )
}

describe('interview report', () => {
  it('the one-pager (default) does not list the questions asked', () => {
    const html = render()
    expect(html).toContain('data-report-variant="summary"')
    expect(html).not.toContain(QUESTION)
    expect(html).not.toContain('Questions and scores')
  })

  it('the detailed report on the profile keeps the question-by-question breakdown', () => {
    const html = render('detailed')
    expect(html).toContain(QUESTION)
    expect(html).toContain('Questions and scores')
  })

  it('shows one career score equal to the interview score, with no bands or tiers', () => {
    const html = render()
    expect(html).toContain('72')
    expect(html).not.toContain('/1000')
    expect(html).not.toContain('720')
    for (const tier of ['Industry Ready', 'Industry ready', 'Premium', 'Growth potential', 'Score bands', 'percentile']) {
      expect(html).not.toContain(tier)
    }
  })

  it('shows the proctoring deduction transparently', () => {
    expect(render()).toContain('−5 point camera proctoring deduction (77/100 before the deduction)')
  })

  it('explains role skills fit skill by skill from the API analysis', () => {
    const html = render()
    expect(html).toContain('PostgreSQL')
    expect(html).toContain('40/100')
    expect(html).toContain('Not on résumé')
    expect(html).toContain('Each required skill earns 40 points')
  })
})

/* Vendor QA P0: the recruiter's view of the report (Applicants drawer, recruiter report modal). */
function renderRecruiter() {
  const withAreas = {
    ...result,
    scorecard: { ...result.scorecard, healthMetrics: [{ label: 'Depth', score: 75 }, { label: 'Communication', score: 55 }] },
    categories: [{ label: 'Depth', score: 75 }],
  } as unknown as InterviewResult
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CareerIntelligenceDashboard, {
        result: withAreas,
        candidateName: 'Priya Nair',
        variant: 'detailed',
        audience: 'recruiter',
        embedded: true,
      }),
    ),
  )
}

describe('recruiter view of the interview report', () => {
  it('has no level words or band legend, only the numbers', () => {
    const html = renderRecruiter()
    for (const word of ['Strong', 'Moderate', 'Developing', 'Needs work', '75%+', '50–74%']) {
      expect(html).not.toContain(word)
    }
    expect(html).toContain('Bars show score out of 100')
    expect(html).toContain('75%')
  })

  it('drops the candidate-only content', () => {
    const html = renderRecruiter()
    for (const text of [
      'Your career score is your interview score.',
      'Resume visibility',
      'Private, not shared',
      'kept private and not shared with recruiters',
      'Career track',
      'Recommended for',
      'Download report',
      'Coach notes',
      'Resume suggestions',
    ]) {
      expect(html).not.toContain(text)
    }
    // Still the recruiter's essentials.
    expect(html).toContain('Interview score')
    expect(html).toContain('Questions and scores')
    expect(html).toContain('Top strengths')
  })

  it('the candidate view keeps its labels (owner decision pending)', () => {
    const html = render()
    expect(html).toContain('Your career score is your interview score.')
    expect(html).toContain('Download report')
  })
})
