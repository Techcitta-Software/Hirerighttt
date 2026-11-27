import { describe, expect, it } from 'vitest'
import { deriveCompanyTitle, deriveHighestEducation } from './profileDefaults'

describe('profile defaults from a resume', () => {
  it('uses the latest job as "title, company"', () => {
    expect(
      deriveCompanyTitle([
        { jobTitle: 'Engineer', company: 'Old Co', startDate: 'Jan 2018', endDate: 'Dec 2020', currentlyWorking: false },
        { jobTitle: 'Staff Nurse', company: 'KMC Hospital', startDate: 'Nov 2020', endDate: 'Present', currentlyWorking: true },
      ]),
    ).toBe('Staff Nurse, KMC Hospital')
  })

  it('uses the first education entry as "degree, institution"', () => {
    expect(
      deriveHighestEducation([
        { degree: 'B.Sc Nursing', institution: 'Laxmi Memorial College of Nursing' },
        { degree: 'Class XII', institution: 'Narayana Junior College' },
      ]),
    ).toBe('B.Sc Nursing, Laxmi Memorial College of Nursing')
  })

  it('returns an empty string when the resume has neither', () => {
    expect(deriveCompanyTitle([])).toBe('')
    expect(deriveCompanyTitle(undefined)).toBe('')
    expect(deriveHighestEducation(null)).toBe('')
    expect(deriveCompanyTitle([{ jobTitle: 'Intern' }])).toBe('Intern')
    expect(deriveHighestEducation([{ degree: 'B.Tech', institution: '' }])).toBe('B.Tech')
  })
})
