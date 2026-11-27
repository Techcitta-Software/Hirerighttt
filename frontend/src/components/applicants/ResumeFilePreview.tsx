import { useEffect, useRef, useState } from 'react'
import { docxToSafeHtml, isDocxDocument } from '../../lib/docxPreview'
import {
  fetchVendorCandidateResumeDocument,
  fetchVendorCandidateResumeDownload,
  type VendorCandidateDocumentLink,
} from '../../lib/vendorApi'
import styles from './Applicants.module.css'

function isPdf(link: Pick<VendorCandidateDocumentLink, 'contentType' | 'filename'>): boolean {
  return (link.contentType || '').toLowerCase().includes('pdf') || (link.filename || '').toLowerCase().endsWith('.pdf')
}

/** A plain-text resume. Checked before the PDF path so a .txt file is never opened as a failed PDF. */
function isPlainTextResume(contentType: string | undefined, filename: string | undefined): boolean {
  const type = (contentType || '').toLowerCase()
  const name = (filename || '').toLowerCase()
  return type.includes('text/plain') || name.endsWith('.txt')
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

/** Browser PDF viewer chrome. Applied to the S3 URL or a blob URL of the original bytes. */
export function pdfFrameSrc(url: string): string {
  const hash = 'toolbar=1&navpanes=0&view=FitH'
  return url.includes('#') ? url : `${url}#${hash}`
}

export type LoadedResumePreview =
  | { ok: true; link: VendorCandidateDocumentLink; mode: 'pdf-url'; viewUrl: string }
  /** Original bytes, unchanged, and only when they start with %PDF. */
  | { ok: true; link: VendorCandidateDocumentLink; mode: 'pdf-bytes'; data: ArrayBuffer }
  /** HTML built from the original Word bytes, never from extracted resume text. */
  | { ok: true; link: VendorCandidateDocumentLink; mode: 'docx-html'; html: string }
  /** The original .txt / text/plain bytes, decoded. Not a failed PDF. */
  | { ok: true; link: VendorCandidateDocumentLink; mode: 'text'; text: string }
  /** Open or download the original object. No rewritten stand-in. */
  | { ok: true; link: VendorCandidateDocumentLink; mode: 'file' }
  | { ok: false; missing: boolean }

function withFileMeta(
  link: VendorCandidateDocumentLink,
  file: { contentType: string; filename: string },
): VendorCandidateDocumentLink {
  return {
    ...link,
    contentType: file.contentType || link.contentType,
    filename: file.filename || link.filename,
  }
}

function isWordBytes(link: Pick<VendorCandidateDocumentLink, 'contentType' | 'filename'>, data: ArrayBuffer): boolean {
  if (isPdf(link) || headerStartsWith(data, '%PDF')) return false
  if (isDocxDocument(link.contentType, link.filename)) return true
  const namedPdf = (link.filename || '').toLowerCase().endsWith('.pdf')
  return headerStartsWith(data, 'PK') && !namedPdf
}

/**
 * The original uploaded file. A PDF with a presigned S3 URL is shown from that URL. An empty URL falls back to the
 * raw bytes, and those become a blob only when they are a PDF. A Word file is opened or downloaded as the original
 * object; HTML is used only when there is no S3 URL and it is converted from those same bytes.
 */
export async function loadVendorResumePreview(
  candidateEmail: string,
  candidateUserId?: string | null,
): Promise<LoadedResumePreview> {
  const who = { userId: candidateUserId }
  let link: VendorCandidateDocumentLink
  try {
    link = await fetchVendorCandidateResumeDocument(candidateEmail, who)
  } catch (err) {
    return { ok: false, missing: isMissingResumeFile(err) }
  }

  const viewUrl = (link.viewUrl || '').trim()
  if (isPlainTextResume(link.contentType, link.filename)) {
    let file: { data: ArrayBuffer; filename: string; contentType: string }
    try {
      file = await fetchVendorCandidateResumeDownload(candidateEmail, who)
    } catch (err) {
      return { ok: false, missing: isMissingResumeFile(err) }
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(file.data)
    return { ok: true, link: withFileMeta(link, file), mode: 'text', text }
  }

  if (isPdf(link) && viewUrl) {
    return { ok: true, link, mode: 'pdf-url', viewUrl }
  }

  // The browser has no S3 URL. Use the original bytes, and preview a PDF only when the bytes say so.
  if (!viewUrl) {
    let file: { data: ArrayBuffer; filename: string; contentType: string }
    try {
      file = await fetchVendorCandidateResumeDownload(candidateEmail, who)
    } catch (err) {
      return { ok: false, missing: isMissingResumeFile(err) }
    }
    const next = withFileMeta(link, file)
    if (headerStartsWith(file.data, '%PDF')) {
      return { ok: true, link: next, mode: 'pdf-bytes', data: file.data }
    }
    if (isWordBytes(next, file.data)) {
      try {
        const html = await docxToSafeHtml(file.data)
        return { ok: true, link: next, mode: 'docx-html', html }
      } catch {
        return { ok: true, link: next, mode: 'file' }
      }
    }
    return { ok: true, link: next, mode: 'file' }
  }

  // Word and every other type: the presigned object is the file. Do not rewrite it into another document.
  return { ok: true, link, mode: 'file' }
}

type Props = {
  candidateEmail: string
  /** Candidates page: opens the stored file by user id. */
  candidateUserId?: string | null
  candidateName: string
  onDownload?: () => void
  /** Called (instead of showing an error) when the API says no file is stored for this person. */
  onMissing?: () => void
}

/**
 * The stored resume file: a PDF in the browser's viewer from the presigned S3 URL, a Word file as that original
 * object (HTML only from its own bytes when S3 gave no URL). A text/plain or .txt file is shown from those bytes.
 * Extracted resume text is never substituted for a PDF or Word file.
 */
export function ResumeFilePreview({ candidateEmail, candidateUserId, candidateName, onDownload, onMissing }: Props) {
  const onMissingRef = useRef(onMissing)
  useEffect(() => {
    onMissingRef.current = onMissing
  })
  const [attempt, setAttempt] = useState(0)
  const [plainText, setPlainText] = useState('')
  const [state, setState] = useState<{
    loading: boolean
    failed: boolean
    link: VendorCandidateDocumentLink | null
    docxHtml: string
    pdfUrl: string
  }>({ loading: true, failed: false, link: null, docxHtml: '', pdfUrl: '' })

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    setPlainText('')
    setState({ loading: true, failed: false, link: null, docxHtml: '', pdfUrl: '' })
    void (async () => {
      try {
        const loaded = await loadVendorResumePreview(candidateEmail, candidateUserId)
        if (cancelled) return
        if (loaded.ok && loaded.mode === 'text') {
          setPlainText(loaded.text)
          setState({ loading: false, failed: false, link: loaded.link, docxHtml: '', pdfUrl: '' })
          return
        }
        if (!loaded.ok) {
          setState({ loading: false, failed: true, link: null, docxHtml: '', pdfUrl: '' })
          if (loaded.missing) onMissingRef.current?.()
          return
        }
        if (loaded.mode === 'pdf-url') {
          setState({ loading: false, failed: false, link: loaded.link, docxHtml: '', pdfUrl: loaded.viewUrl })
          return
        }
        if (loaded.mode === 'pdf-bytes') {
          // Wrap the original bytes. Do not rewrite them.
          objectUrl = URL.createObjectURL(new Blob([loaded.data], { type: 'application/pdf' }))
          if (cancelled) return
          setState({ loading: false, failed: false, link: loaded.link, docxHtml: '', pdfUrl: objectUrl })
          return
        }
        if (loaded.mode === 'docx-html') {
          setState({ loading: false, failed: false, link: loaded.link, docxHtml: loaded.html, pdfUrl: '' })
          return
        }
        setState({ loading: false, failed: false, link: loaded.link, docxHtml: '', pdfUrl: '' })
      } catch {
        if (!cancelled) setState({ loading: false, failed: true, link: null, docxHtml: '', pdfUrl: '' })
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [candidateEmail, candidateUserId, attempt])

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
  if (plainText && !failed) {
    return (
      <pre className={styles.docxPage} data-testid="resume-text-preview">
        {plainText}
      </pre>
    )
  }
  if (pdfUrl && !failed) {
    return (
      <iframe
        className={styles.pdfFrame}
        title={`Resume of ${candidateName}`}
        src={pdfFrameSrc(pdfUrl)}
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
