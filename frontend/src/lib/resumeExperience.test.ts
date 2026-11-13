import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => ({ getDocument: () => ({}), GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { computeExperience, dateRangesIn, monthsToLabel, pickStatedMonths } from './resumeExperience'
import { parseResumeText } from './resumeParser'

const NOW = new Date('2026-11-12T00:00:00Z')
const job = (jobTitle: string, startDate: string, endDate: string, extra = {}) => ({
  jobTitle,
  company: 'Acme',
  startDate,
  endDate,
  currentlyWorking: /present/i.test(endDate),
  ...extra,
})

describe('computeExperience', () => {
  it('no jobs and nothing stated is a fresher', () => {
    expect(computeExperience([], 'B.Tech 2022 - 2026. Projects: chat app.', '', NOW)).toMatchObject({
      isFresher: true,
      label: 'Fresher / 0 years',
    })
  })

  it('any real job makes the candidate not a fresher, even a few months', () => {
    const r = computeExperience([job('Software Engineer', 'Aug 2026', 'Present')], '', '', NOW)
    expect(r.isFresher).toBe(false)
    expect(r.label).toBe('0 – 1 Years')
  })

  it('internships alone do not count: still a fresher', () => {
    const r = computeExperience([job('Software Engineering Intern', 'Jan 2026', 'Jun 2026')], '', '', NOW)
    expect(r.isFresher).toBe(true)
  })

  it('an internship plus a real job counts only the job', () => {
    const r = computeExperience(
      [job('Developer Intern', 'Jan 2020', 'Dec 2020'), job('Developer', 'Jan 2023', 'Dec 2023')],
      '',
      '',
      NOW,
    )
    expect(r.months).toBe(12)
    expect(r.label).toBe('0 – 1 Years')
  })

  it('merges overlapping jobs instead of adding them twice', () => {
    const r = computeExperience(
      [job('Engineer', 'Jan 2022', 'Dec 2023'), job('Consultant', 'Jan 2023', 'Dec 2023')],
      '',
      '',
      NOW,
    )
    expect(r.months).toBe(24)
  })

  it('leaves career gaps out', () => {
    const r = computeExperience(
      [job('Engineer', 'Jan 2015', 'Dec 2016'), job('Engineer', 'Jan 2022', 'Dec 2023')],
      '',
      '',
      NOW,
    )
    expect(r.months).toBe(48)
    expect(r.label).toBe('3 – 5 Years')
  })

  it('a present job runs up to today', () => {
    const r = computeExperience([job('Engineer', 'Nov 2023', 'Present')], '', '', NOW)
    expect(r.months).toBe(37)
    expect(r.label).toBe('3 – 5 Years')
  })

  it('a stated total wins when it is larger than the jobs listed', () => {
    const r = computeExperience([job('Engineer', 'Jan 2024', 'Present')], '10+ years of experience in software', '', NOW)
    expect(r.label).toBe('8 – 12 Years')
  })

  it('a job with no readable dates still means not a fresher', () => {
    const r = computeExperience([{ jobTitle: 'Developer', company: 'Acme' }], '', '', NOW)
    expect(r.isFresher).toBe(false)
  })

  it('reads dates from the experience section when no job could be split out', () => {
    const r = computeExperience([], '', 'Worked on payments\nJan 2021 - Dec 2022\nBuilt APIs', NOW)
    expect(r.isFresher).toBe(false)
    expect(r.months).toBe(24)
  })

  it('an experience section that is only internships stays fresher', () => {
    const r = computeExperience([], '', 'Software Intern at Acme\nJan 2025 - Jun 2025', NOW)
    expect(r.isFresher).toBe(true)
  })

  it('never lets a future start date count', () => {
    const r = computeExperience([job('Engineer', 'Jan 2030', 'Present')], '', '', NOW)
    expect(r.months).toBe(0)
  })
})

describe('pickStatedMonths', () => {
  it('reads real statements of experience', () => {
    expect(pickStatedMonths('Engineer with 5+ years of experience')).toBe(60)
    expect(pickStatedMonths('3 years of professional experience')).toBe(36)
    expect(pickStatedMonths('Total experience: 2.5 years')).toBe(30)
    expect(pickStatedMonths('experience of 4 yrs in QA')).toBe(48)
    expect(pickStatedMonths('3-5 years of experience')).toBe(48)
  })

  it('ignores years that are not work experience', () => {
    expect(pickStatedMonths('4 year B.Tech in Computer Science')).toBeNull()
    expect(pickStatedMonths('Completed a 3 years diploma')).toBeNull()
    expect(pickStatedMonths('Python (2 years)')).toBeNull()
    expect(pickStatedMonths('6 months internship experience')).toBeNull()
  })
})

describe('dateRangesIn / labels', () => {
  it('reads month, numeric and year-only ranges', () => {
    expect(dateRangesIn('Jan 2021 - Mar 2021', NOW)).toHaveLength(1)
    expect(dateRangesIn('08/2020 – 11/2021', NOW)).toHaveLength(1)
    expect(dateRangesIn('2019 - Present', NOW)).toHaveLength(1)
  })

  it('buckets years into the wizard options', () => {
    expect(monthsToLabel(6)).toBe('0 – 1 Years')
    expect(monthsToLabel(18)).toBe('1 – 2 Years')
    expect(monthsToLabel(36)).toBe('2 – 3 Years')
    expect(monthsToLabel(60)).toBe('3 – 5 Years')
    expect(monthsToLabel(96)).toBe('5 – 8 Years')
    expect(monthsToLabel(144)).toBe('8 – 12 Years')
    expect(monthsToLabel(180)).toBe('12+ Years')
  })
})

describe('whole resumes', () => {
  const at = (iso: string, fn: () => void) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
    try {
      fn()
    } finally {
      vi.useRealTimers()
    }
  }

  it('a student with projects and a 4 year degree is a fresher', () => {
    const resume = `Asha Verma
B.Tech Computer Science 2022 - 2026, 4 year programme
SKILLS
Python, React, SQL
PROJECTS
Chat App | React | Node
• Built a realtime chat app.
EDUCATION
JNTU Hyderabad B.Tech 2022 - 2026`
    at('2026-11-12T00:00:00Z', () => {
      const p = parseResumeText(resume)
      expect(p.totalExperience).toBe('Fresher / 0 years')
      expect(p.workExperiences ?? []).toHaveLength(0)
    })
  })

  it('a student with only an internship is a fresher', () => {
    const resume = `Ravi Kumar
Final year student
EXPERIENCE
Software Development Intern, Zenith Labs
Jun 2025 - Aug 2025
• Built a dashboard in React
SKILLS
React, JavaScript
EDUCATION
B.Tech 2022 - 2026`
    at('2026-11-12T00:00:00Z', () => {
      expect(parseResumeText(resume).totalExperience).toBe('Fresher / 0 years')
    })
  })

  it('a candidate with two IT jobs gets the combined date-based experience', () => {
    const resume = `Neha Rao
Software Engineer
EXPERIENCE
Senior Software Engineer, Finlytics Pvt Ltd (2022 - Present)
- Built dashboards in React and TypeScript.
Software Engineer, CartBase Technologies (2019 - 2022)
- Developed REST APIs in Node.js.
SKILLS
React, Node.js`
    at('2026-11-12T00:00:00Z', () => {
      const p = parseResumeText(resume)
      expect(p.workExperiences?.length).toBeGreaterThanOrEqual(2)
      expect(p.totalExperience).toBe('5 – 8 Years')
    })
  })

  it('reads bullets that a PDF font exported as private-use glyphs', () => {
    const bullet = String.fromCharCode(0xf0b7)
    const resume = `Dev Patel
EXPERIENCE
Backend Developer, Orbit Systems (Mar 2024 - Present)
${bullet} Built payment APIs in Python
${bullet} Cut latency by 40%
SKILLS
Python`
    at('2026-11-12T00:00:00Z', () => {
      const p = parseResumeText(resume)
      expect(p.workExperiences?.[0]?.responsibilities).toContain('Built payment APIs')
      expect(p.totalExperience).toBe('2 – 3 Years')
    })
  })
})
