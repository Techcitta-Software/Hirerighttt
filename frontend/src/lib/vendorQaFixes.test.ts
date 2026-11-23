/** Regression tests for bugs found in the vendor-side QA pass (real API data shapes). */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_APPLICANT_FILTERS,
  experienceLabel,
  experienceYearsOf,
  fitBucketOf,
  indexApplicant,
  jobIdsOf,
  readApplicantsUrl,
  resumeHeadline,
  searchApplicants,
} from './applicantSearch'
import { needsIntegrityReview } from './candidateSearch'
import { normalizeFlagSections, proctoringNeedsReview } from './reviewEventsToFlagSections'
import type { EmployerApplicant } from './store'

/* What /api/interview/score + persist_proctoring_flags store when the camera raised review events. */
const SERVER_PROCTORING = {
  integrityScore: 85,
  status: 'REVIEW',
  counts: { total: 3, noFace: 1, lookingSide: 1, multiplePeople: 1 },
  flaggedSections: [
    { id: 'ev-1', type: 'MULTIPLE_FACES_DETECTED', startOffsetSec: 95, durationSec: 12, peakMetrics: { faceCount: 2 } },
    { id: 'ev-2', type: 'NO_FACE_SEEN', startOffsetSec: 260, durationSec: 20, peakMetrics: { faceCount: 1 } },
    { id: 'ev-3', type: 'SIDE_GAZE_LOOKING_AWAY', startOffsetSec: 410, durationSec: 9, peakMetrics: { faceCount: 1 } },
  ],
}

function app(over: Partial<EmployerApplicant>): EmployerApplicant {
  return {
    id: 'a',
    jobId: 'job-fe',
    jobTitle: 'Frontend Engineer',
    company: 'Acme',
    candidateName: 'Someone',
    candidateEmail: 's@x.test',
    candidatePhone: '',
    experienceYears: '',
    resumeName: null,
    resumeText: '',
    appliedAt: new Date().toISOString(),
    status: 'New',
    ...over,
  } as EmployerApplicant
}

describe('proctoring flags as the server stores them', () => {
  it('status REVIEW (not only FLAGGED) means the interview needs integrity review', () => {
    expect(proctoringNeedsReview(SERVER_PROCTORING)).toBe(true)
    expect(proctoringNeedsReview({ status: 'CLEAR', counts: { total: 0 } })).toBe(false)
    const a = app({ interviewResult: { overall: 56, integrity: { faceViolations: 0, proctoring: SERVER_PROCTORING } } as never })
    expect(needsIntegrityReview(a)).toBe(true)
  })

  it('the "Has proctoring flags" filter finds them and has a count', () => {
    const rows = [
      app({ id: 'flagged', interviewResult: { overall: 56, integrity: { proctoring: SERVER_PROCTORING } } as never }),
      app({ id: 'clean', interviewResult: { overall: 70, integrity: { proctoring: { status: 'CLEAR', counts: { total: 0 }, flaggedSections: [] } } } as never }),
    ].map(indexApplicant)
    const all = searchApplicants(rows, EMPTY_APPLICANT_FILTERS, 'relevance')
    expect(all.facets.lists.review).toBe(1)
    const only = searchApplicants(rows, { ...EMPTY_APPLICANT_FILTERS, integrityReviewOnly: true }, 'relevance')
    expect(only.rows.map((r) => r.applicant.id)).toEqual(['flagged'])
  })

  it('server-shaped flagged sections get the right labels and finite times (was "Looking away" and NaN:NaN)', () => {
    const out = normalizeFlagSections(SERVER_PROCTORING.flaggedSections)
    expect(out.map((f) => f.type)).toEqual(['MULTI_FACE', 'NO_FACE', 'LOOKING_SIDE'])
    expect(out[0]).toMatchObject({ startSec: 95, endSec: 107, durationSec: 12, severity: 'high', turnIndex: 0 })
    expect(out.every((f) => Number.isFinite(f.startSec) && Number.isFinite(f.endSec))).toBe(true)
  })

  it('sections already in the UI shape pass through; junk is dropped', () => {
    const ui = { id: 'f', type: 'NO_FACE', severity: 'medium', turnIndex: 2, questionText: 'q', startSec: 5, endSec: 9, durationSec: 4, reason: 'r' }
    expect(normalizeFlagSections([ui, null, { type: 'NOPE', startSec: 1 }, { type: 'NO_FACE' }])).toEqual([{ ...ui, peakMetrics: {} }])
  })
})

describe('one row per applicant who applied to several jobs', () => {
  it('the job filter and its counts include every job they applied to', () => {
    const rows = [
      app({ id: 'rahul', jobId: 'job-fe', appliedJobIds: ['job-be', 'job-fe'] }),
      app({ id: 'kavya', jobId: 'job-fe' }),
    ].map(indexApplicant)
    const be = searchApplicants(rows, { ...EMPTY_APPLICANT_FILTERS, jobs: ['job-be'] }, 'relevance', { jobTitles: { 'job-be': 'Backend', 'job-fe': 'Frontend' } })
    expect(be.rows.map((r) => r.applicant.id)).toEqual(['rahul'])
    const counts = Object.fromEntries(be.facets.jobs.map((j) => [j.value, j.count]))
    expect(counts).toEqual({ 'job-be': 1, 'job-fe': 2 })
    // Stable, alphabetical order of job options (they no longer jump when counts change).
    expect(be.facets.jobs.map((j) => j.label)).toEqual(['Backend', 'Frontend'])
    expect(jobIdsOf(app({ jobId: 'x' }))).toEqual(['x'])
  })
})

describe('experience from the resume when the application has none', () => {
  it('reads "N years of experience" and never guesses', () => {
    expect(experienceYearsOf({ experienceYears: '', resumeText: 'Software engineer with 9 years of experience.' })).toBe(9)
    expect(experienceYearsOf({ experienceYears: '', resumeText: '5+ yrs of professional experience' })).toBe(5)
    expect(experienceYearsOf({ experienceYears: '', resumeText: 'Graduated 2019. Skills: React' })).toBeNull()
    expect(experienceYearsOf({ experienceYears: '3', resumeText: '9 years of experience' })).toBe(3)
    const row = indexApplicant(app({ resumeText: 'X\nSUMMARY\nEngineer with 7 years of experience.' }))
    expect(experienceLabel(row)).toBe('7 yrs')
  })
})

describe('resume headline (title / company / location on the row)', () => {
  it('parses "title at company | city" and "title | city | email"', () => {
    expect(resumeHeadline('Neha Gupta\nSenior Software Engineer at Flipside Tech | Bengaluru\nSUMMARY')).toEqual({
      title: 'Senior Software Engineer',
      company: 'Flipside Tech',
      location: 'Bengaluru',
    })
    expect(resumeHeadline('Kavya Iyer\nFrontend Developer | Chennai, India | kavya@example.com | +91 98400 11223')).toEqual({
      title: 'Frontend Developer',
      company: '',
      location: 'Chennai, India',
    })
  })

  it('gives nothing when the resume has no headline line', () => {
    expect(resumeHeadline('Pune\nSkills: React, Vue')).toEqual({ title: '', company: '', location: '' })
    expect(resumeHeadline('')).toEqual({ title: '', company: '', location: '' })
    expect(resumeHeadline('Name\nSKILLS | React | Vue')).toEqual({ title: '', company: '', location: '' })
  })
})

describe('score and skills-fit filters use the same cut-offs', () => {
  it('80 / 60 / 40 for both', () => {
    expect([85, 79, 60, 59, 40, 39].map(fitBucketOf)).toEqual(['80+', '60-79', '60-79', '40-59', '40-59', '<40'])
    expect(readApplicantsUrl(new URLSearchParams('fit=60-79&fit=75%2B')).filters.fit).toEqual(['60-79'])
  })
})
