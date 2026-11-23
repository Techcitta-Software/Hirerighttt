import { describe, expect, it } from 'vitest'
import {
  EMPTY_APPLICANT_FILTERS,
  activeFilterChips,
  applicantSkills,
  applicantsToCsv,
  formatExperience,
  highlightParts,
  indexApplicant,
  keywordSnippet,
  parseKeywordQuery,
  readApplicantsUrl,
  resultRangeLabel,
  resumeEducation,
  searchApplicants,
  writeApplicantsUrl,
  type ApplicantFilters,
} from './applicantSearch'
import type { EmployerApplicant } from './store'
import { buildZip, uniqueZipNames } from './zipStore'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

function app(over: Partial<EmployerApplicant>): EmployerApplicant {
  return {
    id: 'a',
    jobId: 'job-fe',
    jobTitle: 'Frontend Engineer',
    company: 'Acme',
    candidateName: 'Someone',
    candidateEmail: 'someone@example.com',
    candidatePhone: '',
    experienceYears: '3 years',
    resumeName: 'cv.pdf',
    resumeText: '',
    appliedAt: daysAgo(1),
    status: 'New',
    recordSource: 'application',
    ...over,
  }
}

const interview = (overall: number, flags = 0, fit?: number) =>
  ({
    role: 'x',
    level: 'mid',
    date: daysAgo(2),
    overall,
    categories: [],
    strengths: [],
    improvements: [],
    answers: [],
    ...(fit !== undefined
      ? { roleSkillsAnalysis: { fitScore: fit, requiredSkills: ['React'], onResume: ['React'], evidencedInAnswers: [], resumeMatchCount: 1, answerMatchCount: 0 } }
      : {}),
    integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1, proctoring: { integrityScore: 90, status: flags ? 'FLAGGED' : 'CLEAR', counts: { total: flags, lookingSide: flags, multiplePeople: 0, noFace: 0 }, flaggedSections: [] } },
  }) as unknown as EmployerApplicant['interviewResult']

const ROWS = [
  app({ id: 'ana', candidateName: 'Ananya Rao', role: 'Frontend Developer', experienceYears: '6 years', resumeText: 'Bengaluru\nSKILLS\nReact, TypeScript, CSS\n\nEDUCATION\nB.Tech, NIT Surathkal', interviewResult: interview(86, 0, 92), appliedAt: daysAgo(2) }),
  app({ id: 'rah', candidateName: 'Rahul Menon', role: 'Frontend Developer', experienceYears: '4', resumeText: 'Pune\nSkills: React, Vue', interviewResult: interview(74, 3, 60), appliedAt: daysAgo(5) }),
  app({ id: 'vik', jobId: 'job-be', jobTitle: 'Backend Engineer', candidateName: 'Vikram Shah', role: 'Backend Developer', experienceYears: '3 yrs', resumeText: 'Hyderabad\nSKILLS\nPython, FastAPI', interviewResult: interview(81, 0, 85), appliedAt: daysAgo(9) }),
  app({ id: 'div', jobId: '', jobTitle: '', recordSource: 'vault', candidateName: 'Divya Nair', role: 'QA Lead', experienceYears: '7 years', resumeText: 'Kochi. Angular and React tester', primarySkills: ['Selenium', 'Cypress'], appliedAt: daysAgo(40) }),
]
const INDEXED = ROWS.map(indexApplicant)
const run = (f: Partial<ApplicantFilters>, sort: Parameters<typeof searchApplicants>[2] = 'relevance') =>
  searchApplicants(INDEXED, { ...EMPTY_APPLICANT_FILTERS, ...f }, sort, { now: NOW, jobTitles: { 'job-fe': 'Frontend Engineer', 'job-be': 'Backend Engineer' } })
const ids = (r: ReturnType<typeof run>) => r.rows.map((x) => x.applicant.id)

describe('keyword query', () => {
  it('parses AND, OR, quoted phrases, commas and exclusions', () => {
    expect(parseKeywordQuery('react AND "design system" OR vue, -intern')).toEqual({
      clauses: [['react'], ['design system', 'vue']],
      exclude: ['intern'],
    })
    expect(parseKeywordQuery('  ')).toEqual({ clauses: [], exclude: [] })
  })

  it('requires every word, accepts either side of OR and drops excluded words', () => {
    expect(ids(run({ keywords: 'react typescript' }))).toEqual(['ana'])
    expect(ids(run({ keywords: 'python OR vue' })).sort()).toEqual(['rah', 'vik'])
    // Divya mentions Angular, so she is left out (the others have React on the resume or in the interview).
    expect(ids(run({ keywords: 'react -angular' })).sort()).toEqual(['ana', 'rah', 'vik'])
  })

  it('highlights phrases before their own words and escapes regex characters', () => {
    expect(highlightParts('Node.js and C++', ['c++', 'node.js'])).toEqual([
      { text: 'Node.js', match: true },
      { text: ' and ', match: false },
      { text: 'C++', match: true },
    ])
  })

  it('cuts the resume snippet at word boundaries around the first hit', () => {
    const s = keywordSnippet('alpha beta gamma delta react epsilon zeta eta theta', ['react'], 12)
    expect(s).toBe('…delta react…')
    expect(keywordSnippet('react is here', ['react'])).toBe('react is here')
  })
})

describe('derived fields', () => {
  it('reads the candidate skills, not the job skills of an application', () => {
    const withJobSkills = app({ primarySkills: ['Go'], resumeText: 'SKILLS\nReact | Node.js' })
    expect(applicantSkills(withJobSkills)).toEqual(['React', 'Node.js'])
    expect(applicantSkills(ROWS[3])).toContain('Selenium') // vault rows: profile skills are theirs
  })

  it('formats experience consistently and finds the education line', () => {
    expect(formatExperience('6 years')).toBe('6 yrs')
    expect(formatExperience('0.5')).toBe('<1 yr')
    expect(formatExperience('1')).toBe('1 yr')
    expect(formatExperience('10+ years')).toBe('10+ yrs')
    expect(formatExperience('Fresher')).toBe('Fresher')
    expect(resumeEducation(ROWS[0].resumeText)).toBe('B.Tech, NIT Surathkal')
  })
})

describe('filters and facets', () => {
  it('filters by job, interview status, score, skills fit, skills, experience, location and activity', () => {
    expect(ids(run({ jobs: ['job-be'] }))).toEqual(['vik'])
    expect(ids(run({ interview: ['not_interviewed'] }))).toEqual(['div'])
    expect(ids(run({ score: ['80+'] })).sort()).toEqual(['ana', 'vik'])
    expect(ids(run({ fit: ['60-79'] }))).toEqual(['rah'])
    expect(ids(run({ skills: ['react', 'TypeScript'] }))).toEqual(['ana'])
    expect(ids(run({ expMin: '4', expMax: '6' })).sort()).toEqual(['ana', 'rah'])
    expect(ids(run({ location: 'pune' }))).toEqual(['rah'])
    // The interview (2 days ago) counts as activity, so Vikram is active though he applied 9 days ago.
    expect(ids(run({ activeWithin: 7 })).sort()).toEqual(['ana', 'rah', 'vik'])
    expect(ids(run({ activeWithin: 30 })).sort()).toEqual(['ana', 'rah', 'vik'])
    expect(ids(run({ integrityReviewOnly: true }))).toEqual(['rah'])
  })

  it('counts each facet without its own filter (so other values stay selectable)', () => {
    const r = run({ jobs: ['job-be'] })
    expect(r.facets.jobs.find((j) => j.value === 'job-fe')?.count).toBe(2)
    expect(r.facets.interview.find((i) => i.value === 'completed')?.count).toBe(1)
  })

  it('lists applied filters as removable chips', () => {
    const chips = activeFilterChips({ ...EMPTY_APPLICANT_FILTERS, keywords: 'react', jobs: ['job-fe'], expMin: '3' }, { jobs: { 'job-fe': 'Frontend Engineer' } })
    expect(chips.map((c) => c.label)).toEqual(['Keywords: react', 'Experience: 3+ yrs', 'Frontend Engineer'])
    expect(chips[2].clear).toEqual({ jobs: [] })
  })
})

describe('sorting', () => {
  it('sorts by interview score, skills fit, recency and experience', () => {
    expect(ids(run({}, 'score'))).toEqual(['ana', 'vik', 'rah', 'div'])
    expect(ids(run({}, 'fit'))).toEqual(['ana', 'vik', 'rah', 'div'])
    expect(ids(run({}, 'recent'))).toEqual(['ana', 'rah', 'vik', 'div'])
    expect(ids(run({}, 'experience'))).toEqual(['div', 'ana', 'rah', 'vik'])
  })

  it('relevance puts stronger keyword matches first', () => {
    // "Frontend" is in Ananya's and Rahul's role; Vikram only has it in the job title of nobody.
    expect(ids(run({ keywords: 'react' }))[0]).toBe('ana')
  })
})

describe('URL state', () => {
  it('round-trips every part of the view and drops defaults', () => {
    const state = {
      filters: { ...EMPTY_APPLICANT_FILTERS, keywords: 'react "design system"', jobs: ['job-fe'], skills: ['React'], score: ['80+' as const], activeWithin: 30 as const, savedOnly: true },
      sort: 'score' as const,
      page: 2,
      applicant: 'ana',
      tab: 'report' as const,
    }
    const params = writeApplicantsUrl(state)
    expect(readApplicantsUrl(new URLSearchParams(params.toString()))).toEqual(state)
    expect(writeApplicantsUrl(readApplicantsUrl(new URLSearchParams())).toString()).toBe('')
  })

  it('accepts the ?jobId= links from application alerts and ignores junk values', () => {
    const s = readApplicantsUrl(new URLSearchParams('jobId=j1&sort=bogus&page=-3&tab=x&score=99&active=12'))
    expect(s.filters.jobs).toEqual(['j1'])
    expect(s.sort).toBe('relevance')
    expect(s.page).toBe(1)
    expect(s.tab).toBe('resume')
    expect(s.filters.score).toEqual([])
    expect(s.filters.activeWithin).toBe(0)
  })
})

describe('exports', () => {
  it('writes CSV with escaping, no formula injection and no hidden contact details', () => {
    const rows = [
      indexApplicant(app({ candidateName: '=HYPERLINK("x")', role: 'Dev, "Senior"' })),
      indexApplicant(app({ id: 'h', candidateName: 'Hidden', candidateEmail: 'h@example.com', contactHidden: true })),
    ]
    const csv = applicantsToCsv(rows)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"Dev, ""Senior"""')
    expect(csv).not.toContain('h@example.com')
  })

  it('builds a valid stored zip with unique names', () => {
    expect(uniqueZipNames(['a.pdf', 'A.pdf', 'b/c.pdf'])).toEqual(['a.pdf', 'A (2).pdf', 'b_c.pdf'])
    const blob = buildZip([{ name: 'x.txt', data: new TextEncoder().encode('hello') }])
    expect(blob.type).toBe('application/zip')
    expect(blob.size).toBe(30 + 5 + 5 + 46 + 5 + 22)
  })

  it('labels the result range', () => {
    expect(resultRangeLabel(1, 20, 134)).toBe('Showing 1–20 of 134 applicants')
    expect(resultRangeLabel(7, 20, 134)).toBe('Showing 121–134 of 134 applicants')
    expect(resultRangeLabel(1, 20, 0)).toBe('No applicants found')
  })
})
