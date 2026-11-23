import { describe, expect, it } from 'vitest'
import { CAREER_INTERVIEW_MINUTES, JD_INTERVIEW_MINUTES, interviewDurationMinutes, isInterviewOverBudget } from './interviewDuration'

const JD = 'Design and maintain REST APIs in Python and FastAPI; own PostgreSQL schema changes.'

describe('interview duration', () => {
  it('a recruiter job with a JD is a 20-minute interview', () => {
    expect(JD_INTERVIEW_MINUTES).toBe(20)
    expect(interviewDurationMinutes({ jobId: 'job-1', jd: JD })).toBe(20)
    expect(interviewDurationMinutes({ applicationId: 'app-1', jd: JD })).toBe(20)
  })
  it('other interviews keep the career length', () => {
    expect(interviewDurationMinutes(null)).toBe(CAREER_INTERVIEW_MINUTES)
    expect(interviewDurationMinutes({ jd: JD })).toBe(CAREER_INTERVIEW_MINUTES)
    expect(interviewDurationMinutes({ jobId: 'job-1', jd: '' })).toBe(CAREER_INTERVIEW_MINUTES)
  })
  it('the server value wins when given', () => {
    expect(interviewDurationMinutes(null, 20)).toBe(20)
    expect(interviewDurationMinutes({ jd: JD }, null, true)).toBe(20)
  })
  it('budget check', () => {
    const start = 1_000_000
    expect(isInterviewOverBudget(start, start + 19 * 60_000, 20)).toBe(false)
    expect(isInterviewOverBudget(start, start + 20 * 60_000, 20)).toBe(true)
    expect(isInterviewOverBudget(start, start + 99 * 60_000, null)).toBe(false)
  })
})
