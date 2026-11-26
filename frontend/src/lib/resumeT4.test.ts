/** T4 regression: five very different resumes (fresher, data scientist, sales, nurse, two-column designer). */
import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => ({ getDocument: () => ({}), GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { formatAiExtract, mergeAiWithRegex, parseResumeText, resumeExtractToProfilePatch } from './resumeParser'
import { yearsWithinBand } from './resumeExperience'
import { DATA_SCIENTIST_PDF, DESIGNER_TWO_COLUMN_PDF, FRESHER_DOCX, NURSE_PDF, SALES_TXT } from './resumeT4Fixtures'

const NOW = new Date('2026-11-26T00:00:00Z')
function parse(text: string) {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  try {
    return parseResumeText(text)
  } finally {
    vi.useRealTimers()
  }
}
const jobs = (text: string) => (parse(text).workExperiences ?? []).map((w) => [w.jobTitle, w.company])

describe('T4 resumes through the regex parser', () => {
  it('fresher: both internships, latest internship as role, education', () => {
    const p = parse(FRESHER_DOCX)
    expect(p.fullName).toBe('Aditya Verma')
    expect(jobs(FRESHER_DOCX)).toEqual([
      ['Software Engineering Intern', 'Zoho Corporation'],
      ['Web Development Intern', 'Infosys Springboard (Virtual)'],
    ])
    expect(p.workExperiences?.[0].location).toBe('Chennai')
    expect(p.currentRole).toBe('Software Engineering Intern')
    expect(p.totalExperience).toBe('Fresher / 0 years')
    expect(p.education?.[0]).toEqual({
      degree: 'B.Tech, Computer Science and Engineering',
      institution: 'Jawaharlal Nehru Technological University',
      startYear: '2022',
      endYear: '2026',
    })
  })

  it('data scientist: three jobs, education, 8+ years from dates', () => {
    const p = parse(DATA_SCIENTIST_PDF)
    expect(p.fullName).toBe('Vikram Narayanan')
    expect(jobs(DATA_SCIENTIST_PDF).map((j) => j[1])).toEqual(['Flipkart', 'Mu Sigma', 'Tata Consultancy Services'])
    expect(p.totalExperience).toBe('8 – 12 Years')
    expect(Math.floor((p.experienceMonths ?? 0) / 12)).toBe(9) // the resume's own "9 years" (dates show 8.8)
    expect(p.education?.map((e) => [e.degree, e.institution, e.endYear])).toEqual([
      ['M.Tech, Computer Science', 'IIT Madras', '2017'],
      ['B.E., Electronics and Communication', 'PSG College of Technology', '2015'],
    ])
  })

  it('sales TXT: "Title | Company | City" lines are jobs', () => {
    const p = parse(SALES_TXT)
    expect(p.fullName).toBe('Rohan Mehta')
    expect(p.currentRole).toBe('Sales Manager')
    expect(jobs(SALES_TXT)).toEqual([
      ['Sales Manager', 'Freshline Software Pvt Ltd'],
      ['Senior Account Executive', 'CloudKart Technologies'],
      ['Business Development Representative', 'LeadSquare Solutions'],
    ])
    expect(p.workExperiences?.map((w) => w.location)).toEqual(['Mumbai', 'Pune', 'Pune'])
    expect(p.education?.map((e) => e.degree)).toEqual(['MBA, Marketing', 'B.Com'])
  })

  it('nurse: "Title – Dept, Employer, City" and no bullet becomes a job title', () => {
    const p = parse(NURSE_PDF)
    expect(p.fullName).toBe("Priya D'Souza")
    expect(jobs(NURSE_PDF)).toEqual([
      ['Staff Nurse – ICU', 'Father Muller Medical College Hospital'],
      ['Staff Nurse – Emergency', 'KMC Hospital'],
    ])
    expect(p.workExperiences?.[1].startDate).toBe('Nov 2020')
    expect(p.totalExperience).toBe('5 – 8 Years')
    expect(p.workExperiences?.every((w) => w.location === 'Mangaluru')).toBe(true)
    expect(p.workExperiences?.[0].responsibilities).toContain('Trained 12 new nurses')
    expect(p.education?.[0]).toMatchObject({ degree: 'B.Sc Nursing', institution: 'Laxmi Memorial College of Nursing', endYear: '2020' })
  })

  it('two-column designer: the real name (never a tool), Pune, tools + skills, education', () => {
    const p = parse(DESIGNER_TWO_COLUMN_PDF)
    expect(p.fullName).toBe('Ananya Kulkarni')
    expect(p.currentRole).toBe('Senior Product Designer')
    expect(p.currentLocation).toBe('Pune')
    expect(p.skills).toEqual(expect.arrayContaining(['Figma', 'Adobe XD', 'Sketch', 'Protopie', 'UI Design', 'UX Research', 'Usability Testing']))
    expect(p.skills).not.toContain('Photoshop') // already listed as "Adobe Photoshop"
    expect(jobs(DESIGNER_TWO_COLUMN_PDF).map((j) => j[1])).toEqual(['Zeta Fintech', 'Ola Electric', 'Pixel Pebble Studio'])
    expect(p.education?.[0]).toEqual({ degree: 'B.Des, Interaction Design', institution: 'MIT Institute of Design', endYear: '2019' })
    expect(resumeExtractToProfilePatch(p)).toMatchObject({ fullName: 'Ananya Kulkarni' })
  })
})

describe('Gemini + regex merge', () => {
  it('keeps the regex name when the model returns a tool, uses the model name when it is the person on the page', () => {
    const regex = { ...parse(DESIGNER_TWO_COLUMN_PDF), fullName: 'Adobe Xd' } // what the old blocklist produced
    const good = mergeAiWithRegex(DESIGNER_TWO_COLUMN_PDF, formatAiExtract({ fullName: 'Ananya Kulkarni', skills: ['Figma'] }, DESIGNER_TWO_COLUMN_PDF), regex)
    expect(good.fullName).toBe('Ananya Kulkarni')
    const invented = mergeAiWithRegex(DESIGNER_TWO_COLUMN_PDF, formatAiExtract({ fullName: 'Meera Joshi', skills: ['Figma'] }, DESIGNER_TWO_COLUMN_PDF), parse(DESIGNER_TWO_COLUMN_PDF))
    expect(invented.fullName).toBe('Ananya Kulkarni')
  })

  it("prefers the model's role, location, work history and education when it returned them", () => {
    const regex = { ...parse(SALES_TXT), currentRole: undefined, workExperiences: [] }
    const ai = formatAiExtract(
      {
        fullName: 'Rohan Mehta',
        currentRole: 'Sales Manager',
        currentLocation: 'Mumbai',
        skills: ['B2B Sales'],
        workExperiences: [
          { jobTitle: 'Sales Manager', company: 'Freshline Software Pvt Ltd', startDate: 'Apr 2023', endDate: 'Present', currentlyWorking: true },
          { jobTitle: 'Senior Account Executive', company: 'CloudKart Technologies', startDate: 'Jun 2021', endDate: 'Mar 2023' },
        ],
        education: [{ degree: 'MBA, Marketing', institution: 'Symbiosis Institute of Business Management', endYear: '2018' }],
      },
      SALES_TXT,
    )
    const merged = mergeAiWithRegex(SALES_TXT, ai, regex)
    expect(merged.currentRole).toBe('Sales Manager')
    expect(merged.workExperiences?.map((w) => w.company)).toEqual(['Freshline Software Pvt Ltd', 'CloudKart Technologies'])
    expect(merged.education?.[0].institution).toBe('Symbiosis Institute of Business Management')
    // regex fills what the model left out
    const sparse = mergeAiWithRegex(SALES_TXT, formatAiExtract({ fullName: 'Rohan Mehta', skills: ['B2B Sales'] }, SALES_TXT), parse(SALES_TXT))
    expect(sparse.currentRole).toBe('Sales Manager')
    expect(sparse.education?.length).toBe(2)
  })
})

describe('experience shown in years, not the band lower bound', () => {
  it('9 yrs inside "8 – 12 Years" from the resume, null outside the band', () => {
    expect(yearsWithinBand('8 – 12 Years', DATA_SCIENTIST_PDF, NOW)).toBe(9) // "9 years of experience"
    expect(yearsWithinBand('5 – 8 Years', SALES_TXT, NOW)).toBe(6)
    // Oct 2022 – Present + Nov 2020 – Sep 2022, as of Nov 2026: 6 years (more than the "4 years" written earlier)
    expect(yearsWithinBand('5 – 8 Years', NURSE_PDF, NOW)).toBe(6)
    expect(yearsWithinBand('0 – 1 Years', SALES_TXT, NOW)).toBeNull()
    expect(yearsWithinBand('6', SALES_TXT, NOW)).toBeNull()
  })
})
