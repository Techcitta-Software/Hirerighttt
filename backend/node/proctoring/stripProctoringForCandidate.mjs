/**
 * Strip recruiter-only proctoring payloads before returning interview results to candidates.
 * @param {Record<string, unknown> | null | undefined} interview
 */
export function stripInterviewResultForCandidate(interview) {
  if (!interview || typeof interview !== 'object') return interview
  const integrity = interview.integrity
  if (!integrity || typeof integrity !== 'object') return interview
  const { proctoring: _p, flaggedSections: _f, logs: _l, ...rest } = integrity
  void _p
  void _f
  void _l
  const next = { ...interview }
  if (Object.keys(rest).length) {
    next.integrity = rest
  } else {
    delete next.integrity
  }
  return next
}
