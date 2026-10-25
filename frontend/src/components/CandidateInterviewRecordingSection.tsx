import { useEffect, useState } from 'react'
import type { IntegrityLogEvent } from '../lib/store'
import { fetchInterviewRecordingPlayback } from '../lib/interviewRecordingUpload'
import { InterviewRecordingPlayer } from './InterviewRecordingPlayer'
import styles from './CandidateInterviewRecordingSection.module.css'

type Props = {
  sessionId?: string | null
  /** Local blob URL while S3 upload finishes (post-interview analyzing). */
  localPreviewUrl?: string | null
  reviewEvents?: IntegrityLogEvent[]
  title?: string
}

export function CandidateInterviewRecordingSection({
  sessionId,
  localPreviewUrl,
  reviewEvents = [],
  title = 'Your interview recording',
}: Props) {
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [durationHint, setDurationHint] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')

  const playbackUrl = remoteUrl || localPreviewUrl || null

  useEffect(() => {
    if (!sessionId?.trim()) return
    let cancelled = false
    setLoading(true)
    setNote('')
    void fetchInterviewRecordingPlayback(sessionId)
      .then((link) => {
        if (cancelled) return
        if (link?.playbackUrl) {
          setRemoteUrl(link.playbackUrl)
          setDurationHint(link.durationSeconds ?? null)
        }
      })
      .catch((err) => {
        if (!cancelled && !localPreviewUrl) {
          setNote(err instanceof Error ? err.message : 'Recording not available yet.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, localPreviewUrl])

  if (!playbackUrl && !loading && !note && !sessionId) {
    return null
  }

  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.lead}>
        Full camera and microphone capture from your session. Stored securely in cloud storage when
        upload succeeds.
      </p>
      {loading && !playbackUrl ? (
        <p className={styles.status} role="status">
          Loading your interview video…
        </p>
      ) : null}
      {playbackUrl ? (
        <InterviewRecordingPlayer
          playbackUrl={playbackUrl}
          events={reviewEvents}
          durationHint={durationHint}
        />
      ) : note ? (
        <p className={styles.status} role="status">
          {note}
        </p>
      ) : null}
    </section>
  )
}
