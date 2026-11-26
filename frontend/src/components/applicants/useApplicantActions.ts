import { useCallback, useState } from 'react'
import { applicantsToCsv, type IndexedApplicant } from '../../lib/applicantSearch'
import { mapWithConcurrency } from '../../lib/concurrency'
import { mapApplicantStatusToApi } from '../../lib/employerCandidateUtils'
import type { EmployerApplicant } from '../../lib/store'
import {
  fetchVendorCandidateResumeDownload,
  patchApplicantStatus,
  sendInterviewLinks,
} from '../../lib/vendorApi'
import { buildZip } from '../../lib/zipStore'

export type Notice = { tone: 'success' | 'error' | 'info'; text: string; link?: string; undo?: () => void }

const ZIP_LIMIT = 25
type Status = EmployerApplicant['status']

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

const hasContact = (r: IndexedApplicant) => Boolean(r.applicant.candidateEmail)
/** The original uploaded file, including when the Candidates page hides the e-mail. */
const hasOriginalFile = (r: IndexedApplicant) =>
  Boolean(r.applicant.hasResumeFile && (r.applicant.candidateUserId || r.applicant.candidateEmail))

function resumeSaveName(person: string, filename: string, contentType: string): string {
  if (filename && /\.(pdf|docx)$/i.test(filename)) return filename
  const ext = contentType.toLowerCase().includes('pdf')
    ? '.pdf'
    : contentType.toLowerCase().includes('wordprocessingml')
      ? '.docx'
      : ''
  const base = (filename || person || 'resume').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'resume'
  return ext && !base.toLowerCase().endsWith(ext) ? `${base.replace(/\.(pdf|docx)$/i, '')}${ext}` : base
}

const PDF_TYPE = 'application/pdf'
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function headerStartsWith(data: ArrayBuffer, marker: string): boolean {
  if (data.byteLength < marker.length) return false
  const bytes = new Uint8Array(data, 0, marker.length)
  for (let i = 0; i < marker.length; i += 1) {
    if (bytes[i] !== marker.charCodeAt(i)) return false
  }
  return true
}

function withExtension(filename: string, ext: '.pdf' | '.docx'): string {
  const stem = filename.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${stem || 'resume'}${ext}`
}

/** Save the original bytes. Magic bytes override a text/plain or missing name so a PDF is never saved as .txt. */
function resumeDownloadFile(
  person: string,
  file: { data: ArrayBuffer; filename: string; contentType: string },
): { data: ArrayBuffer; filename: string; contentType: string } {
  let contentType = file.contentType || 'application/octet-stream'
  let filename = file.filename || ''
  if (headerStartsWith(file.data, '%PDF')) {
    contentType = PDF_TYPE
    if (!filename.toLowerCase().endsWith('.pdf')) filename = withExtension(filename || person, '.pdf')
  } else if (headerStartsWith(file.data, 'PK') && !filename.toLowerCase().endsWith('.pdf')) {
    contentType = DOCX_TYPE
    if (!filename.toLowerCase().endsWith('.docx')) filename = withExtension(filename || person, '.docx')
  } else {
    filename = resumeSaveName(person, filename, contentType)
  }
  return { data: file.data, filename, contentType }
}
export const canShortlist = (r: IndexedApplicant) =>
  r.applicant.recordSource === 'application' || (!r.applicant.recordSource && Boolean(r.applicant.jobId))

/** Recruiter actions on applicants, all through existing endpoints. */
export function useApplicantActions(onUpdateApplicant?: (id: string, patch: Partial<EmployerApplicant>) => void) {
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [bulkBusy, setBulkBusy] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)

  const mark = useCallback((ids: string[], action: string | null) => {
    setBusy((b) => {
      const next = { ...b }
      for (const id of ids) {
        if (action) next[id] = action
        else delete next[id]
      }
      return next
    })
  }, [])

  async function download(r: IndexedApplicant) {
    const a = r.applicant
    mark([a.id], 'download')
    try {
      const file = await fetchVendorCandidateResumeDownload(a.candidateEmail, { userId: a.candidateUserId })
      const saved = resumeDownloadFile(a.candidateName, file)
      saveBlob(new Blob([saved.data], { type: saved.contentType || 'application/octet-stream' }), saved.filename)
    } catch (err) {
      // The extracted text is not a resume file. Never save it as <name>.txt from Download.
      if (err instanceof Error && /no stored resume file/i.test(err.message)) {
        setNotice({ tone: 'error', text: 'No original resume file is stored for this person.' })
      } else {
        setNotice({ tone: 'error', text: `Couldn’t download ${a.candidateName}’s original resume. Please try again.` })
      }
    } finally {
      mark([a.id], null)
    }
  }

  async function setStatus(rows: IndexedApplicant[], status: Status) {
    const done: { id: string; prev: Status }[] = []
    mark(rows.map((r) => r.applicant.id), 'shortlist')
    for (const r of rows) {
      try {
        await patchApplicantStatus(r.applicant.id, mapApplicantStatusToApi(status))
        onUpdateApplicant?.(r.applicant.id, { status })
        done.push({ id: r.applicant.id, prev: r.applicant.status })
      } catch {
        /* reported by the caller */
      }
    }
    mark(rows.map((r) => r.applicant.id), null)
    return done
  }

  async function undo(done: { id: string; prev: Status }[]) {
    for (const d of done) {
      try {
        await patchApplicantStatus(d.id, mapApplicantStatusToApi(d.prev))
        onUpdateApplicant?.(d.id, { status: d.prev })
      } catch {
        /* stays shortlisted */
      }
    }
    setNotice({ tone: 'info', text: 'Shortlist undone.' })
  }

  /** Shortlists the rows; with `toggle` a single shortlisted row goes back to review. */
  async function shortlist(rows: IndexedApplicant[], opts: { toggle?: boolean } = {}) {
    if (rows.length > 1 && bulkBusy) return // a second click while the first bulk action runs
    const eligible = rows.filter(canShortlist)
    if (!eligible.length) {
      setNotice({ tone: 'info', text: 'Only people who applied to one of your jobs can be shortlisted.' })
      return
    }
    if (opts.toggle && eligible.length === 1 && eligible[0].applicant.status === 'Shortlisted') {
      const r = eligible[0]
      const done = await setStatus([r], r.applicant.interviewResult ? 'In Review' : 'New')
      setNotice(
        done.length
          ? { tone: 'info', text: `${r.applicant.candidateName} removed from the shortlist.` }
          : { tone: 'error', text: 'Couldn’t update the shortlist. Please try again.' },
      )
      return
    }
    const targets = eligible.filter((r) => r.applicant.status !== 'Shortlisted')
    if (!targets.length) {
      setNotice({ tone: 'info', text: 'Already shortlisted.' })
      return
    }
    if (rows.length > 1) setBulkBusy('shortlist')
    const done = await setStatus(targets, 'Shortlisted').finally(() => rows.length > 1 && setBulkBusy(''))
    const who = done.length === 1 ? targets[0].applicant.candidateName : `${done.length} applicants`
    setNotice(
      done.length === targets.length
        ? { tone: 'success', text: `${who} shortlisted.`, undo: () => void undo(done) }
        : { tone: 'error', text: `Shortlisted ${done.length} of ${targets.length}. Please try the rest again.` },
    )
  }

  async function invite(rows: IndexedApplicant[], opts: { confirm?: boolean } = {}) {
    if (bulkBusy === 'invite') return
    const targets = rows.filter(hasContact)
    if (!targets.length) {
      setNotice({ tone: 'info', text: 'No contact details for the selected applicants, so no invitation could be sent.' })
      return
    }
    const n = targets.length
    if (opts.confirm && !window.confirm(`Email an interview link to ${n} applicant${n === 1 ? '' : 's'}?`)) return
    const jobIds = new Set(targets.map((r) => r.applicant.jobId).filter(Boolean))
    const ids = targets.map((r) => r.applicant.id)
    mark(ids, 'invite')
    if (n > 1) setBulkBusy('invite')
    try {
      const out = await sendInterviewLinks({
        candidates: targets.map((r) => ({ email: r.applicant.candidateEmail, name: r.applicant.candidateName })),
        jobId: jobIds.size === 1 ? Array.from(jobIds)[0] : undefined,
      })
      const sent = out.invites.filter((i) => i.emailSent).length
      if (sent === out.invites.length) {
        const who = sent === 1 ? targets[0].applicant.candidateName : `${sent} applicants`
        setNotice({ tone: 'success', text: `Interview link emailed to ${who}.` })
      } else {
        const unsent = out.invites.filter((i) => !i.emailSent && i.inviteUrl)
        // Several applicants: every link is copied (one per line, with the email), not only the first one.
        const link =
          unsent.length > 1 ? unsent.map((i) => `${i.email}: ${i.inviteUrl}`).join('\n') : unsent[0]?.inviteUrl
        const links = unsent.length > 1 ? `${unsent.length} interview links` : 'Interview link'
        setNotice({
          tone: 'info',
          text: out.smtpConfigured
            ? `Email reached ${sent} of ${out.invites.length}. Copy the ${unsent.length === 1 ? 'link' : 'links'} and send ${unsent.length === 1 ? 'it' : 'them'} to the others yourself.`
            : `${links} created, but email is not set up on the server. Copy ${unsent.length > 1 ? 'them' : 'it'} and send ${unsent.length > 1 ? 'them' : 'it'} yourself.`,
          link,
        })
      }
    } catch {
      setNotice({ tone: 'error', text: 'Couldn’t send the interview invitation. Please try again.' })
    } finally {
      mark(ids, null)
      if (n > 1) setBulkBusy('')
    }
  }

  async function downloadZip(rows: IndexedApplicant[], now: number) {
    if (bulkBusy) return
    const targets = rows.filter((r) => hasOriginalFile(r) || hasContact(r)).slice(0, ZIP_LIMIT)
    if (!targets.length) {
      setNotice({ tone: 'info', text: 'No resumes available for the selected applicants.' })
      return
    }
    setBulkBusy('zip')
    const files: { name: string; data: Uint8Array }[] = []
    await mapWithConcurrency(targets, 3, async (r) => {
      const a = r.applicant
      const base = a.candidateName.replace(/\s+/g, '_')
      try {
        const file = await fetchVendorCandidateResumeDownload(a.candidateEmail, { userId: a.candidateUserId })
        const saved = resumeDownloadFile(base, file)
        files.push({ name: saved.filename, data: new Uint8Array(saved.data) })
      } catch {
        // No stored file: skip this person. Do not invent a .txt download.
      }
    })
    setBulkBusy('')
    if (!files.length) {
      setNotice({ tone: 'error', text: 'Couldn’t download the resumes. Please try again.' })
      return
    }
    saveBlob(buildZip(files), `applicants-resumes-${new Date(now).toISOString().slice(0, 10)}.zip`)
    const skipped = rows.length - files.length
    setNotice({
      tone: skipped ? 'info' : 'success',
      text: `${files.length} resume${files.length === 1 ? '' : 's'} downloaded${skipped ? `; ${skipped} skipped (no resume or over ${ZIP_LIMIT})` : ''}.`,
    })
  }

  function exportCsv(rows: IndexedApplicant[], now: number) {
    const csv = `﻿${applicantsToCsv(rows)}`
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `applicants-${new Date(now).toISOString().slice(0, 10)}.csv`)
  }

  return { busy, bulkBusy, notice, setNotice, download, shortlist, invite, downloadZip, exportCsv }
}
