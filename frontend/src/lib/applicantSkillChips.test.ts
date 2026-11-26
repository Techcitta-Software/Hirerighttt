/** T3: skill filter showed near-duplicates; T4: experience showed the band's lower bound ("8 – 12 Years" -> "8 yrs"). */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_APPLICANT_FILTERS,
  applicantSkills,
  experienceLabel,
  indexApplicant,
  searchApplicants,
  skillChipKey,
  skillChipLabel,
} from './applicantSearch'
import type { EmployerApplicant } from './store'

function app(id: string, over: Partial<EmployerApplicant>): EmployerApplicant {
  return {
    id,
    jobId: 'job-da',
    jobTitle: 'Data Analyst',
    company: 'Acme',
    candidateName: `Person ${id}`,
    candidateEmail: `${id}@example.com`,
    candidatePhone: '',
    experienceYears: '',
    resumeName: 'cv.pdf',
    resumeText: '',
    appliedAt: new Date().toISOString(),
    status: 'New',
    recordSource: 'application',
    ...over,
  } as EmployerApplicant
}

describe('skill chips are normalised', () => {
  it('strips the detail in brackets and folds spellings', () => {
    expect(skillChipLabel('Excel (pivot tables, XLOOKUP)')).toBe('Excel')
    expect(skillChipLabel('SQL (PostgreSQL, SQL Server)')).toBe('SQL')
    expect(skillChipKey('MS Excel')).toBe(skillChipKey('Excel'))
    expect(skillChipKey('React.js')).toBe(skillChipKey('ReactJS'))
    expect(skillChipKey('Power BI')).toBe(skillChipKey('PowerBI'))
    expect(skillChipKey('Adobe Photoshop')).toBe(skillChipKey('Photoshop'))
  })

  it('one chip per skill in the filter, and the filter matches every spelling', () => {
    const a = app('a', { matchedSkills: ['Excel', 'SQL', 'Pandas'] })
    const b = app('b', { matchedSkills: ['Excel (pivot tables, XLOOKUP)', 'SQL (PostgreSQL, SQL Server)', 'Python (pandas)'] })
    expect(applicantSkills(b)).toEqual(['Excel', 'SQL', 'Python'])
    const rows = [indexApplicant(a), indexApplicant(b)]
    const all = searchApplicants(rows, EMPTY_APPLICANT_FILTERS, 'relevance')
    const labels = all.facets.skills.map((s) => [s.label, s.count])
    expect(labels).toEqual(expect.arrayContaining([['Excel', 2], ['SQL', 2]]))
    expect(all.facets.skills.filter((s) => /excel/i.test(s.label))).toHaveLength(1)
    const filtered = searchApplicants(rows, { ...EMPTY_APPLICANT_FILTERS, skills: ['Excel (pivot tables, XLOOKUP)'] }, 'relevance')
    expect(filtered.rows).toHaveLength(2)
  })
})

describe('experience label uses the resume, not the band lower bound', () => {
  it('"8 – 12 Years" with a 9-year resume shows 9 yrs and filters as 9', () => {
    const row = indexApplicant(
      app('v', {
        experienceYears: '8 – 12 Years',
        resumeText: 'Vikram\nSUMMARY\nSenior Data Scientist with 9 years of experience in machine learning.\nEXPERIENCE\nData Scientist – Mu Sigma\nJul 2019 – Dec 2021',
      }),
    )
    expect(experienceLabel(row)).toBe('9 yrs')
    expect(row.experience).toBe(9)
  })

  it('without a resume figure the band is shown as before', () => {
    const row = indexApplicant(app('w', { experienceYears: '5 – 8 Years', resumeText: '' }))
    expect(experienceLabel(row)).toBe('5 yrs')
  })
})
