import { describe, expect, it, vi } from 'vitest'

// The PDF library needs browser APIs; the text parser under test does not.
vi.mock('pdfjs-dist', () => ({ getDocument: () => ({}), GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { parseResumeText } from './resumeParser'

const RESUME = `Priya Nair
Senior Full Stack Engineer | Bengaluru | priya.nair@example.com | +91 98450 11223

SUMMARY
Full stack engineer with 5 years building SaaS products on React, Node.js, TypeScript and PostgreSQL.

EXPERIENCE
Senior Software Engineer, Finlytics Pvt Ltd (2022 - Present)
- Built a real-time reconciliation dashboard in React and TypeScript used by 400+ finance teams.
- Reduced API p95 latency from 820ms to 240ms by adding Redis caching and fixing N+1 queries in PostgreSQL.
Software Engineer, CartBase Technologies (2019 - 2022)
- Developed REST APIs in Node.js and Express serving 1.2M monthly users.
- Implemented CI/CD with GitHub Actions, cutting release time by 60%.

SKILLS
React, TypeScript, Node.js, PostgreSQL, Redis, Docker, Kafka, AWS, Python, REST APIs
`

describe('parseResumeText', () => {
  const parsed = parseResumeText(RESUME)

  it('does not split camelCase product names', () => {
    const blob = JSON.stringify(parsed)
    expect(blob).not.toMatch(/Type Script|Postgre SQL|Git Hub|Saa S|Cart Base/)
  })

  it('keeps headline skills', () => {
    const skills = (parsed.skills ?? []) as string[]
    expect(skills).toEqual(expect.arrayContaining(['React', 'TypeScript', 'PostgreSQL', 'Node.js']))
  })

  it('cleans company names', () => {
    const companies = (parsed.workExperiences ?? []).map((w) => w.company)
    expect(companies.join('|')).not.toContain('()')
    expect(companies.some((c) => c.includes('Finlytics'))).toBe(true)
  })
})
