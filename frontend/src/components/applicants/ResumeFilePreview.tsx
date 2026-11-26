import { useEffect, useRef, useState } from 'react'
import { docxToSafeHtml, isDocxDocument } from '../../lib/docxPreview'
import {
  fetchVendorCandidateResumeDownload,
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

function headerStartsWith(data: ArrayBuffer, marker: string): boolean {
  if (data.byteLength < marker.length) return false
  const bytes = new Uint8Array(data, 0, marker.length)
  for (let i = 0; i < marker.length; i += 1) {
    if (bytes[i] !== marker.charCodeAt(i)) return false
  }
  return true
}

/**
 * The stored resume file, as the recruiter document viewer shows it: PDF in the browser's viewer, Word converted to
 * sanitised HTML, anything else with a Download button. The bytes always come through the API (never an S3 link in the
 * frame). When that fetch fails, the extracted resume text is shown in the panel so it does not stay blank. The API
 * decides who may see the file.
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
        const file = await fetchVendorCandidateResumeDownload(candidateEmail, who)
        if (cancelled) return
        link = {
          viewUrl: '',
          downloadUrl: '',
          expiresInSeconds: null,
          contentType: file.contentType,
          filename: file.filename,
        }
        const pdfMagic = headerStartsWith(file.data, '%PDF')
        const zipMagic = headerStartsWith(file.data, 'PK')
        const namedPdf = (file.filename || '').toLowerCase().endsWith('.pdf')
        const pdf = pdfMagic || isPdf(link)
        // A PK zip whose name is not already .pdf is a Word file, even when the stored type is text/plain.
        const docx = !pdf && (isDocxDocument(link.contentType, link.filename) || (zipMagic && !namedPdf))
        if (docx) {
          const html = await docxToSafeHtml(file.data)
          if (!cancelled) setState({ loading: false, failed: false, link, docxHtml: html, pdfUrl: '' })
          return
        }
        if (pdf) {
          objectUrl = URL.createObjectURL(new Blob([file.data], { type: 'application/pdf' }))
          setState({ loading: false, failed: false, link, docxHtml: '', pdfUrl: objectUrl })
          return
        }
        setState({ loading: false, failed: false, link, docxHtml: '', pdfUrl: '' })
      } catch (err) {
        if (cancelled) return
        const noFile = isMissingResumeFile(err)
        setState({ loading: false, failed: true, link, docxHtml: '', pdfUrl: '', noFile })
        // The parent swaps in an empty state that hides this panel. Keep the extracted text on screen instead.
        if (noFile && !fallbackText?.trim()) onMissingRef.current?.()
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [candidateEmail, candidateUserId, attempt, fallbackText])

  const { loading, failed, link, docxHtml, pdfUrl } = state
  if (loading) {
    return (
      <div className={styles.pageSkeleton} role="status" aria-label="Loading the resume">
        {[90, 60, 75, 40, 85, 70, 55, 80].map((w, i) => (
          <span key={i} className="ds-skeleton ds-skeleton-line" style={{ width: `${w}%` }} />
        ))}
      </div>
    )
  }
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
  if (failed && fallbackText?.trim()) {
    return (
      <div data-testid="resume-text-fallback">
        <p className={styles.panelNote}>The original file could not be loaded.</p>
        <article className={styles.docxPage} style={{ whiteSpace: 'pre-wrap' }}>
          {fallbackText.trim()}
        </article>
        <div className={styles.noteActions}>
          <button type="button" className={styles.actBtn} onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      </div>
    )
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
