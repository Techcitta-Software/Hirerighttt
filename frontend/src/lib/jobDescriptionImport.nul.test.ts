import { describe, expect, it, vi } from 'vitest'

const NUL = String.fromCharCode(0)
const extracted = vi.hoisted(() => ({ text: '' }))

vi.mock('./resumeParser', () => ({
  extractResumeText: vi.fn(async () => extracted.text),
}))

import { parseJobDescription, readJobDescriptionFile } from './jobDescriptionImport'

describe('readJobDescriptionFile strips NUL characters (NEW-06)', () => {
  it('removes every NUL from the extracted text before parsing', async () => {
    const clean = 'Senior Accountant\nLocation: Pune\nWe need 3-5 years of experience with GST filings and audits.'
    extracted.text = `${NUL}${clean.split('').join(NUL)}${NUL}  `
    const file = { name: 'jd.pdf', type: 'application/pdf', size: 1024 } as File
    const parsed = await readJobDescriptionFile(file)
    expect(JSON.stringify(parsed)).not.toContain(NUL)
    expect(parsed).toEqual(parseJobDescription(clean))
  })

  it('still rejects text that is too short once NULs are removed', async () => {
    extracted.text = `${NUL.repeat(100)}short`
    const file = { name: 'jd.docx', type: '', size: 10 } as File
    await expect(readJobDescriptionFile(file)).rejects.toThrow(/Could not read enough text/)
  })
})
