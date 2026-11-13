import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => ({ getDocument: () => ({}), GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { formatAiExtract, mergeAiWithRegex, parseResumeText, pdfItemsToLines } from './resumeParser'
import { FIXTURES } from './resumeFixtures'

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, '')

function today<T>(fn: () => T): T {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T00:00:00Z'))
  try {
    return fn()
  } finally {
    vi.useRealTimers()
  }
}

describe('everything extracted comes from the resume', () => {
  for (const fx of FIXTURES) {
    it(fx.name, () => {
      const p = today(() => parseResumeText(fx.text))
      const hay = squash(fx.text)
      const ungrounded: string[] = []
      for (const w of p.workExperiences ?? []) {
        for (const [label, value] of [['company', w.company], ['title', w.jobTitle]] as const) {
          if (value && !hay.includes(squash(value))) ungrounded.push(`${label}: ${value}`)
        }
        for (const line of (w.responsibilities || '').split('\n')) {
          const clean = line.replace(/^[•\-*]\s*/, '').replace(/…$/, '')
          if (clean && !hay.includes(squash(clean))) ungrounded.push(`responsibility: ${clean}`)
        }
      }
      for (const c of p.certifications ?? []) if (!hay.includes(squash(c.name))) ungrounded.push(`cert: ${c.name}`)
      for (const part of (p.fullName ?? '').split(/\s+/)) if (part && !hay.includes(squash(part))) ungrounded.push(`name: ${part}`)
      if (p.currentRole && !hay.includes(squash(p.currentRole))) ungrounded.push(`role: ${p.currentRole}`)
      // a narrative is built only from the resume's own Summary / Objective text, never from contact lines
      for (const field of [p.whoAreYou, p.whatDrivesYou, p.experienceSummary]) {
        expect(field ?? '').not.toMatch(/@|\+\d|linkedin|github\.com/i)
      }
      expect(ungrounded).toEqual([])
    })
  }
})

describe('nothing is made up', () => {
  it('garbage text yields no profile fields', () => {
    const p = parseResumeText('%%% ### lorem ipsum 12345 ???')
    expect(p.fullName).toBeUndefined()
    expect(p.currentRole).toBeUndefined()
    expect(p.workExperiences ?? []).toHaveLength(0)
    expect(p.skills ?? []).toHaveLength(0)
    expect(p.whatDrivesYou ?? '').toBe('')
  })

  it('a resume without an objective does not get an invented "what drives you"', () => {
    const p = parseResumeText(FIXTURES[1].text)
    expect(p.whatDrivesYou ?? '').toBe('')
  })

  it('a job with no title on the page is not given one', () => {
    const p = today(() => parseResumeText(`Sam Lee\nEXPERIENCE\nAcme Corporation (2020 - 2023)\n• Did accounts work\nSKILLS\nExcel`))
    for (const w of p.workExperiences ?? []) expect(w.jobTitle).not.toMatch(/^(?:engineer|software engineer)$/i)
  })

  it('keeps the casing the person wrote and fixes only all-caps / all-lower names', () => {
    expect(parseResumeText('Sean McDonald\nAnalyst\nsean@example.com').fullName).toBe('Sean McDonald')
    expect(parseResumeText('PRIYA D\'SOUZA\nNurse\np@example.com').fullName).toBe("Priya D'Souza")
    expect(parseResumeText('venkata satya narayana rao\nDeveloper\nv@example.com').fullName).toBe('Venkata Satya Narayana Rao')
  })
})

describe('two-column PDF layout', () => {
  const item = (str: string, x: number, y: number) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5 })
  // sidebar (left) holds contact + skills, the main column (right) holds experience
  const left = ['Aarav Mehta', 'aarav.mehta@example.com', '+91 98765 43210', 'Surat, Gujarat', 'SKILLS', 'Python', 'Django', 'PostgreSQL', 'Docker', 'Git']
  const right = [
    'EXPERIENCE',
    'Backend Developer, Crest Infosystems Ltd',
    'Mar 2021 - Present',
    '• Built Django REST APIs used by 50 clinics.',
    'Software Engineer, Pixel Works Pvt Ltd',
    'Jul 2018 - Feb 2021',
    '• Maintained the billing module in Python.',
  ]

  it('reads the columns one after the other and finds the right jobs', () => {
    const items = [
      ...left.map((t, i) => item(t, 30, 800 - i * 20)),
      ...right.map((t, i) => item(t, 300, 800 - i * 20)),
    ]
    const lines = pdfItemsToLines(items)
    const p = today(() => parseResumeText(lines.join('\n')))
    expect((p.workExperiences ?? []).map((w) => `${w.jobTitle} @ ${w.company}`)).toEqual([
      'Backend Developer @ Crest Infosystems Ltd',
      'Software Engineer @ Pixel Works Pvt Ltd',
    ])
    expect(p.totalExperience).toBe('8 – 12 Years')
    expect(p.skills).toEqual(expect.arrayContaining(['Python', 'Django', 'PostgreSQL', 'Docker', 'Git']))
  })
})

describe('AI output is checked against the resume', () => {
  const resume = FIXTURES[1].text // Rahul Sharma, Razorpay + Infosys

  it('drops a company the model invented and recomputes experience from real jobs', () => {
    const ai = formatAiExtract(
      {
        fullName: 'Rahul Sharma',
        totalExperience: '2 – 3 Years',
        workExperiences: [
          { company: 'Acme', jobTitle: 'Engineer', startDate: '2020', endDate: '2022' },
          { company: 'Razorpay Software Pvt Ltd', jobTitle: 'Senior Java Developer', startDate: 'Jun 2021', endDate: 'Present', currentlyWorking: true },
        ],
      },
      resume,
    )
    expect((ai.workExperiences ?? []).map((w) => w.company)).toEqual(['Razorpay Software Pvt Ltd'])
    expect(ai.workExperiences?.[0].jobTitle).toBe('Senior Java Developer')
  })

  it('never invents a job title or an end date', () => {
    const ai = formatAiExtract(
      { workExperiences: [{ company: 'Razorpay Software Pvt Ltd', startDate: 'Jun 2021' }] },
      resume,
    )
    expect(ai.workExperiences?.[0].jobTitle).toBe('')
    expect(ai.workExperiences?.[0].endDate).toBe('')
  })

  it('the model cannot overrule the experience the jobs on the page show', () => {
    const regex = today(() => parseResumeText(resume))
    const ai = formatAiExtract({ fullName: 'Rahul Sharma', totalExperience: 'Fresher / 0 years', skills: ['Java'] }, resume)
    const merged = today(() => mergeAiWithRegex(resume, ai, regex))
    expect(merged.totalExperience).toBe('8 – 12 Years')
  })

  it('model-only skills that are not on the resume are not shown as read from it', () => {
    const regex = today(() => parseResumeText(resume))
    const merged = today(() => mergeAiWithRegex(resume, formatAiExtract({ fullName: 'Rahul Sharma', skills: ['Java', 'Rust'] }, resume), regex))
    expect(merged.skills).toContain('Java')
    expect(merged.skills).not.toContain('Rust')
  })

  it('a model-guessed city or re-worded title that is not on the resume is ignored', () => {
    const ai = formatAiExtract({ fullName: 'Rahul Sharma', currentRole: 'Staff Platform Architect', currentLocation: 'Pune' }, resume)
    expect(ai.currentRole).toBeUndefined()
    expect(ai.currentLocation).toBeUndefined()
  })
})
