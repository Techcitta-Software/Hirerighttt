import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import type { IntegrityLogEvent, InterviewFlagSection } from '../lib/store'
import {
  buildTimelineMarkers,
  formatTimelineClock,
  markerIndexAtTime,
  markerTooltip,
  placeMarkers,
  resolveTimelineDuration,
  seekTargetForMarker,
  seekTargetForRatio,
  seekVideo,
  stepMarkerIndex,
  timelineSummary,
} from '../lib/proctorTimeline'
import styles from './ProctorTimelineBar.module.css'

type Props = {
  /**
   * The <video> playing the stored interview recording. Omit it when no video was saved: the bar is then drawn on
   * interview time from the review events, marks are not seekable and only show their time on hover/focus.
   */
  videoRef?: RefObject<HTMLVideoElement | null> | null
  events?: readonly IntegrityLogEvent[] | null
  flaggedSections?: readonly InterviewFlagSection[] | null
  /** Duration stored with the recording (seconds); used while the browser cannot tell (MediaRecorder WebM). */
  durationHint?: number | null
  /** Colour set for the panel the bar sits on. */
  tone?: 'light' | 'dark'
  className?: string
}

const KEY_STEP_SEC = 5
const PAGE_STEP_SEC = 30

/**
 * One thin line under the interview recording with a solid red mark wherever proctoring saw a deviation (looking
 * away, no face, multiple faces, head movement, phone, leaving the tab, …). Hover or focus a mark for
 * "Looked away · 03:42 (6s)"; click it or press Enter to jump there. A single summary line sits underneath.
 */
export function ProctorTimelineBar({ videoRef, events, flaggedSections, durationHint, tone = 'light', className }: Props) {
  const tipId = useId()
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [tipIndex, setTipIndex] = useState(-1)
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([])

  const markers = useMemo(() => buildTimelineMarkers(events, flaggedSections), [events, flaggedSections])
  const { durationSec, known } = resolveTimelineDuration(videoDuration, durationHint, markers)
  const placed = useMemo(() => placeMarkers(markers, durationSec), [markers, durationSec])
  const seekable = Boolean(videoRef)
  const pastEnd = seekable ? ' · after the end of the video' : ' · after the end of the interview'

  const summary = useMemo(() => timelineSummary(markers), [markers])

  useEffect(() => {
    const video = videoRef?.current
    if (!video) return
    let probingDuration = false
    const syncDuration = () => {
      const d = video.duration
      if (Number.isFinite(d) && d > 0) {
        setVideoDuration(d)
        if (probingDuration) {
          // Done measuring: put the playhead back where the reviewer expects it.
          probingDuration = false
          video.currentTime = 0
        }
      }
    }
    const onMetadata = () => {
      // MediaRecorder WebM has no duration in its header (Chrome reports Infinity). Seeking far past the end makes
      // the browser scan the file and fire durationchange with the real length.
      if (video.duration === Infinity && video.paused && video.currentTime === 0) {
        probingDuration = true
        try {
          video.currentTime = 1e101
        } catch {
          probingDuration = false
        }
      }
      syncDuration()
    }
    const onTime = () => {
      if (probingDuration) return
      const t = video.currentTime
      if (Number.isFinite(t)) setCurrentTime(t)
    }
    if (video.readyState >= 1) onMetadata()
    video.addEventListener('loadedmetadata', onMetadata)
    video.addEventListener('durationchange', syncDuration)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('seeked', onTime)
    return () => {
      video.removeEventListener('loadedmetadata', onMetadata)
      video.removeEventListener('durationchange', syncDuration)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('seeked', onTime)
    }
  }, [videoRef])

  const seekTo = useCallback(
    (sec: number) => {
      if (!videoRef) return
      setCurrentTime(seekVideo(videoRef.current, sec, durationSec))
    },
    [videoRef, durationSec],
  )

  function onTrackPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    seekTo(seekTargetForRatio((event.clientX - rect.left) / rect.width, durationSec))
  }

  function onTrackKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = {
      ArrowRight: KEY_STEP_SEC,
      ArrowUp: KEY_STEP_SEC,
      ArrowLeft: -KEY_STEP_SEC,
      ArrowDown: -KEY_STEP_SEC,
      PageUp: PAGE_STEP_SEC,
      PageDown: -PAGE_STEP_SEC,
    }
    if (event.key in steps) seekTo(currentTime + steps[event.key])
    else if (event.key === 'Home') seekTo(0)
    else if (event.key === 'End') seekTo(durationSec)
    else return
    event.preventDefault()
  }

  function onMarkerKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = stepMarkerIndex(placed.length, index, event.key)
    if (next === index) return
    event.preventDefault()
    setFocusIndex(next)
    markerRefs.current[next]?.focus()
  }

  // One tab stop for all marks (roving tabindex); it starts at the first mark at or after the playhead.
  const tabStop = focusIndex >= 0 && focusIndex < placed.length ? focusIndex : markerIndexAtTime(markers, currentTime)
  const playPct = Math.min(100, Math.max(0, (currentTime / durationSec) * 100))
  const tip = tipIndex >= 0 ? placed[tipIndex] : null
  const total = markers.length

  return (
    <div
      className={`${styles.root} ${tone === 'dark' ? styles.dark : ''} ${seekable ? '' : styles.static} ${className ?? ''}`}
      data-tone={tone}
      data-testid="proctor-timeline"
      data-seekable={seekable ? 'true' : 'false'}
    >
      <div className={styles.trackWrap}>
        {seekable ? (
        <div
          className={styles.track}
          role="slider"
          tabIndex={0}
          aria-label="Recording position"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSec)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTimelineClock(currentTime)} of ${known ? formatTimelineClock(durationSec) : 'unknown length'}`}
          onPointerDown={onTrackPointerDown}
          onKeyDown={onTrackKeyDown}
        >
          <span className={styles.rail} aria-hidden="true" />
          <span className={styles.played} style={{ width: `${playPct}%` }} aria-hidden="true" />
        </div>
        ) : (
          <div className={styles.track} aria-hidden="true">
            <span className={styles.rail} />
          </div>
        )}

        {placed.length ? (
          <div className={styles.markers} role="group" aria-label={
              seekable
                ? 'Deviation marks. Use the arrow keys to move between them.'
                : 'Deviation marks on the interview timeline. Use the arrow keys to move between them.'
            }>
            {placed.map((m, i) => {
              const text = markerTooltip(m) + (m.clamped ? pastEnd : '')
              return (
                <button
                  key={m.id}
                  ref={(el) => {
                    markerRefs.current[i] = el
                  }}
                  type="button"
                  data-testid="proctor-marker"
                  data-category={m.category}
                  className={[
                    styles.mark,
                    m.instant ? styles.tick : '',
                    m.severity === 'high' ? styles.high : '',
                    m.overlap ? styles.overlap : '',
                  ].join(' ')}
                  style={m.instant ? { left: `${m.leftPct}%` } : { left: `${m.leftPct}%`, width: `${m.widthPct}%` }}
                  tabIndex={i === tabStop ? 0 : -1}
                  aria-label={text}
                  aria-describedby={tipIndex === i ? tipId : undefined}
                  title={seekable ? undefined : text}
                  onClick={() => {
                    setFocusIndex(i)
                    if (seekable) seekTo(seekTargetForMarker(m, durationSec))
                    else setTipIndex(i)
                  }}
                  onKeyDown={(e) => onMarkerKeyDown(e, i)}
                  onFocus={() => {
                    setFocusIndex(i)
                    setTipIndex(i)
                  }}
                  onBlur={() => setTipIndex((cur) => (cur === i ? -1 : cur))}
                  onPointerEnter={() => setTipIndex(i)}
                  onPointerLeave={() => setTipIndex((cur) => (cur === i ? -1 : cur))}
                />
              )
            })}
          </div>
        ) : null}

        {seekable ? <div className={styles.playhead} style={{ left: `${playPct}%` }} aria-hidden="true" /> : null}

        {tip ? (
          <div
            id={tipId}
            role="tooltip"
            className={`${styles.tooltip} ${tip.leftPct < 15 ? styles.tooltipStart : tip.leftPct > 85 ? styles.tooltipEnd : ''}`}
            style={{ left: `${tip.instant ? tip.leftPct : tip.leftPct + tip.widthPct / 2}%` }}
          >
            {markerTooltip(tip)}
            {tip.clamped ? pastEnd : ''}
          </div>
        ) : null}
      </div>

      <p className={styles.summary}>
        <span className={total ? styles.countFlagged : styles.countClear} role="status" title={summary}>
          {summary}
        </span>
        {seekable ? (
          <span className={styles.clock} aria-hidden="true">
            {formatTimelineClock(currentTime)} / {known ? formatTimelineClock(durationSec) : '--:--'}
          </span>
        ) : (
          <span className={styles.clock}>{known ? `Interview length ${formatTimelineClock(durationSec)}` : 'Interview time'}</span>
        )}
      </p>
    </div>
  )
}
