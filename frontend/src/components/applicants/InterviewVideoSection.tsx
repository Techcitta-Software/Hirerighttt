import { useEffect, useMemo, useRef, useState } from 'react'
import { canViewInterviewVideo } from '../../lib/adminAccess'
import { buildTimelineMarkers } from '../../lib/proctorTimeline'
import { normalizeFlagSections } from '../../lib/reviewEventsToFlagSections'
import type { IntegrityLogEvent, InterviewProctoringSummary } from '../../lib/store'
import { fetchVendorInterviewReview } from '../../lib/vendorApi'
import { HrIcon } from '../HrIcon'
import { ProctorTimelineBar } from '../ProctorTimelineBar'
import styles from './ReportSections.module.css'

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

type ViewProps = {
  state: InterviewVideoState
  candidateName: string
  onRetry?: () => void
  headingId?: string
}

const NO_EVENTS: IntegrityLogEvent[] = []

/** The recorded interview with the single-line face-gaze bar directly under it (red marks seek the video). */
export function InterviewVideoView({ state, candidateName, onRetry, headingId = 'report-interview-video' }: ViewProps) {
  const video = useRef<HTMLVideoElement>(null)
  const [playError, setPlayError] = useState(false)
  const url = state.status === 'ready' ? state.url : ''
  useEffect(() => setPlayError(false), [url])
  const events = state.status === 'ready' || state.status === 'timeline' ? state.events : NO_EVENTS
  const proctoring = state.status === 'ready' || state.status === 'timeline' ? state.proctoring : null
  const flaggedSections = useMemo(() => normalizeFlagSections(proctoring?.flaggedSections), [proctoring])

  const failed = state.status === 'error' || playError
  const failMessage =
    state.status === 'error' ? state.message : 'The recording could not be played. The link may have expired.'

  return (
    <section className={styles.block} aria-labelledby={headingId} data-testid="interview-video">
      <div className={styles.blockHead}>
        <h2 id={headingId} className={styles.blockTitle} tabIndex={-1}>
          Interview video
        </h2>
        {state.status === 'ready' && !playError ? (
          <span className={styles.blockMeta}>Red marks: face or gaze left the camera. Click one to jump there.</span>
        ) : state.status === 'timeline' ? (
          <span className={styles.blockMeta}>Red marks: face or gaze left the camera. Hover one to see when.</span>
        ) : null}
      </div>

      {failed ? (
        <div className={styles.videoState} role="alert" data-testid="video-error">
          <HrIcon name="warning" size={20} />
          <p>{failMessage}</p>
          {onRetry ? (
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => {
                setPlayError(false)
                onRetry()
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : state.status === 'loading' ? (
        <div className={`${styles.videoState} ${styles.videoLoading}`} role="status" data-testid="video-loading">
          <span className="ds-spinner" aria-hidden="true" />
          <p>Loading the recording…</p>
        </div>
      ) : state.status === 'none' ? (
        <div className={styles.videoState} role="status" data-testid="video-none">
          <HrIcon name="video" size={20} />
          <p>No recording for this interview.</p>
        </div>
      ) : state.status === 'timeline' ? (
        <div className={styles.videoWrap} data-testid="timeline-without-video">
          <div className={styles.videoState} role="status" data-testid="video-none">
            <HrIcon name="video" size={20} />
            <p>{NO_VIDEO_TIMELINE_NOTE}</p>
          </div>
          <ProctorTimelineBar events={events} flaggedSections={flaggedSections} durationHint={state.durationSec} />
        </div>
      ) : (
        <div className={styles.videoWrap}>
          <video
            ref={video}
            className={styles.video}
            src={state.url}
            controls
            controlsList="nodownload"
            playsInline
            preload="metadata"
            aria-label={`Interview recording of ${candidateName}`}
            onError={() => setPlayError(true)}
            data-testid="interview-video-player"
          >
            Your browser cannot play this recording.
          </video>
          <ProctorTimelineBar
            videoRef={video}
            events={events}
            flaggedSections={flaggedSections}
            durationHint={state.durationSec}
          />
        </div>
      )}
    </section>
  )
}

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

type Props = {
  sessionId?: string | null
  candidateEmail?: string | null
  candidateName: string
  /** Proctoring already in the report, used when the review call returns none. */
  logs?: IntegrityLogEvent[]
  proctoring?: InterviewProctoringSummary | null
  headingId?: string
}

/** Loads the signed recording and the proctoring review for one interview, then shows {@link InterviewVideoView}. */
export function InterviewVideoSection({ sessionId, candidateEmail, candidateName, logs, proctoring, headingId }: Props) {
  const canLoad = Boolean(sessionId && candidateEmail)
  const [state, setState] = useState<InterviewVideoState>(canLoad ? { status: 'loading' } : { status: 'none' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!sessionId || !candidateEmail) {
      setState(noVideoState(logs ?? [], proctoring ?? null, null))
      return
    }
    let active = true
    setState({ status: 'loading' })
    fetchVendorInterviewReview(sessionId, candidateEmail)
      .then((data) => {
        if (!active) return
        if (!data.videoUrl) {
          setState(noVideoState(data.events?.length ? data.events : (logs ?? []), data.proctoring ?? proctoring ?? null, data.interviewDurationSec))
          return
        }
        const d = (data as { recordingDurationSec?: unknown }).recordingDurationSec
        setState({
          status: 'ready',
          url: data.videoUrl,
          events: data.events?.length ? data.events : (logs ?? []),
          proctoring: data.proctoring ?? proctoring ?? null,
          durationSec: typeof d === 'number' && d > 0 ? d : null,
        })
      })
      .catch((err: unknown) => {
        if (!active) return
        const msg = err instanceof Error ? err.message : ''
        // An old or removed session has nothing to play: that is "no recording", not a failure.
        if (/not found/i.test(msg)) setState(noVideoState(logs ?? [], proctoring ?? null, null))
        else setState({ status: 'error', message: 'The recording could not be loaded.' })
      })
    return () => {
      active = false
    }
    // logs / proctoring are only fallbacks; reloading on their identity would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, candidateEmail, attempt])

  if (!canViewInterviewVideo()) return null
  return (
    <InterviewVideoView
      state={state}
      candidateName={candidateName}
      onRetry={() => setAttempt((n) => n + 1)}
      headingId={headingId}
    />
  )
}
