import { describe, expect, it } from 'vitest'
import { canCloudStoreResume } from './ResumeUpload'

describe('canCloudStoreResume', () => {
  it('includes txt along with pdf and docx', () => {
    expect(canCloudStoreResume('resume.PDF')).toBe(true)
    expect(canCloudStoreResume('resume.docx')).toBe(true)
    expect(canCloudStoreResume('resume.txt')).toBe(true)
    expect(canCloudStoreResume('resume.doc')).toBe(false)
    expect(canCloudStoreResume('resume.rtf')).toBe(false)
  })
})
