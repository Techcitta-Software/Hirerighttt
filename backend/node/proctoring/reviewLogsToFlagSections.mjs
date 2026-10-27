/**
 * @param {Array<Record<string, unknown>> | undefined} logs
 */
export function reviewLogsToFlagSections(logs) {
  if (!Array.isArray(logs)) return []
  const out = []
  for (const e of logs) {
    if (!e || typeof e !== 'object') continue
    const eventType = String(e.eventType || '')
    let type = null
    if (eventType === 'SIDE_GAZE_LOOKING_AWAY') type = 'LOOKING_SIDE'
    else if (eventType === 'MULTIPLE_FACES_DETECTED') type = 'MULTI_FACE'
    else if (eventType === 'NO_FACE_SEEN') type = 'NO_FACE'
    if (!type) continue
    const startSec =
      typeof e.startOffsetSec === 'number' && Number.isFinite(e.startOffsetSec)
        ? Math.max(0, Number(e.startOffsetSec.toFixed(1)))
        : null
    if (startSec == null) continue
    const durationSec = Math.max(
      0.5,
      Number((typeof e.durationSec === 'number' ? e.durationSec : 1.5).toFixed(1)),
    )
    const endSec = Number((startSec + durationSec).toFixed(1))
    const turnIndex = Math.max(1, Number(e.questionIndex ?? 0) + 1)
    out.push({
      id: String(e.id || `review_${Math.round(startSec * 10)}`),
      type,
      severity: type === 'MULTI_FACE' ? 'high' : 'medium',
      turnIndex,
      questionText: '',
      startSec,
      endSec,
      durationSec,
      reason: String(e.message || type),
    })
  }
  return out
}
