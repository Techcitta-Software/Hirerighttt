import { describe, expect, it } from 'vitest'
import {
  indexApplicant,
  keywordSnippet,
  resumeEducationEntries,
  resumeExperienceEntries,
  resumeSummary,
} from './applicantSearch'
import type { EmployerApplicant } from './store'

const KAVYA = `Kavya Iyer
Frontend Developer | Chennai, India | kavya.iyer@example.com | +91 98400 11223
SUMMARY
Frontend developer with 4 years building fast, accessible React apps for e-commerce and fintech.
EXPERIENCE
Frontend Developer, CartWave Technologies, Chennai (Jun 2022 - Present)
- Rebuilt the product listing and checkout in React 18 and TypeScript; conversion up 9%.
- Cut Largest Contentful Paint from 4.1s to 1.8s.
Junior Frontend Developer, Finlo Payments, Bengaluru (Jul 2020 - May 2022)
- Built the merchant dashboard in React and Redux Toolkit.
PROJECTS
- Expense tracker PWA
SKILLS
React, TypeScript
EDUCATION
B.Tech Information Technology, Anna University, 2020
`

describe('Candidates tuple and Profile details (resume read as a profile)', () => {
  it('takes the summary paragraph, never the header with contact details', () => {
    expect(resumeSummary(KAVYA)).toBe(
      'Frontend developer with 4 years building fast, accessible React apps for e-commerce and fintech.',
    )
    expect(resumeSummary(KAVYA)).not.toMatch(/@|98400/)
    expect(resumeSummary('Name\nSKILLS\nGo')).toBe('')
    expect(resumeSummary(`SUMMARY\n${'word '.repeat(80)}`, 50).endsWith('…')).toBe(true)
  })

  it('reads roles as a timeline with company, place, period and points', () => {
    const roles = resumeExperienceEntries(KAVYA)
    expect(roles).toHaveLength(2)
    expect(roles[0]).toMatchObject({
      title: 'Frontend Developer',
      company: 'CartWave Technologies',
      location: 'Chennai',
      period: 'Jun 2022 – Present',
    })
    expect(roles[0].points).toHaveLength(2)
    expect(roles[1].company).toBe('Finlo Payments')
    expect(resumeExperienceEntries('Data Engineer at ShopLens | 2021 - Present', 3)).toEqual([])
    expect(resumeExperienceEntries('EXPERIENCE\nData Engineer at ShopLens | 2021 - Present')[0]).toMatchObject({
      title: 'Data Engineer',
      company: 'ShopLens',
      period: '2021 – Present',
    })
  })

  it('lists education lines', () => {
    expect(resumeEducationEntries(KAVYA)).toEqual(['B.Tech Information Technology, Anna University, 2020'])
  })

  it('fills the headline company from the current role when the headline line has none', () => {
    const row = indexApplicant({ id: 'k', candidateName: 'Kavya Iyer', resumeText: KAVYA } as EmployerApplicant)
    expect(row.headline).toMatchObject({ title: 'Frontend Developer', company: 'CartWave Technologies', location: 'Chennai, India' })
    expect(row.summary).toContain('accessible React apps')
  })

  it('keeps a keyword snippet on its own resume line (no heading glued to the text)', () => {
    const snip = keywordSnippet(KAVYA, ['finlo'])
    expect(snip).toBe('Junior Frontend Developer, Finlo Payments, Bengaluru (Jul 2020 - May 2022)')
    expect(keywordSnippet(KAVYA, ['redux'])).toBe('Built the merchant dashboard in React and Redux Toolkit.')
  })
})
