import { describe, expect, it } from 'vitest'
import { isDocxDocument, isSafeImageSrc, isSafeLinkUrl } from './docxPreview'

describe('docx preview rules', () => {
  it('recognises Word resumes by content type or name', () => {
    expect(isDocxDocument('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'cv')).toBe(true)
    expect(isDocxDocument('', 'Priya_Resume.DOCX')).toBe(true)
    expect(isDocxDocument('application/pdf', 'resume.pdf')).toBe(false)
  })

  it('only keeps web and email links', () => {
    expect(isSafeLinkUrl('https://linkedin.com/in/priya')).toBe(true)
    expect(isSafeLinkUrl('mailto:priya@example.com')).toBe(true)
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl(' JavaScript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('only keeps images embedded in the document', () => {
    expect(isSafeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isSafeImageSrc('https://tracker.example.com/pixel.gif')).toBe(false)
    expect(isSafeImageSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
  })
})
