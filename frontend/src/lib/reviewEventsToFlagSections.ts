import type { IntegrityLogEvent, InterviewFlagSection } from './store'
import type { Question } from './interviewEngine'

function mapType(eventType: IntegrityLogEvent['eventType']): InterviewFlagSection['type'] | null {
  if (eventType === 'SIDE_GAZE_LOOKING_AWAY') return 'LOOKING_SIDE'
  if (eventType === 'MULTIPLE_FACES_DETECTED') return 'MULTI_FACE'
  if (eventType === 'NO_FACE_SEEN') return 'NO_FACE'
  return null
}

/** Fallback when FaceLandmarker proctor engine produced no sections (model load failure, etc.). */
export function reviewEventsToFlagSections(
  events: IntegrityLogEvent[],
  questions: Question[] = [],
): InterviewFlagSection[] {
  const out: InterviewFlagSection[] = []
  for (const e of events) {
    const type = mapType(e.eventType)
    if (!type || typeof e.startOffsetSec !== 'number') continue
    const startSec = Math.max(0, Number(e.startOffsetSec.toFixed(1)))
    const durationSec = Math.max(0.5, Number((e.durationSec ?? 1.5).toFixed(1)))
    const endSec = startSec + durationSec
    const qIdx =
      typeof (e as { questionIndex?: number }).questionIndex === 'number'
        ? (e as { questionIndex: number }).questionIndex
        : 0
    const turnIndex = Math.max(1, qIdx + 1)
    const questionText = questions[qIdx]?.text ?? ''
    out.push({
      id: e.id || `review_${Math.round(startSec * 10)}`,
      type,
      severity: type === 'MULTI_FACE' ? 'high' : 'medium',
      turnIndex,
      questionText,
      startSec,
      endSec: Number(endSec.toFixed(1)),
      durationSec,
      reason: e.message || type.replaceAll('_', ' ').toLowerCase(),
      peakMetrics: {},
    })
  }
  return out
}
