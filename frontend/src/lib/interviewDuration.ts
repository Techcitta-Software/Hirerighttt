/**
 * How long an interview is budgeted for. A recruiter's job link / invite with a job description gets the JD-first
 * interview: 9 questions + sign-off in about 20 minutes (backend: interview_jd_plan.JD_INTERVIEW_DURATION_MINUTES).
 */
export const JD_INTERVIEW_MINUTES = 20
export const CAREER_INTERVIEW_MINUTES = 15
const MIN_JD_CHARS = 40

type JobLike = { jd?: string; jobId?: string; applicationId?: string } | null | undefined

/** Minutes shown to the candidate for this interview. */
export function interviewDurationMinutes(job: JobLike, serverMinutes?: number | null, viaInvite = false): number {
  if (typeof serverMinutes === 'number' && serverMinutes > 0) return serverMinutes
  if (!job) return CAREER_INTERVIEW_MINUTES
  const fromRecruiter = viaInvite || Boolean(job.jobId || job.applicationId)
  return fromRecruiter && (job.jd || '').trim().length >= MIN_JD_CHARS ? JD_INTERVIEW_MINUTES : CAREER_INTERVIEW_MINUTES
}

/** The time budget is used up: wrap up after the current answer instead of asking more questions. */
export function isInterviewOverBudget(startedAtMs: number, nowMs: number, budgetMinutes: number | null | undefined): boolean {
  if (!budgetMinutes || budgetMinutes <= 0 || !startedAtMs) return false
  return nowMs - startedAtMs >= budgetMinutes * 60_000
}
