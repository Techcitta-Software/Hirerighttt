import { useEffect, useState } from 'react'
import { docxToSafeHtml, isDocxDocument } from '../../lib/docxPreview'
import {
  fetchVendorCandidateResumeDocument,
  fetchVendorCandidateResumeFile,
  type VendorCandidateDocumentLink,
} from '../../lib/vendorApi'
import styles from './Applicants.module.css'

function isPdf(link: VendorCandidateDocumentLink): boolean {
  return (link.contentType || '').toLowerCase().includes('pdf') || (link.filename || '').toLowerCase().endsWith('.pdf')
}

type Props = {
  candidateEmail: string
  /** Opens the stored file when the row has no e-mail (Candidates, contact hidden). */
  candidateUserId?: string | null
  candidateName: string
  /** Extracted resume text, offered when the file itself cannot be shown. */
  fallbackText?: string
  onDownload?: () => void
}

/**
 * The stored resume file, as the recruiter document viewer shows it: PDF in the browser's viewer, Word converted to
 * sanitised HTML, anything else as an "Open file" link. Same endpoints and access checks as
 * EmployerCandidateDocumentModal (the API decides who may see the file).
 */
export function ResumeFilePreview({ candidateEmail, candidateUserId, candidateName, fallbackText, onDownload }: Props) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    loading: boolean
    failed: boolean
    link: VendorCandidateDocumentLink | null
    docxHtml: string
  }>({ loading: true, failed: false, link: null, docxHtml: '' })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, failed: false, link: null, docxHtml: '' })
    void (async () => {
      try {
        const who = { userId: candidateUserId }
        const link = await fetchVendorCandidateResumeDocument(candidateEmail, who)
        if (cancelled) return
        if (isDocxDocument(link.contentType, link.filename)) {
          try {
            const html = await docxToSafeHtml(await fetchVendorCandidateResumeFile(candidateEmail, who))
            if (!cancelled) setState({ loading: false, failed: false, link, docxHtml: html })
          } catch {
            if (!cancelled) setState({ loading: false, failed: true, link, docxHtml: '' })
          }
          return
        }
        setState({ loading: false, failed: false, link, docxHtml: '' })
      } catch {
        if (!cancelled) setState({ loading: false, failed: true, link: null, docxHtml: '' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [candidateEmail, candidateUserId, attempt])

  const { loading, failed, link, docxHtml } = state
  if (loading) {
    return (
      <div className={styles.pageSkeleton} role="status" aria-label="Loading the resume">
        {[90, 60, 75, 40, 85, 70, 55, 80].map((w, i) => (
          <span key={i} className="ds-skeleton ds-skeleton-line" style={{ width: `${w}%` }} />
        ))}
      </div>
    )
  }
  if (link && isPdf(link) && !failed) {
    const src = link.viewUrl.includes('#') ? link.viewUrl : `${link.viewUrl}#toolbar=1&navpanes=0&view=FitH`
    return <iframe className={styles.pdfFrame} title={`Resume of ${candidateName}`} src={src} />
  }
  if (docxHtml) {
    // docxToSafeHtml keeps document markup only: no scripts, handlers, styles or unsafe URLs.
    return <article className={styles.docxPage} dangerouslySetInnerHTML={{ __html: docxHtml }} />
  }
  return (
    <div className={styles.panelNote}>
      <p role={failed ? 'alert' : undefined}>
        <strong>{failed ? 'Couldn’t load resume.' : 'This file type can’t be previewed in the browser.'}</strong>
        {fallbackText?.trim() ? ' The highlighted text view still shows its contents.' : ''}
      </p>
      <div className={styles.noteActions}>
        {failed ? (
          <button type="button" className={styles.actBtn} onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        ) : null}
        {link?.downloadUrl ? (
          <a className={styles.actBtn} href={link.downloadUrl} target="_blank" rel="noopener noreferrer">
            Open {link.filename || 'file'}
          </a>
        ) : onDownload ? (
          <button type="button" className={styles.actBtn} onClick={onDownload}>
            Download
          </button>
        ) : null}
      </div>
    </div>
  )
}
