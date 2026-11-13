import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => ({ getDocument: () => ({}), GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { parseResumeText } from './resumeParser'
import { FIXTURES } from './resumeFixtures'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, '')

function withToday<T>(fn: () => T): T {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T00:00:00Z'))
  try {
    return fn()
  } finally {
    vi.useRealTimers()
  }
}

describe('resume corpus', () => {
  for (const fx of FIXTURES) {
    describe(fx.name, () => {
      const p = withToday(() => parseResumeText(fx.text))
      const blob = JSON.stringify(p)

      it('name', () => expect(p.fullName).toBe(fx.expect.fullName))

      if (fx.expect.currentRole !== undefined) {
        it('current role is the latest job title as written', () => expect(p.currentRole).toBe(fx.expect.currentRole))
      }

      it('jobs: exactly the ones on the page', () => {
        const got = (p.workExperiences ?? []).map((w) => ({ company: w.company, title: w.jobTitle }))
        expect(got).toEqual(fx.expect.jobs)
      })

      it('experience', () => expect(p.totalExperience).toBe(fx.expect.experience))

      if (fx.expect.location) it('location', () => expect(p.currentLocation).toBe(fx.expect.location))

      it('skills listed on the resume are all found', () => {
        const got = new Set((p.skills ?? []).map(norm))
        const missing = fx.expect.skills.filter((s) => !got.has(norm(s)))
        expect(missing).toEqual([])
      })

      if (fx.expect.certs) {
        it('certifications', () => {
          const got = (p.certifications ?? []).map((c) => c.name)
          expect(got).toEqual(fx.expect.certs)
        })
      }

      it('nothing invented: every skill appears in the resume text', () => {
        const hay = norm(fx.text)
        const invented = (p.skills ?? []).filter((s) => !hay.includes(norm(s)))
        expect(invented).toEqual([])
      })

      for (const bad of fx.expect.absent ?? []) {
        it(`does not contain "${bad}"`, () => expect(blob.toLowerCase()).not.toContain(bad.toLowerCase()))
      }
    })
  }
})
