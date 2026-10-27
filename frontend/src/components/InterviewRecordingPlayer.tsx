import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import type { IntegrityLogEvent, InterviewFlagSection, InterviewProctoringSummary } from '../lib/store'
import {
  clearOverlayCanvas,
  drawRedFaceMesh,
  flagAtTime,
  getPlaybackFaceLandmarker,
} from '../lib/proctorPlaybackLandmarks'
import { reviewEventsToFlagSections } from '../lib/reviewEventsToFlagSections'
import styles from './InterviewRecordingPlayer.module.css'

type Props = {
  playbackUrl: string
  events?: IntegrityLogEvent[]
  proctoring?: InterviewProctoringSummary | null
  durationHint?: number | null
  /** Recruiter view: timeline + flag list under the video. */
  employerReview?: boolean
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function flagTypeLabel(type: InterviewFlagSection['type']) {
  if (type === 'MULTI_FACE') return 'Multiple people'
  if (type === 'NO_FACE') return 'No face in frame'
  return 'Looking away / gaze deviation'
}

export function InterviewRecordingPlayer({
  playbackUrl,
  events = [],
  proctoring,
  durationHint,
  employerReview = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const landmarkerTsRef = useRef(-1)
  const [duration, setDuration] = useState(durationHint && durationHint > 0 ? durationHint : 0)
  const [currentTime, setCurrentTime] = useState(0)
  const [activeFlag, setActiveFlag] = useState<InterviewFlagSection | null>(null)

  const flaggedSections = useMemo(() => {
    const fromProctor = proctoring?.flaggedSections ?? []
    if (fromProctor.length) return fromProctor
    if (employerReview && events.length) return reviewEventsToFlagSections(events)
    return []
  }, [proctoring, events, employerReview])

  const flagCount = flaggedSections.length
  const showReviewPanel = employerReview

  const effectiveDuration = useMemo(() => {
    const fromVideo = duration > 0 ? duration : 0
    const fromFlags = flaggedSections.length
      ? Math.max(...flaggedSections.map((f) => f.endSec))
      : 0
    const fromEvents = events
      .filter((e) => typeof e.startOffsetSec === 'number')
      .map((e) => (e.startOffsetSec ?? 0) + (e.durationSec ?? 1))
    const fromEv = fromEvents.length ? Math.max(...fromEvents) : 0
    return Math.max(fromVideo, fromFlags, fromEv, 1)
  }, [duration, flaggedSections, events])

  const seekTo = useCallback(
    (sec: number) => {
      const video = videoRef.current
      if (!video) return
      const t = Math.min(Math.max(0, sec), effectiveDuration)
      video.currentTime = t
      setCurrentTime(t)
      void video.play().catch(() => {})
    },
    [effectiveDuration],
  )

  function onTrackClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    seekTo(ratio * effectiveDuration)
  }

  const progressPct = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0

  useEffect(() => {
    if (!employerReview) return
    let cancelled = false
    void getPlaybackFaceLandmarker().then((lm) => {
      if (!cancelled) landmarkerRef.current = lm
    })
    return () => {
      cancelled = true
      landmarkerRef.current?.close()
      landmarkerRef.current = null
    }
  }, [employerReview])

  useEffect(() => {
    if (!employerReview) return
    let raf = 0
    const syncCanvasSize = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) return
      const w = video.clientWidth
      const h = video.clientHeight
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w
        canvas.height = h
      }
    }

    const tick = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      const lm = landmarkerRef.current
      syncCanvasSize()
      if (!video || !canvas) {
        raf = requestAnimationFrame(tick)
        return
      }

      const t = video.currentTime
      const flag = flagAtTime(flaggedSections, t)
      setActiveFlag(flag)

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        raf = requestAnimationFrame(tick)
        return
      }

      clearOverlayCanvas(canvas)

      if (flag && !video.paused && !video.ended && lm && video.readyState >= 2) {
        let ts = Math.floor(performance.now())
        if (ts <= landmarkerTsRef.current) ts = landmarkerTsRef.current + 1
        landmarkerTsRef.current = ts
        try {
          const res = lm.detectForVideo(video, ts)
          const faces = res.faceLandmarks || []
          if (faces.length === 0 && flag.type === 'NO_FACE') {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.35)'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.fillStyle = '#fff'
            ctx.font = '600 14px system-ui, sans-serif'
            ctx.fillText('No face in frame (flagged interval)', 12, 28)
          }
          faces.forEach((faceLm, idx) => {
            const mode =
              flag.type === 'MULTI_FACE' && idx > 0
                ? 'MULTI_FACE'
                : flag.type === 'NO_FACE'
                  ? 'NO_FACE'
                  : flag.type
            drawRedFaceMesh(ctx, faceLm, canvas.width, canvas.height, mode)
          })
        } catch {
          /* skip frame */
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [employerReview, flaggedSections])

  return (
    <div className={styles.wrap}>
      <div
        className={`${styles.videoShell} ${activeFlag ? styles.videoShellFlagged : ''}`}
      >
        <video
          ref={videoRef}
          className={styles.video}
          controls
          playsInline
          preload="metadata"
          src={playbackUrl}
          onLoadedMetadata={() => {
            const d = videoRef.current?.duration
            if (d && Number.isFinite(d)) setDuration(d)
          }}
          onTimeUpdate={() => {
            const t = videoRef.current?.currentTime
            if (t != null && Number.isFinite(t)) setCurrentTime(t)
          }}
        >
          Your browser does not support video playback.
        </video>
        {employerReview ? (
          <canvas ref={canvasRef} className={styles.overlayCanvas} aria-hidden="true" />
        ) : null}
        {employerReview && flagCount > 0 ? (
          <div className={styles.inVideoTimeline} aria-hidden="true">
            <div className={styles.inVideoProgress} style={{ width: `${progressPct}%` }} />
            {flaggedSections.map((flag) => {
              const left = (flag.startSec / effectiveDuration) * 100
              const width = Math.max(1.2, ((flag.endSec - flag.startSec) / effectiveDuration) * 100)
              const isHigh = flag.severity === 'high' || flag.type === 'MULTI_FACE'
              return (
                <span
                  key={flag.id}
                  className={isHigh ? styles.inVideoFlagHigh : styles.inVideoFlagMedium}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              )
            })}
          </div>
        ) : null}
        {activeFlag ? (
          <div className={styles.liveFlagBadge} role="status">
            MediaPipe · {flagTypeLabel(activeFlag.type)}
          </div>
        ) : null}
      </div>

      {showReviewPanel ? (
        <>
          <div className={styles.summaryBar} role="status">
            <span className={styles.summaryCount}>
              {flagCount} proctor flag{flagCount === 1 ? '' : 's'}
            </span>
            {proctoring ? (
              <span className={styles.summaryMeta}>
                Integrity {proctoring.integrityScore}/100 ·{' '}
                {proctoring.status === 'FLAGGED' ? 'Review recommended' : 'Clear'}
              </span>
            ) : flagCount > 0 ? (
              <span className={styles.summaryMeta}>From live camera review events</span>
            ) : (
              <span className={styles.summaryMeta}>
                Red mesh appears on video during flagged intervals (MediaPipe). Take a new interview
                with camera on if empty.
              </span>
            )}
          </div>

          <div className={styles.timelineLabel}>
            <span>Flagged sections — red marks on video when playback hits these times</span>
            <span className={styles.timelineClock}>
              {formatClock(currentTime)} / {formatClock(effectiveDuration)}
            </span>
          </div>

          <div
            className={styles.timelineTrack}
            role="slider"
            aria-label="Interview timeline with proctoring flags"
            aria-valuemin={0}
            aria-valuemax={Math.round(effectiveDuration)}
            aria-valuenow={Math.round(currentTime)}
            tabIndex={0}
            onClick={onTrackClick}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') seekTo(currentTime + 5)
              if (e.key === 'ArrowLeft') seekTo(currentTime - 5)
            }}
          >
            <div className={styles.timelinePlayed} style={{ width: `${progressPct}%` }} />
            {flaggedSections.map((flag) => {
              const left = (flag.startSec / effectiveDuration) * 100
              const width = Math.max(0.8, ((flag.endSec - flag.startSec) / effectiveDuration) * 100)
              const isHigh = flag.severity === 'high' || flag.type === 'MULTI_FACE'
              return (
                <button
                  key={flag.id}
                  type="button"
                  className={isHigh ? styles.timelineFlagHigh : styles.timelineFlagMedium}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`Turn ${flag.turnIndex}: ${flag.reason}`}
                  aria-label={`${flagTypeLabel(flag.type)} at ${formatClock(flag.startSec)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    seekTo(Math.max(0, flag.startSec - 0.3))
                  }}
                />
              )
            })}
          </div>

          {flagCount > 0 ? (
            <ul className={styles.flagList}>
              {flaggedSections.map((flag) => (
                <li key={flag.id}>
                  <button
                    type="button"
                    className={styles.flagRow}
                    onClick={() => seekTo(Math.max(0, flag.startSec - 0.3))}
                  >
                    <span
                      className={
                        flag.severity === 'high' || flag.type === 'MULTI_FACE'
                          ? styles.flagDotHigh
                          : styles.flagDotMedium
                      }
                      aria-hidden="true"
                    />
                    <span className={styles.flagTime}>
                      {formatClock(flag.startSec)}–{formatClock(flag.endSec)}
                    </span>
                    <span className={styles.flagMsg}>
                      <strong>{flagTypeLabel(flag.type)}</strong> · Turn #{flag.turnIndex} ·{' '}
                      {flag.reason}
                      {flag.questionText ? (
                        <span className={styles.flagQuestion}>
                          {' '}
                          — &ldquo;{flag.questionText}&rdquo;
                        </span>
                      ) : null}
                      {flag.snapshotDataUrl ? (
                        <img
                          className={styles.flagSnapshot}
                          src={flag.snapshotDataUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.noFlags}>
              No sustained gaze or head-turn intervals were saved for this session. During the live
              interview, MediaPipe must run (camera allowed, stable network). Look away for 2+ seconds
              to generate a flag on a new attempt.
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
