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

/**
 * The server derives flagged sections from the camera review events (`review_logs_to_flag_sections`) in its own
 * shape: `{ id, type: 'MULTIPLE_FACES_DETECTED', startOffsetSec, durationSec }`. The review UI expects
 * `{ type: 'MULTI_FACE', startSec, endSec, ... }`; without this, labels were all "Looking away" and times NaN:NaN.
 * Sections already in the UI shape pass through unchanged; unusable entries are dropped.
 */
export function normalizeFlagSections(sections: readonly unknown[] | null | undefined): InterviewFlagSection[] {
  const out: InterviewFlagSection[] = []
  for (const raw of sections ?? []) {
    if (!raw || typeof raw !== 'object') continue
    const f = raw as Partial<InterviewFlagSection> & {
      type?: string
      eventType?: string
      startOffsetSec?: number
      reason?: string
      message?: string
    }
    const t = String(f.type || f.eventType || '')
    const type: InterviewFlagSection['type'] | null =
      t === 'LOOKING_SIDE' || t === 'MULTI_FACE' || t === 'NO_FACE'
        ? t
        : mapType(t as IntegrityLogEvent['eventType'])
    const start = Number.isFinite(f.startSec) ? Number(f.startSec) : Number(f.startOffsetSec)
    if (!type || !Number.isFinite(start) || start < 0) continue
    const dur = Number.isFinite(f.durationSec) ? Math.max(0, Number(f.durationSec)) : null
    const end = Number.isFinite(f.endSec) ? Math.max(start, Number(f.endSec)) : start + (dur ?? 0)
    out.push({
      id: f.id || `flag_${Math.round(start * 10)}`,
      type,
      severity: f.severity === 'high' || f.severity === 'medium' ? f.severity : type === 'MULTI_FACE' ? 'high' : 'medium',
      turnIndex: Number.isFinite(f.turnIndex) && Number(f.turnIndex) > 0 ? Number(f.turnIndex) : 0,
      questionText: f.questionText || '',
      startSec: start,
      endSec: end,
      durationSec: dur ?? Number((end - start).toFixed(1)),
      reason: f.reason || f.message || '',
      peakMetrics: f.peakMetrics ?? {},
    })
  }
  return out
}

/** Server writes `REVIEW` when any section is flagged (older data: `FLAGGED`). */
export function proctoringNeedsReview(
  p: { status?: string; counts?: { total?: number } } | null | undefined,
): boolean {
  if (!p) return false
  return p.status === 'FLAGGED' || p.status === 'REVIEW' || (p.counts?.total ?? 0) > 0
}
