import { useRef, useState, useEffect, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  parseResumeFile,
  resumeExtractToProfilePatch,
  type ResumeExtract,
} from '../lib/resumeParser'
import {
  getPendingResume,
  clearPendingResume,
  shouldAttachPendingResumeOnboarding,
} from '../lib/pendingResume'
import { uploadResumeViaApiWithStatus, type ResumeUploadResult } from '../lib/resumeUploadApi'
import { syncProfileToApi } from '../lib/apiSession'
import { getProfile, saveProfile } from '../lib/store'
import { initialFormData } from '../data/wizard'
import { easeOut } from '../motion/variants'
import styles from './ResumeUpload.module.css'

interface ResumeUploadProps {
  file: File | null
  existingFileName?: string | null
  onFileChange: (file: File | null) => void
  onParsed?: (extract: ResumeExtract) => void
  onStored?: (info: {
    resumeUrl: string
    resumeStoragePath: string
    resumeFileId?: string | null
    storageProvider?: 's3' | 'supabase' | null
  }) => void
}

const ACCEPTED = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/rtf',
]
const MAX_BYTES = 5 * 1024 * 1024

function isAccepted(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  return (
    ACCEPTED.includes(file.type) ||
    file.type.startsWith('text/') ||
    ext === 'pdf' ||
    ext === 'doc' ||
    ext === 'docx' ||
    ext === 'txt' ||
    ext === 'text' ||
    ext === 'md' ||
    ext === 'rtf'
  )
}

export function ResumeUpload({
  file,
  existingFileName,
  onFileChange,
  onParsed,
  onStored,
}: ResumeUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [parsing, setParsing] = useState(false)
  const [showWhy, setShowWhy] = useState(false)

  // Only attach a homepage-selected resume when the user explicitly picked a file before auth.
  useEffect(() => {
    let active = true
    async function loadPending() {
      if (file) return
      if (!shouldAttachPendingResumeOnboarding()) {
        await clearPendingResume()
        return
      }
      try {
        const pending = await getPendingResume()
        if (pending && active) {
          void validateAndSet(pending, { fromPending: true })
        } else if (active) {
          await clearPendingResume()
        }
      } catch (err) {
        console.warn('Could not auto-load pending resume in onboarding', err)
        await clearPendingResume()
      }
    }
    void loadPending()
    return () => {
      active = false
    }
  }, [file])

  async function validateAndSet(
    next: File | null,
    opts?: { fromPending?: boolean },
  ) {
    setError('')
    setStatus('')
    if (!next) {
      onFileChange(null)
      return
    }
    if (!isAccepted(next)) {
      setError('Please upload a PDF, DOC, or DOCX file.')
      return
    }
    if (next.size > MAX_BYTES) {
      setError('File must be 5MB or smaller.')
      return
    }

    onFileChange(next)
    setParsing(true)
    setStatus('Reading your resume…')
    try {
      const ext = next.name.split('.').pop()?.toLowerCase()
      const canCloudStore = ext === 'pdf' || ext === 'docx'
      const uploadPromise = canCloudStore
        ? uploadResumeViaApiWithStatus(next, { background: true })
        : Promise.resolve({ ok: false as const, error: '' })

      setStatus('Extracting profile fields…')
      const [extract, upload] = await Promise.all([parseResumeFile(next, { background: true }), uploadPromise])
      onParsed?.(extract)

      let stored: ResumeUploadResult | null = null
      let storageWarning = ''
      if (canCloudStore) {
        if (upload.ok) {
          stored = upload.result
          onStored?.(upload.result)
        } else if (upload.error) {
          storageWarning = upload.error
          console.warn('[ResumeUpload] S3/API storage:', upload.error)
        }
      } else if (ext === 'doc') {
        storageWarning =
          'Only PDF and DOCX are saved to secure cloud storage. Convert .doc to .docx or PDF to store the file in S3.'
      }

      const saved = getProfile()
      const completed = saved?.completedSteps ?? 0
      const extractPatch = resumeExtractToProfilePatch(extract)
      const formData = {
        ...initialFormData,
        ...(saved || {}),
        ...extractPatch,
        resumeFile: next,
        resumeName: next.name,
        resumeText: extract.resumeText || saved?.resumeText || '',
        resumeUrl: stored?.resumeUrl ?? saved?.resumeUrl ?? null,
        resumeStoragePath: stored?.resumeStoragePath ?? saved?.resumeStoragePath ?? null,
        resumeFileId: stored?.resumeFileId ?? saved?.resumeFileId ?? null,
        storageProvider: stored?.storageProvider ?? saved?.storageProvider ?? null,
      }
      const persisted = saveProfile(formData, completed)
      void syncProfileToApi(persisted)

      if (opts?.fromPending) {
        await clearPendingResume()
      }

      if (storageWarning) {
        console.warn('[ResumeUpload] secure storage skipped:', storageWarning)
      }
      setStatus('')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not extract resume data.'
      setError(message)
      setStatus('')
    } finally {
      setParsing(false)
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files?.[0] ?? null
    void validateAndSet(dropped)
  }

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <h2>Upload your resume</h2>
        <button
          type="button"
          className={styles.whyLink}
          onClick={() => setShowWhy((prev) => !prev)}
          aria-expanded={showWhy}
        >
          Why upload?
          <span className={styles.infoIcon} aria-hidden="true">
            i
          </span>
        </button>
      </div>

      <AnimatePresence>
        {showWhy && (
          <motion.div
            className={styles.whyPanel}
            role="note"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: easeOut }}
          >
            Uploading your resume allows our AI engine to parse your work history, skills,
            and accomplishments automatically. This saves you from typing everything manually
            and increases your match accuracy with top employers by up to 85%.
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.resumeUploadWrapper}>
        {/* Drop Content */}
        <div className={styles.resumeDropContent}>
          <h3 className={styles.dropPromptTitle}>Upload your latest resume to get started</h3>
          <p className={styles.dropPromptDesc}>We&apos;ll use it to understand your background and make the process easier.</p>

          {!file && !existingFileName ? (
            <div
              className={`${styles.dropzone} ${dragging ? styles.dragging : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <svg className={styles.dropzoneUploadIcon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div className={styles.dropzoneText}>Drag &amp; drop your resume here</div>
              <div className={styles.dropzoneOr}>or</div>
              <button type="button" className={styles.browseBtn} onClick={(event) => { event.stopPropagation(); inputRef.current?.click() }}>Browse files</button>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.text,.md,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                className={styles.hiddenInput}
                // The input lives inside the clickable dropzone: without this its own click bubbles up and
                // re-triggers inputRef.click(), which can swallow the file dialog.
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  void validateAndSet(event.target.files?.[0] ?? null)
                  // allow re-selecting the same file after removing it
                  event.target.value = ''
                }}
              />
              <div className={styles.dropzoneHint}>PDF, DOC or DOCX, up to 5 MB</div>
            </div>
          ) : (
            <div className={styles.fileUploadedPreview}>
              <div className={styles.fileInfo}>
                <span className={styles.fileIcon}>
                  <svg width="20" height="20" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <div className={styles.fileMeta}>
                  <span className={styles.fileName}>{file ? file.name : existingFileName}</span>
                  <span className={styles.fileSize}>
                    {file ? `${(file.size / 1024).toFixed(1)} KB · ` : ''}
                    {parsing ? 'Extracting…' : 'Uploaded'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => {
                  void validateAndSet(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
              >
                Remove
              </button>
            </div>
          )}

          {status && !error && (
            <p className={styles.status} role="status">{status}</p>
          )}

          {error && (
            <p className={styles.error} role="alert">{error}</p>
          )}

          <div className={styles.securityNote}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Your resume is secure and only visible to you.</span>
          </div>
        </div>
      </div>
    </section>
  )
}
