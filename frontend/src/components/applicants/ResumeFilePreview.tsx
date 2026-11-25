import { useEffect, useRef, useState } from 'react'
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
  /** Candidates page: opens the stored file by user id. */
  candidateUserId?: string | null
  candidateName: string
  /** Extracted resume text, offered when the file itself cannot be shown. */
  fallbackText?: string
  onDownload?: () => void
  /** Called (instead of showing an error) when the API says no file is stored for this person. */
  onMissing?: () => void
}

/** The API's answer when the person never uploaded a file (their resume exists only as text, or not at all). */
function isMissingResumeFile(err: unknown): boolean {
  return err instanceof Error && /no stored resume file/i.test(err.message)
}

/**
 * The stored resume file, as the recruiter document viewer shows it: PDF in the browser's viewer, Word converted to
 * sanitised HTML, anything else with a Download button. The bytes always come through the API (never an S3 link in the
 * frame), so a storage failure shows "Resume file could not be loaded" with Retry and Download instead of a raw S3 error
 * page or a blank frame. The API decides who may see the file.
 */
export function ResumeFilePreview({ candidateEmail, candidateUserId, candidateName, fallbackText, onDownload, onMissing }: Props) {
  const onMissingRef = useRef(onMissing)
  useEffect(() => {
    onMissingRef.current = onMissing
  })
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    loading: boolean
    failed: boolean
    link: VendorCandidateDocumentLink | null
    docxHtml: string
    pdfUrl: string
    noFile?: boolean
  }>({ loading: true, failed: false, link: null, docxHtml: '', pdfUrl: '' })

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    setState({ loading: true, failed: false, link: null, docxHtml: '', pdfUrl: '' })
    void (async () => {
      let link: VendorCandidateDocumentLink | null = null
      try {
        const who = { userId: candidateUserId }
        link = await fetchVendorCandidateResumeDocument(candidateEmail, who)
        if (cancelled) return
        const docx = isDocxDocument(link.contentType, link.filename)
        if (!docx && !isPdf(link)) {
          setState({ loading: false, failed: false, link, docxHtml: '', pdfUrl: '' })
          return
        }
        const bytes = await fetchVendorCandidateResumeFile(candidateEmail, who)
        if (cancelled) return
        if (docx) {
          const html = await docxToSafeHtml(bytes)
          if (!cancelled) setState({ loading: false, failed: false, link, docxHtml: html, pdfUrl: '' })
          return
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setState({ loading: false, failed: false, link, docxHtml: '', pdfUrl: objectUrl })
      } catch (err) {
        if (cancelled) return
        const noFile = isMissingResumeFile(err)
        setState({ loading: false, failed: true, link, docxHtml: '', pdfUrl: '', noFile })
        if (noFile) onMissingRef.current?.()
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [candidateEmail, candidateUserId, attempt])

  const { loading, failed, link, docxHtml, pdfUrl, noFile } = state
  if (loading) {
    return (
      <div className={styles.pageSkeleton} role="status" aria-label="Loading the resume">
        {[90, 60, 75, 40, 85, 70, 55, 80].map((w, i) => (
          <span key={i} className="ds-skeleton ds-skeleton-line" style={{ width: `${w}%` }} />
        ))}
      </div>
    )
  }
  if (noFile && onMissing) return null
  if (pdfUrl && !failed) {
    return (
      <iframe
        className={styles.pdfFrame}
        title={`Resume of ${candidateName}`}
        src={`${pdfUrl}#toolbar=1&navpanes=0&view=FitH`}
        data-testid="resume-pdf-frame"
      />
    )
  }
  if (docxHtml) {
    // docxToSafeHtml keeps document markup only: no scripts, handlers, styles or unsafe URLs.
    return <article className={styles.docxPage} dangerouslySetInnerHTML={{ __html: docxHtml }} />
  }
  return (
    <div className={styles.panelNote} data-testid={failed ? 'resume-load-failed' : 'resume-no-preview'}>
      <p role={failed ? 'alert' : undefined}>
        <strong>{failed ? 'Resume file could not be loaded.' : 'This file type can’t be previewed in the browser.'}</strong>
        {failed ? ' Try again or use Download. If it keeps happening, contact support.' : ' Download it to read it.'}
        {fallbackText?.trim() ? ' The Profile tab still shows what it says.' : ''}
      </p>
      <div className={styles.noteActions}>
        {failed ? (
          <button type="button" className={styles.actBtn} onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        ) : null}
        {onDownload ? (
          <button type="button" className={styles.actBtn} onClick={onDownload}>
            Download
          </button>
        ) : link?.downloadUrl ? (
          <a className={styles.actBtn} href={link.downloadUrl} target="_blank" rel="noopener noreferrer">
            Download {link.filename || 'file'}
          </a>
        ) : null}
      </div>
    </div>
  )
}
