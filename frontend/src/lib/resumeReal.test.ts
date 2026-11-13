/**
 * Runs the parser over the real resumes in /resume_test (git-ignored: they contain personal data) and compares the
 * result with hand-checked ground truth in /resume_test/ground_truth.json. Skipped when that folder is absent.
 */
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('pdfjs-dist', () => ({ getDocument: () => ({}), GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import mammoth from 'mammoth'
import { parseResumeText, pdfItemsToLines } from './resumeParser'

const DIR = path.resolve(__dirname, '../../../resume_test')
const TRUTH_FILE = path.join(DIR, 'ground_truth.json')
const available = fs.existsSync(TRUTH_FILE)

type Truth = {
  name: string
  role: string | null
  location?: string
  jobs: [string, string, string, string][]
  experience: string
  certs: [string, string][]
  skills: string[]
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, '')

async function readText(file: string): Promise<string> {
  const full = path.join(DIR, file)
  if (file.toLowerCase().endsWith('.pdf')) {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(full)), useSystemFonts: true }).promise
    const chunks: string[] = []
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent()
      const lines = pdfItemsToLines(content.items)
      if (lines.length) chunks.push(lines.join('\n'))
    }
    return chunks.join('\n')
  }
  return (await mammoth.extractRawText({ buffer: fs.readFileSync(full) })).value
}

describe.skipIf(!available)('real resumes (resume_test)', () => {
  const truth: Record<string, Truth> = available ? JSON.parse(fs.readFileSync(TRUTH_FILE, 'utf-8')) : {}

  for (const [file, want] of Object.entries(truth)) {
    describe(file, () => {
      let text = ''
      let p: ReturnType<typeof parseResumeText>
      it('reads', async () => {
        text = await readText(file)
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-11-13T00:00:00Z'))
        try {
          p = parseResumeText(text)
        } finally {
          vi.useRealTimers()
        }
        expect(text.length).toBeGreaterThan(500)
      })

      it('name', () => expect(p.fullName).toBe(want.name))
      it('current role', () => expect(p.currentRole ?? null).toBe(want.role))
      if (want.location) it('location', () => expect(p.currentLocation).toBe(want.location))
      else it('no invented location', () => expect(p.currentLocation).toBeUndefined())

      it('jobs: exactly the ones written, with dates', () => {
        const got = (p.workExperiences ?? []).map((w) => [w.company, w.jobTitle, w.startDate, w.endDate])
        expect(got).toEqual(want.jobs)
      })

      it('experience', () => expect(p.totalExperience).toBe(want.experience))

      it('certifications', () => {
        const got = (p.certifications ?? []).map((c) => [c.name, c.organization])
        expect(got).toEqual(want.certs)
      })

      it('every listed skill is found', () => {
        const got = new Set((p.skills ?? []).map(squash))
        expect(want.skills.filter((s) => !got.has(squash(s)))).toEqual([])
      })

      it('nothing invented: skills, jobs, titles and certs are all on the resume', () => {
        const hay = squash(text)
        const bad: string[] = []
        for (const s of p.skills ?? []) if (!hay.includes(squash(s))) bad.push(`skill ${s}`)
        for (const w of p.workExperiences ?? []) {
          if (!hay.includes(squash(w.company))) bad.push(`company ${w.company}`)
          if (w.jobTitle && !hay.includes(squash(w.jobTitle))) bad.push(`title ${w.jobTitle}`)
        }
        for (const c of p.certifications ?? []) if (!hay.includes(squash(c.name))) bad.push(`cert ${c.name}`)
        expect(bad).toEqual([])
      })

      it('no skill is listed twice', () => {
        const keys = (p.skills ?? []).map(squash)
        expect(keys.length).toBe(new Set(keys).size)
      })
    })
  }
})
