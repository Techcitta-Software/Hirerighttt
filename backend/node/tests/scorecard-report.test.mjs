import test from 'node:test'
import assert from 'node:assert/strict'
import { buildScorecardViewModel } from '../reports/scorecardViewModel.mjs'
import { renderCareerScorecardHtml } from '../reports/renderCareerScorecardHtml.mjs'
import { htmlToPdfBuffer } from '../reports/htmlToPdf.mjs'
import { persistInterviewReportPdfBuffer } from '../storage/interviewArtifactStorage.mjs'
import { generateAndPersistInterviewReportPdf } from '../reports/generateInterviewReportPdf.mjs'

const fixtureResult = {
  role: 'Full Stack Engineer',
  level: '1–3 years',
  date: '2026-10-22T10:00:00.000Z',
  overall: 12,
  categories: [
    { label: 'Answer Correctness', score: 0 },
    { label: 'Depth', score: 16 },
    { label: 'Communication', score: 31 },
  ],
  strengths: ['Shows willingness to learn'],
  improvements: ['Expand answers to roughly 50–150 words with concrete examples'],
  scorecard: {
    careerScore: 120,
    finalCareerStatus: 'Skill Enhancement Recommended',
    industryAlignment: 34,
    coachNotes: 'Focus on fundamentals and structured examples.',
    sessionStats: {
      durationMinutes: 1,
      questionCount: 1,
      overallInterviewScore: 12,
      interviewType: 'Full Stack Engineer · Adaptive AI Interview',
    },
    qaRows: [
      {
        index: 1,
        topic: 'Misc',
        question: 'Explain OOP encapsulation vs abstraction.',
        accuracy: 0,
        clarity: 3,
        depth: 1,
        total30: 4,
        stars: '★☆☆☆☆',
        feedback: 'Answer was too brief for a technical depth question.',
      },
    ],
    donuts: [
      { label: 'Answer Correctness', score: 0, tag: 'Needs work', color: '#dc2626' },
      { label: 'Depth', score: 16, tag: 'Needs work', color: '#dc2626' },
      { label: 'Communication', score: 31, tag: 'Developing', color: '#dc2626' },
    ],
    healthMetrics: [
      { label: 'Answer Correctness', score: 0, tag: 'Needs work', color: '#dc2626' },
      { label: 'Depth', score: 16, tag: 'Needs work', color: '#dc2626' },
      { label: 'Communication', score: 31, tag: 'Developing', color: '#dc2626' },
    ],
    priorities: [{ num: 1, title: 'Expand answers', text: 'Expand answers to roughly 50–150 words with concrete examples.' }],
    recommendedRoles: ['Full Stack Engineer', 'Backend Specialist Team'],
    nextRecommendedStep: 'Expand answers to roughly 50–150 words with concrete examples.',
  },
}

test('buildScorecardViewModel mirrors career score from scorecard', () => {
  const vm = buildScorecardViewModel({ result: fixtureResult, candidateName: 'Arjun Sharma' })
  assert.equal(vm.careerScore, 120)
  assert.equal(vm.candidateName, 'Arjun Sharma')
  assert.equal(vm.qaRows.length, 1)
  assert.match(vm.candidateId, /^HRT-AI-IND-/)
})

test('renderCareerScorecardHtml includes scorecard sections', () => {
  const html = renderCareerScorecardHtml({ result: fixtureResult, candidateName: 'Arjun Sharma' })
  assert.match(html, /HireRight Career Score/)
  assert.match(html, /120/)
  assert.match(html, /encapsulation vs abstraction/)
  assert.match(html, /Career Coach Notes/)
  assert.match(html, /<style>/)
})

test('htmlToPdfBuffer produces a PDF when Playwright is available', async (t) => {
  if (process.env.SCORECARD_PDF_DISABLED === '1') {
    t.skip('SCORECARD_PDF_DISABLED')
  }
  const html = renderCareerScorecardHtml({ result: fixtureResult, candidateName: 'Test User' })
  try {
    const buf = await htmlToPdfBuffer(html)
    assert.equal(buf.slice(0, 4).toString(), '%PDF')
    assert.ok(buf.length > 2000)
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'PLAYWRIGHT_MISSING') {
      t.skip('Playwright not installed')
    }
    throw err
  }
})

test('generateAndPersistInterviewReportPdf uploads via mock S3', async () => {
  const uploaded = []
  const mockS3 = {
    async uploadObject({ key, buffer, contentType }) {
      uploaded.push({ key, size: buffer.length, contentType })
      return { bucket: 'test-bucket', etag: 'x' }
    },
    async presignDownload() {
      return { url: 'https://example.test/file.pdf' }
    },
  }
  const sessionId = 'scorecard-test-session-01'
  const db = {
    interviewSessions: {
      [sessionId]: { email: 'demo@hireright.com', organizationId: 'org-platform' },
    },
    profiles: {},
    users: [],
  }
  const pool = /** @type {import('pg').Pool} */ ({ query: async () => ({ rows: [] }) })

  process.env.S3_BUCKET = process.env.S3_BUCKET || 'hirerighttt-tests'
  process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1'

  if (process.env.SCORECARD_PDF_DISABLED === '1') {
    return
  }

  try {
    const out = await generateAndPersistInterviewReportPdf({
      pool,
      db,
      requesterEmail: 'demo@hireright.com',
      sessionId,
      result: fixtureResult,
      candidateName: 'Arjun Sharma',
      s3: mockS3,
    })
    assert.match(out.objectKey, /reports\/interview_report\.pdf$/)
    assert.equal(uploaded.length, 1)
    assert.equal(uploaded[0].contentType, 'application/pdf')
    assert.ok(uploaded[0].size > 2000)
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'PLAYWRIGHT_MISSING') {
      return
    }
    throw err
  }
})

test('persistInterviewReportPdfBuffer rejects non-PDF bytes', async () => {
  const db = {
    interviewSessions: { s1: { email: 'a@b.com' } },
  }
  await assert.rejects(
    () =>
      persistInterviewReportPdfBuffer({
        pool: /** @type {any} */ ({}),
        db,
        requesterEmail: 'a@b.com',
        sessionId: 's1',
        buffer: Buffer.from('not-a-pdf'),
      }),
    /PDF/,
  )
})
