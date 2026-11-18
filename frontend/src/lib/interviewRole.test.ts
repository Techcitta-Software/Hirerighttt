import { describe, expect, it } from 'vitest'
import { DEFAULT_INTERVIEW_ROLE, interviewRoleFromProfile } from './interviewRole'

describe('interviewRoleFromProfile', () => {
  it('uses the most recent job title exactly as written', () => {
    expect(
      interviewRoleFromProfile({
        currentRole: '',
        workExperiences: [
          { jobTitle: 'Junior Accountant', startDate: 'Jan 2018', endDate: 'Dec 2020' },
          { jobTitle: 'Senior Financial Analyst', startDate: 'Jan 2021', endDate: '', currentlyWorking: true },
        ],
      }),
    ).toBe('Senior Financial Analyst')
  })

  it('picks the latest job whatever order the resume lists them in', () => {
    expect(
      interviewRoleFromProfile({
        workExperiences: [
          { jobTitle: 'QA Engineer', startDate: 'Mar 2019', endDate: 'Feb 2021' },
          { jobTitle: 'Quality Assurance Lead', startDate: 'Mar 2021', endDate: 'Oct 2026' },
        ],
      }),
    ).toBe('Quality Assurance Lead')
  })

  it('never turns a title containing "ui" into Frontend Developer', () => {
    for (const title of ['Quality Analyst', 'Technical Recruiter', 'Building Services Engineer', 'Fluid Dynamics Engineer']) {
      expect(interviewRoleFromProfile({ currentRole: title, workExperiences: [] })).toBe(title)
    }
  })

  it('keeps non-software roles as they are', () => {
    expect(interviewRoleFromProfile({ currentRole: 'ICU Staff Nurse', workExperiences: [] })).toBe('ICU Staff Nurse')
  })

  it('prefers the cleaned currentRole when it is the same latest title without the location', () => {
    expect(
      interviewRoleFromProfile({
        currentRole: 'Backend Engineer',
        workExperiences: [{ jobTitle: 'Backend Engineer Hyderabad, India', startDate: 'Jan 2022', currentlyWorking: true }],
      }),
    ).toBe('Backend Engineer')
  })

  it('a newer job on the resume wins over a stale currentRole', () => {
    expect(
      interviewRoleFromProfile({
        currentRole: 'Software Engineer',
        workExperiences: [
          { jobTitle: 'Software Engineer', startDate: 'Jan 2019', endDate: 'Dec 2022' },
          { jobTitle: 'Engineering Manager', startDate: 'Jan 2023', currentlyWorking: true },
        ],
      }),
    ).toBe('Engineering Manager')
  })

  it('ignores internships when there is a real job', () => {
    expect(
      interviewRoleFromProfile({
        workExperiences: [
          { jobTitle: 'Data Analyst', startDate: 'Jul 2023', endDate: 'Jun 2025' },
          { jobTitle: 'ML Intern', startDate: 'Jul 2025', currentlyWorking: true },
        ],
      }),
    ).toBe('Data Analyst')
  })

  it('a fresher with only a headline title uses it', () => {
    expect(interviewRoleFromProfile({ currentRole: 'Aspiring Data Scientist', workExperiences: [] })).toBe('Aspiring Data Scientist')
  })

  it('only internships: the latest internship title', () => {
    expect(
      interviewRoleFromProfile({ workExperiences: [{ jobTitle: 'Software Development Intern', startDate: 'Jan 2026', endDate: 'Jun 2026' }] }),
    ).toBe('Software Development Intern')
  })

  it('no title anywhere falls back to a neutral role, never Frontend Developer', () => {
    expect(interviewRoleFromProfile({ currentRole: '', workExperiences: [] })).toBe(DEFAULT_INTERVIEW_ROLE)
    expect(interviewRoleFromProfile(null)).toBe(DEFAULT_INTERVIEW_ROLE)
  })
})
