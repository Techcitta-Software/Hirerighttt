import { useEffect, useState } from 'react'
import type { EmployerApplicant } from '../lib/store'
import {
  fetchVendorCandidateRecordingDocument,
  fetchVendorCandidateReportDocument,
  fetchVendorCandidateResumeDocument,
  fetchVendorInterviewReview,
  type VendorCandidateDocumentLink,
  type VendorCandidateRecordingLink,
} from '../lib/vendorApi'
import { InterviewRecordingPlayer } from './InterviewRecordingPlayer'
import { HrIcon } from './HrIcon'
import styles from './EmployerCandidateDocumentModal.module.css'

export type EmployerDocumentKind = 'resume' | 'report'

type Props = {
  kind: EmployerDocumentKind
  applicant: EmployerApplicant
  onClose: () => void
}

function isPdfDocument(link: VendorCandidateDocumentLink): boolean {
  const type = (link.contentType || '').toLowerCase()
  const name = (link.filename || '').toLowerCase()
  return type.includes('pdf') || name.endsWith('.pdf')
}

function pdfViewUrl(viewUrl: string): string {
  const hash = 'toolbar=1&navpanes=0&scrollbar=1&view=FitH'
  return viewUrl.includes('#') ? viewUrl : `${viewUrl}#${hash}`
}

export function EmployerCandidateDocumentModal({ kind, applicant, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [documentLink, setDocumentLink] = useState<VendorCandidateDocumentLink | null>(null)
  const [recordingLink, setRecordingLink] = useState<VendorCandidateRecordingLink | null>(null)
  const [recordingLoading, setRecordingLoading] = useState(false)
  const [recordingError, setRecordingError] = useState('')
  const isResume = kind === 'resume'
  const title = isResume
    ? `Resume — ${applicant.candidateName}`
    : `HireRighttt report — ${applicant.candidateName}`

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    setDocumentLink(null)
    setRecordingLink(null)
    setRecordingError('')
    setRecordingLoading(false)

    void (async () => {
      try {
        const primary = isResume
          ? await fetchVendorCandidateResumeDocument(applicant.candidateEmail)
          : await fetchVendorCandidateReportDocument(applicant.candidateEmail)

        if (cancelled) return
        setDocumentLink(primary)

        const sessionHint =
          primary.sessionId ||
          applicant.interviewResult?.sessionId ||
          null

        setRecordingLoading(true)
        try {
          const recordingPromise = fetchVendorCandidateRecordingDocument(
            applicant.candidateEmail,
            sessionHint,
          )
          const reviewPromise = sessionHint
            ? fetchVendorInterviewReview(sessionHint, applicant.candidateEmail)
            : null

          let rec: VendorCandidateRecordingLink | null = null
          try {
            rec = await recordingPromise
          } catch {
            rec = null
          }

          let review: Awaited<ReturnType<typeof fetchVendorInterviewReview>> | null = null
          if (reviewPromise) {
            try {
              review = await reviewPromise
            } catch {
              review = null
            }
          } else if (rec?.sessionId) {
            try {
              review = await fetchVendorInterviewReview(
                rec.sessionId,
                applicant.candidateEmail,
              )
            } catch {
              review = null
            }
          }

          if (cancelled) return

          const sid = rec?.sessionId || sessionHint || null
          const playbackFromRecording = rec?.playbackUrl || rec?.viewUrl
          const playbackFromReview = review?.videoUrl || null

          if (playbackFromRecording) {
            setRecordingLink(rec)
          } else if (playbackFromReview) {
            setRecordingLink({
              viewUrl: playbackFromReview,
              downloadUrl: playbackFromReview,
              playbackUrl: playbackFromReview,
              expiresInSeconds: null,
              contentType: 'video/webm',
              filename: 'interview_recording.webm',
              sessionId: sid || undefined,
            })
          } else if (!isResume) {
            setRecordingError(
              'No interview video found for this session yet. If they just finished, wait a minute and reopen the report.',
            )
          }
        } catch (recErr) {
          if (!cancelled && !isResume) {
            setRecordingError(
              recErr instanceof Error ? recErr.message : 'Interview video is unavailable.',
            )
          }
        } finally {
          if (!cancelled) setRecordingLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load document.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    isResume,
    applicant.candidateEmail,
    applicant.candidateName,
    applicant.interviewResult?.sessionId,
  ])

  function handleDownload() {
    if (!documentLink?.downloadUrl) return
    window.open(documentLink.downloadUrl, '_blank', 'noopener,noreferrer')
  }

  const pdfReady = documentLink && isPdfDocument(documentLink)
  const playbackUrl = recordingLink?.playbackUrl || recordingLink?.viewUrl

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="employer-doc-title">
      <div className={styles.modalWide}>
        <div className={styles.header}>
          <div>
            <h2 id="employer-doc-title">
              <HrIcon name={isResume ? 'document' : 'sparkle'} size={18} /> {title}
            </h2>
            {!isResume && (
              <p className={styles.subtitle}>
                {applicant.jobTitle}
                {applicant.company ? ` · ${applicant.company}` : ''}
              </p>
            )}
            {documentLink?.filename ? (
              <p className={styles.subtitle}>{documentLink.filename}</p>
            ) : null}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <HrIcon name="close" size={16} />
          </button>
        </div>

        <div className={styles.bodyScroll}>
          {loading ? (
            <p className={styles.loading}>Loading document from secure storage…</p>
          ) : loadError && !documentLink ? (
            <p className={styles.empty} role="alert">
              {loadError}
            </p>
          ) : (
            <div className={styles.scrollStack}>
              <section className={styles.resumeSection} aria-label={isResume ? 'Resume preview' : 'Report preview'}>
                {pdfReady ? (
                  <>
                    <p className={styles.sectionHint}>
                      {isResume
                        ? 'Scroll down for the interview recording when available.'
                        : 'HireRighttt scorecard PDF — scroll down for this candidate’s original interview video.'}
                    </p>
                    <iframe
                      className={styles.docFrameTwoPage}
                      title={title}
                      src={pdfViewUrl(documentLink!.viewUrl)}
                    />
                  </>
                ) : documentLink ? (
                  <div className={styles.fallbackLink}>
                    <p>This file is not a PDF preview in the browser.</p>
                    <button type="button" className={styles.primaryBtn} onClick={handleDownload}>
                      Open {documentLink.filename || 'file'}
                    </button>
                  </div>
                ) : !loadError ? (
                  <p className={styles.empty}>No document available.</p>
                ) : null}
              </section>

              {!isResume ? (
                <section className={styles.videoSection} aria-label="Interview video">
                  <div className={styles.videoSectionHeader}>
                    <HrIcon name="video" size={18} />
                    <h3 className={styles.videoTitle}>Interview video</h3>
                  </div>

                  {recordingLoading ? (
                    <p className={styles.loading}>Loading interview video…</p>
                  ) : playbackUrl ? (
                    <InterviewRecordingPlayer
                      playbackUrl={playbackUrl}
                      events={[]}
                      durationHint={recordingLink?.durationSeconds}
                    />
                  ) : recordingError ? (
                    <p className={styles.recordingNote} role="status">
                      {recordingError}
                    </p>
                  ) : (
                    <p className={styles.recordingNote}>No interview recording on file for this candidate.</p>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </div>

        <div className={styles.footer} data-download-exclude>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!documentLink?.downloadUrl}
            onClick={handleDownload}
          >
            <HrIcon name="download" size={16} />
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
