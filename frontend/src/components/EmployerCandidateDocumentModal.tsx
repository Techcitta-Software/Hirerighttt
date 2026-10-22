import { useEffect, useState } from 'react'
import type { EmployerApplicant } from '../lib/store'
import {
  fetchVendorCandidateReportDocument,
  fetchVendorCandidateResumeDocument,
  type VendorCandidateDocumentLink,
} from '../lib/vendorApi'
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

export function EmployerCandidateDocumentModal({ kind, applicant, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [documentLink, setDocumentLink] = useState<VendorCandidateDocumentLink | null>(null)

  const isResume = kind === 'resume'
  const title = isResume
    ? `Resume — ${applicant.candidateName}`
    : `HireRighttt report — ${applicant.candidateName}`

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    setDocumentLink(null)
    void (async () => {
      try {
        const link = isResume
          ? await fetchVendorCandidateResumeDocument(applicant.candidateEmail)
          : await fetchVendorCandidateReportDocument(applicant.candidateEmail)
        if (!cancelled) setDocumentLink(link)
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
  }, [isResume, applicant.candidateEmail])

  function handleDownload() {
    if (!documentLink?.downloadUrl) return
    window.open(documentLink.downloadUrl, '_blank', 'noopener,noreferrer')
  }

  const pdfReady = documentLink && isPdfDocument(documentLink)

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

        <div className={styles.body}>
          {loading ? (
            <p className={styles.loading}>Loading document from secure storage…</p>
          ) : loadError ? (
            <p className={styles.empty} role="alert">
              {loadError}
            </p>
          ) : pdfReady ? (
            <iframe
              className={styles.docFrame}
              title={title}
              src={documentLink.viewUrl}
            />
          ) : documentLink ? (
            <div className={styles.fallbackLink}>
              <p>This file is not a PDF preview in the browser.</p>
              <button type="button" className={styles.primaryBtn} onClick={handleDownload}>
                Open {documentLink.filename || 'file'}
              </button>
            </div>
          ) : (
            <p className={styles.empty}>No document available.</p>
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
