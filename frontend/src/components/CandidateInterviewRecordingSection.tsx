import { useEffect, useState } from 'react'
import { fetchInterviewRecordingPlayback } from '../lib/interviewRecordingUpload'
import { InterviewRecordingPlayer } from './InterviewRecordingPlayer'
import styles from './CandidateInterviewRecordingSection.module.css'

type Props = {
  sessionId?: string | null
  /** Local blob URL while S3 upload finishes (post-interview analyzing). */
  localPreviewUrl?: string | null
  title?: string
  description?: string
}

export function CandidateInterviewRecordingSection({
  sessionId,
  localPreviewUrl,
  title = 'Your interview recording',
  description,
}: Props) {
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [durationHint, setDurationHint] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')

  const playbackUrl = remoteUrl || localPreviewUrl || null

  useEffect(() => {
    const sid = sessionId?.trim() ?? ''
    if (!sid) return
    let cancelled = false
    let attempts = 0
    let found = false
    const maxAttempts = 10

    async function loadPlayback() {
      if (cancelled) return
      setLoading(true)
      if (attempts === 0) setNote('')
      try {
        const link = await fetchInterviewRecordingPlayback(sid)
        if (cancelled) return
        if (link?.playbackUrl) {
          found = true
          setRemoteUrl(link.playbackUrl)
          setDurationHint(link.durationSeconds ?? null)
          setNote('')
          setLoading(false)
          return
        }
      } catch (err) {
        if (!cancelled && !localPreviewUrl && attempts >= maxAttempts - 1) {
          setNote(err instanceof Error ? err.message : 'Recording not available yet.')
        }
      }
      attempts += 1
      if (attempts < maxAttempts && !cancelled && !found) {
        setNote('Loading your interview video from secure storage…')
        window.setTimeout(() => void loadPlayback(), 2000)
        return
      }
      if (!cancelled && !localPreviewUrl && !found) {
        setNote(
          'Interview video is not ready yet. If you just finished, wait a moment and refresh this page.',
        )
      }
      if (!cancelled) setLoading(false)
    }

    void loadPlayback()
    return () => {
      cancelled = true
    }
  }, [sessionId, localPreviewUrl])

  if (!sessionId?.trim() && !playbackUrl) {
    return null
  }

  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      {description ? <p className={styles.lead}>{description}</p> : null}
      {loading && !playbackUrl ? (
        <p className={styles.status} role="status">
          Loading your interview video…
        </p>
      ) : null}
      {playbackUrl ? (
        <InterviewRecordingPlayer
          playbackUrl={playbackUrl}
          events={[]}
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
