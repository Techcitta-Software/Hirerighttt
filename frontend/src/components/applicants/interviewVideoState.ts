import { buildTimelineMarkers } from '../../lib/proctorTimeline'
import { normalizeFlagSections } from '../../lib/reviewEventsToFlagSections'
import type { IntegrityLogEvent, InterviewProctoringSummary } from '../../lib/store'

export type InterviewVideoState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      url: string
      events: IntegrityLogEvent[]
      proctoring: InterviewProctoringSummary | null
      durationSec: number | null
    }
  /** No video was saved, but proctoring events were: the bar is drawn on interview time (marks are not seekable). */
  | {
      status: 'timeline'
      events: IntegrityLogEvent[]
      proctoring: InterviewProctoringSummary | null
      durationSec: number | null
    }

export const NO_VIDEO_TIMELINE_NOTE = 'No video saved for this interview — flags are shown on the interview timeline.'

/** Without a video: the interview-time bar when there is anything to mark, otherwise the plain "No recording" note. */
export function noVideoState(
  events: IntegrityLogEvent[],
  proctoring: InterviewProctoringSummary | null,
  durationSec: unknown,
): InterviewVideoState {
  // Only events that can be placed on the timeline count (old logs without offsets cannot be drawn).
  if (!buildTimelineMarkers(events, normalizeFlagSections(proctoring?.flaggedSections)).length) return { status: 'none' }
  const d = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null
  return { status: 'timeline', events, proctoring, durationSec: d }
}
