import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { IntegrityLogEvent } from '../lib/store'
import styles from './InterviewRecordingPlayer.module.css'

type Props = {
  playbackUrl: string
  events: IntegrityLogEvent[]
  durationHint?: number | null
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function InterviewRecordingPlayer({ playbackUrl, events, durationHint }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(durationHint && durationHint > 0 ? durationHint : 0)
  const [currentTime, setCurrentTime] = useState(0)

  const reviewMarkers = useMemo(() => {
    return events
      .filter((e) => typeof e.startOffsetSec === 'number' && Number.isFinite(e.startOffsetSec))
      .map((e) => {
        const start = Math.max(0, e.startOffsetSec ?? 0)
        const dur = Math.max(0.35, e.durationSec ?? 1.5)
        return {
          id: e.id,
          start,
          end: start + dur,
          message: e.message,
          eventType: e.eventType,
          formattedTime: e.formattedTime || formatClock(start),
        }
      })
      .sort((a, b) => a.start - b.start)
  }, [events])

  const effectiveDuration = duration > 0 ? duration : Math.max(...reviewMarkers.map((m) => m.end), 1)

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

  return (
    <div className={styles.wrap}>
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

      <div className={styles.timelineLabel}>
        <span>MediaPipe integrity timeline</span>
        <span className={styles.timelineClock}>
          {formatClock(currentTime)} / {formatClock(effectiveDuration)}
        </span>
      </div>

      <div
        className={styles.timelineTrack}
        role="slider"
        aria-label="Interview timeline with integrity flags"
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
        {reviewMarkers.map((m) => {
          const left = (m.start / effectiveDuration) * 100
          const width = Math.max(0.6, ((m.end - m.start) / effectiveDuration) * 100)
          return (
            <button
              key={m.id}
              type="button"
              className={styles.timelineFlag}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${m.formattedTime} — ${m.message}`}
              aria-label={`Integrity flag at ${m.formattedTime}: ${m.message}`}
              onClick={(e) => {
                e.stopPropagation()
                seekTo(m.start)
              }}
            />
          )
        })}
      </div>

      {reviewMarkers.length > 0 ? (
        <ul className={styles.flagList}>
          {reviewMarkers.map((m) => (
            <li key={m.id}>
              <button type="button" className={styles.flagRow} onClick={() => seekTo(m.start)}>
                <span className={styles.flagDot} aria-hidden="true" />
                <span className={styles.flagTime}>{m.formattedTime}</span>
                <span className={styles.flagMsg}>{m.message}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.noFlags}>No MediaPipe integrity flags for this interview.</p>
      )}
    </div>
  )
}
