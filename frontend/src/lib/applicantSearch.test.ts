import { describe, expect, it } from 'vitest'
import {
  CANDIDATE_EXPERIENCE_PRESETS,
  EMPTY_APPLICANT_FILTERS,
  activeFilterChips,
  applicantSkills,
  applicantsToCsv,
  filtersForApplicantSearch,
  formatExperience,
  highlightParts,
  indexApplicant,
  keywordSnippet,
  panelTabFromParam,
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

  it('puts 2.5 and 5.5 years in one shared-edge bucket and keeps a custom range inclusive', () => {
    const years = ['0', '0.5', '1', '2.5', '3', '5', '5.5', '6', '8', '9']
    const people = years.map((y) => indexApplicant(app({ id: y, experienceYears: y })))
    const bucket = (y: string) =>
      CANDIDATE_EXPERIENCE_PRESETS.filter(
        (p) =>
          searchApplicants(people, { ...EMPTY_APPLICANT_FILTERS, expMin: p.min, expMax: p.max }, 'relevance').rows.some(
            (r) => r.applicant.id === y,
          ),
      ).map((p) => p.id)
    expect(bucket('0')).toEqual(['0-1'])
    expect(bucket('0.5')).toEqual(['0-1'])
    expect(bucket('1')).toEqual(['1-3'])
    expect(bucket('2.5')).toEqual(['1-3'])
    expect(bucket('3')).toEqual(['3-5'])
    expect(bucket('5')).toEqual(['5-8'])
    expect(bucket('5.5')).toEqual(['5-8'])
    expect(bucket('6')).toEqual(['5-8'])
    expect(bucket('8')).toEqual(['8+'])
    expect(bucket('9')).toEqual(['8+'])
    // Not a preset: 6 years is included in max 6.
    expect(ids(run({ expMin: '4', expMax: '6' })).sort()).toEqual(['ana', 'rah'])
  })

  it('matches cities on the resume and role, with aliases and word boundaries', () => {
    const people = [
      app({ id: 'blr', role: 'Engineer', resumeText: 'Lives in Bangalore' }),
      app({ id: 'ncr', role: 'Engineer, Gurugram', resumeText: 'hello' }),
      app({ id: 'no', role: 'Dev', resumeText: 'I like punes and paranoida' }),
      app({ id: 'pun', role: '', resumeText: 'Based in Pune.' }),
    ].map(indexApplicant)
    const found = (cities: string[]) =>
      searchApplicants(people, { ...EMPTY_APPLICANT_FILTERS, cities }, 'relevance').rows.map((r) => r.applicant.id).sort()
    expect(found(['Bengaluru'])).toEqual(['blr'])
    expect(found(['Delhi NCR'])).toEqual(['ncr'])
    expect(found(['Pune'])).toEqual(['pun'])
    expect(found(['Bengaluru', 'Pune'])).toEqual(['blr', 'pun'])
    expect(people.find((r) => r.applicant.id === 'no')?.cities).toEqual([])
  })

  it('groups roles case-insensitively, falls back to the headline, and counts without its own filter', () => {
    const people = [
      app({ id: 'a', role: 'Frontend Developer', resumeText: 'x' }),
      app({ id: 'b', role: 'frontend developer', resumeText: 'y' }),
      app({ id: 'c', role: '', resumeText: 'Neha Gupta\nQA Engineer at Acme | Pune' }),
      app({ id: 'd', role: '   ', resumeText: 'No headline here' }),
    ].map(indexApplicant)
    const result = searchApplicants(people, EMPTY_APPLICANT_FILTERS, 'relevance')
    expect(result.facets.roles.find((r) => r.value === 'frontend developer')).toMatchObject({ label: 'Frontend Developer', count: 2 })
    expect(result.facets.roles.find((r) => r.value === 'qa engineer')?.count).toBe(1)
    expect(result.facets.roles.some((r) => r.value === '')).toBe(false)
    expect(people.find((r) => r.applicant.id === 'd')?.roleKey).toBe('')
    const only = searchApplicants(people, { ...EMPTY_APPLICANT_FILTERS, roles: ['frontend developer'] }, 'relevance')
    expect(only.rows.map((r) => r.applicant.id).sort()).toEqual(['a', 'b'])
    expect(only.facets.roles.find((r) => r.value === 'qa engineer')?.count).toBe(1)
  })

  it('filters resume presence and counts it without its own filter', () => {
    const people = [
      indexApplicant(app({ id: 'yes', resumeName: 'cv.pdf', resumeText: 'hello' })),
      indexApplicant(app({ id: 'no', resumeName: null, resumeText: '' })),
    ]
    expect(people[0].hasResume).toBe(true)
    expect(people[1].hasResume).toBe(false)
    const yes = searchApplicants(people, { ...EMPTY_APPLICANT_FILTERS, resume: 'yes' }, 'relevance')
    expect(yes.rows.map((r) => r.applicant.id)).toEqual(['yes'])
    expect(yes.facets.resume.find((r) => r.value === 'no')?.count).toBe(1)
  })

  it('emits one chip for an interview radio choice', () => {
    const sixty = activeFilterChips({ ...EMPTY_APPLICANT_FILTERS, score: ['80+', '60-79'] })
    expect(sixty.map((c) => c.label)).toEqual(['Score 60 and above'])
    expect(sixty[0].clear).toEqual({ interview: [], score: [] })
    expect(activeFilterChips({ ...EMPTY_APPLICANT_FILTERS, interview: ['completed'] }).map((c) => c.label)).toEqual(['Interviewed'])
    expect(activeFilterChips({ ...EMPTY_APPLICANT_FILTERS, interview: ['not_interviewed'] }).map((c) => c.label)).toEqual([
      'Not interviewed yet',
    ])
    expect(activeFilterChips({ ...EMPTY_APPLICANT_FILTERS, score: ['40-59'] }).map((c) => c.label)).toEqual(['Score 40 – 59'])
  })

  it('counts interview radios with interview and score cleared', () => {
    const front = run({ roles: ['frontend developer'] })
    expect(front.facets.interviewChoices).toEqual({ interviewed: 2, score80: 1, score60: 2, notInterviewed: 0 })
  })

  it('keeps only the search card and the job when narrowing for applications', () => {
    const narrowed = filtersForApplicantSearch('applications', {
      ...EMPTY_APPLICANT_FILTERS,
      keywords: 'react',
      location: 'Pune',
      expMin: '1',
      expMax: '3',
      jobs: ['job-fe'],
      score: ['80+'],
      skills: ['React'],
      shortlistedOnly: true,
    })
    expect(narrowed).toEqual({
      ...EMPTY_APPLICANT_FILTERS,
      keywords: 'react',
      location: 'Pune',
      expMin: '1',
      expMax: '3',
      jobs: ['job-fe'],
    })
    const candidates = filtersForApplicantSearch('candidates', {
      ...EMPTY_APPLICANT_FILTERS,
      jobs: ['job-fe'],
      fit: ['80+'],
      sources: ['talent'],
      savedOnly: true,
      roles: ['qa'],
    })
    expect(candidates.jobs).toEqual([])
    expect(candidates.fit).toEqual([])
    expect(candidates.sources).toEqual([])
    expect(candidates.savedOnly).toBe(false)
    expect(candidates.roles).toEqual(['qa'])
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
    const extra = {
      filters: { ...EMPTY_APPLICANT_FILTERS, roles: ['frontend developer'], cities: ['Bengaluru', 'Delhi NCR'], resume: 'yes' as const },
      sort: 'relevance' as const,
      page: 1,
      applicant: null,
      tab: 'profile' as const,
    }
    const extraParams = writeApplicantsUrl(extra)
    expect(extraParams.getAll('role')).toEqual(['frontend developer'])
    expect(extraParams.getAll('city')).toEqual(['Bengaluru', 'Delhi NCR'])
    expect(extraParams.get('cv')).toBe('yes')
    expect(readApplicantsUrl(extraParams)).toEqual(extra)
  })

  it('accepts the ?jobId= links from application alerts and ignores junk values', () => {
    const s = readApplicantsUrl(new URLSearchParams('jobId=j1&sort=bogus&page=-3&tab=x&score=99&active=12'))
    expect(s.filters.jobs).toEqual(['j1'])
    expect(s.sort).toBe('relevance')
    expect(s.page).toBe(1)
    expect(s.tab).toBe('profile')
    expect(s.filters.score).toEqual([])
    expect(s.filters.activeWithin).toBe(0)
  })
})

describe('drawer tab in the URL', () => {
  it('opens Profile by default and maps old tab=contact links to Profile', () => {
    expect(readApplicantsUrl(new URLSearchParams('applicant=a')).tab).toBe('profile')
    expect(readApplicantsUrl(new URLSearchParams('applicant=a&tab=contact')).tab).toBe('profile')
    expect(readApplicantsUrl(new URLSearchParams('applicant=a&tab=resume')).tab).toBe('resume')
    expect(readApplicantsUrl(new URLSearchParams('applicant=a&tab=report')).tab).toBe('report')
    expect(panelTabFromParam('profile')).toBe('profile')
    const base = { filters: EMPTY_APPLICANT_FILTERS, sort: 'relevance' as const, page: 1, applicant: 'a' }
    expect(writeApplicantsUrl({ ...base, tab: 'profile' }).has('tab')).toBe(false)
    expect(writeApplicantsUrl({ ...base, tab: 'resume' }).get('tab')).toBe('resume')
  })
})

describe('exports', () => {
  it('writes CSV with escaping, no formula injection and the contact details the API returned', () => {
    const rows = [
      indexApplicant(app({ candidateName: '=HYPERLINK("x")', role: 'Dev, "Senior"' })),
      // Owner decision: contact details are shown for every candidate; an old contactHidden flag no longer hides them.
      indexApplicant(app({ id: 'h', candidateName: 'Platform', candidateEmail: 'h@example.com', contactHidden: true })),
    ]
    const csv = applicantsToCsv(rows)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"Dev, ""Senior"""')
    expect(csv).toContain('h@example.com')
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
