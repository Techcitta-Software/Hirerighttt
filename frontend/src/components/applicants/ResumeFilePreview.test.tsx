import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VendorCandidateDocumentLink } from '../../lib/vendorApi'

vi.mock('../../lib/docxPreview', () => ({
  isDocxDocument: (contentType: string | undefined, filename: string | undefined) => {
    const type = (contentType || '').toLowerCase()
    return type.includes('officedocument.wordprocessingml') || (filename || '').toLowerCase().endsWith('.docx')
  },
  docxToSafeHtml: vi.fn(async () => '<p>from-bytes</p>'),
}))

vi.mock('../../lib/vendorApi', () => ({
  fetchVendorCandidateResumeDocument: vi.fn(),
  fetchVendorCandidateResumeDownload: vi.fn(),
}))

import { docxToSafeHtml } from '../../lib/docxPreview'
import { fetchVendorCandidateResumeDocument, fetchVendorCandidateResumeDownload } from '../../lib/vendorApi'
import { ResumeFilePreview, loadVendorResumePreview, pdfFrameSrc } from './ResumeFilePreview'

const documentFetch = vi.mocked(fetchVendorCandidateResumeDocument)
const downloadFetch = vi.mocked(fetchVendorCandidateResumeDownload)
const docxHtml = vi.mocked(docxToSafeHtml)

const S3 = 'https://resumes.example/candidate.pdf?X-Amz-Signature=abc'

function link(over: Partial<VendorCandidateDocumentLink> = {}): VendorCandidateDocumentLink {
  return {
    viewUrl: S3,
    downloadUrl: S3,
    expiresInSeconds: 60,
    contentType: 'application/pdf',
    filename: 'Ada_Resume.pdf',
    ...over,
  }
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

beforeEach(() => {
  documentFetch.mockReset()
  downloadFetch.mockReset()
  docxHtml.mockReset()
  docxHtml.mockResolvedValue('<p>from-bytes</p>')
})

describe('pdf frame src', () => {
  it('keeps the browser PDF chrome on the original URL', () => {
    expect(pdfFrameSrc(S3)).toBe(`${S3}#toolbar=1&navpanes=0&view=FitH`)
    expect(pdfFrameSrc(`${S3}#page=2`)).toBe(`${S3}#page=2`)
  })
})

describe('loadVendorResumePreview', () => {
  it('shows a PDF from the presigned S3 URL and does not proxy the bytes', async () => {
    documentFetch.mockResolvedValue(link())
    const loaded = await loadVendorResumePreview('ada@example.com', 'user-ada')
    expect(documentFetch).toHaveBeenCalledWith('ada@example.com', { userId: 'user-ada' })
    expect(downloadFetch).not.toHaveBeenCalled()
    expect(loaded).toEqual({ ok: true, link: link(), mode: 'pdf-url', viewUrl: S3 })
  })

  it('treats a .pdf filename as a PDF even when the content type is generic', async () => {
    documentFetch.mockResolvedValue(link({ contentType: 'application/octet-stream' }))
    const loaded = await loadVendorResumePreview('ada@example.com', 'user-ada')
    expect(loaded).toMatchObject({ ok: true, mode: 'pdf-url', viewUrl: S3 })
    expect(downloadFetch).not.toHaveBeenCalled()
  })

  it('falls back to a blob only when the S3 URL is empty and the bytes start with %PDF', async () => {
    const data = bytes('%PDF-1.7\n')
    documentFetch.mockResolvedValue(link({ viewUrl: '  ', downloadUrl: '' }))
    downloadFetch.mockResolvedValue({ data, filename: 'Ada_Resume.pdf', contentType: 'application/pdf' })
    const loaded = await loadVendorResumePreview('ada@example.com', 'user-ada')
    expect(downloadFetch).toHaveBeenCalledWith('ada@example.com', { userId: 'user-ada' })
    expect(loaded).toMatchObject({ ok: true, mode: 'pdf-bytes' })
    if (loaded.ok && loaded.mode === 'pdf-bytes') expect(loaded.data).toBe(data)
  })

  it('does not invent a PDF blob when the bytes are not a PDF', async () => {
    documentFetch.mockResolvedValue(link({ viewUrl: '', downloadUrl: '' }))
    downloadFetch.mockResolvedValue({ data: bytes('SKILLS\nGo'), filename: 'Ada_Resume.pdf', contentType: 'application/pdf' })
    const loaded = await loadVendorResumePreview('ada@example.com', null)
    expect(loaded).toMatchObject({ ok: true, mode: 'file' })
    expect(docxHtml).not.toHaveBeenCalled()
  })

  it('does not rewrite a Word file when the original S3 object can be opened', async () => {
    const word = link({
      viewUrl: 'https://resumes.example/candidate.docx?X-Amz-Signature=abc',
      downloadUrl: 'https://resumes.example/candidate.docx?X-Amz-Signature=abc',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'Ada_Resume.docx',
    })
    documentFetch.mockResolvedValue(word)
    const loaded = await loadVendorResumePreview('ada@example.com', 'user-ada')
    expect(loaded).toEqual({ ok: true, link: word, mode: 'file' })
    expect(downloadFetch).not.toHaveBeenCalled()
    expect(docxHtml).not.toHaveBeenCalled()
  })

  it('builds a Word preview from the original bytes only when S3 gave no URL', async () => {
    const data = bytes('PK\u0003\u0004')
    documentFetch.mockResolvedValue(
      link({
        viewUrl: '',
        downloadUrl: '',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'Ada_Resume.docx',
      }),
    )
    downloadFetch.mockResolvedValue({
      data,
      filename: 'Ada_Resume.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const loaded = await loadVendorResumePreview('ada@example.com', 'user-ada')
    expect(docxHtml).toHaveBeenCalledWith(data)
    expect(loaded).toMatchObject({ ok: true, mode: 'docx-html', html: '<p>from-bytes</p>' })
  })

  it('reports a missing file without turning extracted text into the resume', async () => {
    documentFetch.mockRejectedValue(new Error('No stored resume file for this account.'))
    await expect(loadVendorResumePreview('ada@example.com', 'user-ada')).resolves.toEqual({ ok: false, missing: true })
    expect(downloadFetch).not.toHaveBeenCalled()
  })

  it('shows a text/plain or .txt file as text and does not open it as a PDF', async () => {
    const data = bytes('Priya Nair\nStaff Nurse\n')
    documentFetch.mockResolvedValue(
      link({
        viewUrl: 'https://resumes.example/candidate.txt?X-Amz-Signature=abc',
        downloadUrl: 'https://resumes.example/candidate.txt?X-Amz-Signature=abc',
        contentType: 'text/plain; charset=utf-8',
        filename: 'Priya.txt',
      }),
    )
    downloadFetch.mockResolvedValue({ data, filename: 'Priya.txt', contentType: 'text/plain; charset=utf-8' })
    const loaded = await loadVendorResumePreview('ada@example.com', 'user-ada')
    expect(loaded).toMatchObject({ ok: true, mode: 'text', text: 'Priya Nair\nStaff Nurse\n' })
    expect(loaded).not.toMatchObject({ mode: 'pdf-url' })
    expect(loaded).not.toMatchObject({ mode: 'pdf-bytes' })
  })

  it('treats a .txt name as text even when the content type looks like a PDF', async () => {
    documentFetch.mockResolvedValue(
      link({ viewUrl: '', downloadUrl: '', contentType: 'application/pdf', filename: 'notes.txt' }),
    )
    downloadFetch.mockResolvedValue({ data: bytes('hello resume'), filename: 'notes.txt', contentType: 'application/pdf' })
    const loaded = await loadVendorResumePreview('ada@example.com', null)
    expect(loaded).toMatchObject({ ok: true, mode: 'text', text: 'hello resume' })
  })

  it('reports a load failure separately from a missing file', async () => {
    documentFetch.mockRejectedValue(new Error('Resume file could not be loaded. Please try again.'))
    await expect(loadVendorResumePreview('ada@example.com', 'user-ada')).resolves.toEqual({ ok: false, missing: false })
  })
})

describe('ResumeFilePreview', () => {
  it('does not render extracted resume text while the original file is loading', () => {
    const html = renderToStaticMarkup(
      createElement(ResumeFilePreview, {
        candidateEmail: 'ada@example.com',
        candidateUserId: 'user-ada',
        candidateName: 'Ada',
        onDownload: () => {},
      }),
    )
    expect(html).toContain('Loading the resume')
    expect(html).not.toContain('resume-text-fallback')
    expect(html).not.toContain('Full resume text')
    expect(html).not.toContain('SKILLS')
    expect(documentFetch).not.toHaveBeenCalled()
  })
})
