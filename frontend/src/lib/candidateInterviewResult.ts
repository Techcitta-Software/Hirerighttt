import type { InterviewResult } from './store'

/** Remove recruiter-only proctoring evidence from copies shown to candidates. */
export function stripProctoringForCandidateView(result: InterviewResult): InterviewResult {
  if (!result.integrity) return result
  const {
    proctoring: _p,
    flaggedSections: _f,
    logs: _l,
    ...rest
  } = result.integrity as typeof result.integrity & {
    proctoring?: unknown
    flaggedSections?: unknown
  }
  void _p
  void _f
  void _l
  const nextIntegrity = Object.keys(rest).length ? { ...rest } : undefined
  return {
    ...result,
    integrity: nextIntegrity,
  }
}
