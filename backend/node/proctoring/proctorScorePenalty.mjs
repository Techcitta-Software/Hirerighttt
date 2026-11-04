/** Points deducted from interview overall score per proctor face-deviation incident. */
export const FACE_DEVIATION_SCORE_PENALTY = 5

const DEVIATION_LOG_TYPES = new Set([
  'SIDE_GAZE_LOOKING_AWAY',
  'NO_FACE_SEEN',
  'MULTIPLE_FACES_DETECTED',
])

const DEVIATION_FLAG_TYPES = new Set(['LOOKING_SIDE', 'NO_FACE', 'MULTI_FACE'])

/**
 * @param {Record<string, unknown> | null | undefined} integrity
 * @param {{ counts?: { total?: number } } | null | undefined} [proctoring]
 */
export function countFaceProctorDeviations(integrity = {}, proctoring = null) {
  const sections = Array.isArray(integrity.flaggedSections) ? integrity.flaggedSections : []
  const fromFlags = sections.filter((f) => f && DEVIATION_FLAG_TYPES.has(String(f.type || ''))).length
  if (fromFlags) return fromFlags
  const logs = Array.isArray(integrity.logs) ? integrity.logs : []
  const fromLogs = logs.filter((e) => e && DEVIATION_LOG_TYPES.has(String(e.eventType || ''))).length
  if (fromLogs) return fromLogs
  const fromProctor = Number(proctoring?.counts?.total)
  if (fromProctor > 0) return fromProctor
  return 0
}

/**
 * @param {Record<string, unknown>} result
 * @param {number} deviations
 */
export function applyFaceDeviationPenaltyToResult(result, deviations) {
  if (!deviations || !result || typeof result !== 'object') return result
  const penalty = deviations * FACE_DEVIATION_SCORE_PENALTY
  if (penalty <= 0) return result

  if (typeof result.overall === 'number') {
    result.overall = Math.max(0, result.overall - penalty)
  }
  if (typeof result.interviewScore === 'number') {
    result.interviewScore = Math.max(0, result.interviewScore - penalty)
  }
  if (typeof result.compositeScore === 'number') {
    result.compositeScore = Math.max(0, result.compositeScore - penalty)
  }
  if (result.scorecard && typeof result.scorecard === 'object') {
    const sc = result.scorecard
    if (typeof sc.overallInterviewScore === 'number') {
      sc.overallInterviewScore = Math.max(0, sc.overallInterviewScore - penalty)
    }
    if (sc.sessionStats && typeof sc.sessionStats.overallInterviewScore === 'number') {
      sc.sessionStats.overallInterviewScore = Math.max(0, sc.sessionStats.overallInterviewScore - penalty)
    }
  }

  result.proctorDeviationCount = deviations
  result.proctorScorePenalty = penalty
  const note = `${deviations} camera proctoring deviation(s) (−${penalty} points on overall score).`
  if (Array.isArray(result.improvements)) {
    if (!result.improvements.some((s) => String(s).includes('camera proctoring'))) {
      result.improvements.push(`Stay centered on camera during the interview. ${note}`)
    }
  }
  return result
}
