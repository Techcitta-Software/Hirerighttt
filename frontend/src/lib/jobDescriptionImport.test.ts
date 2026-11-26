import { describe, expect, it } from 'vitest'
import { experienceFromText, isJobDescriptionFile, parseJobDescription } from './jobDescriptionImport'

const SAMPLE = `Job title: Senior Backend Engineer
Location: Hyderabad / Remote
Experience: 5+ years
Required skills: Node.js, PostgreSQL, AWS
- TypeScript

About the role
Build the hiring API and keep interviews reliable.
`

describe('parseJobDescription', () => {
  it('reads labeled fields and keeps the document as the description', () => {
    const parsed = parseJobDescription(SAMPLE)
    expect(parsed.title).toBe('Senior Backend Engineer')
    expect(parsed.location).toBe('Hyderabad / Remote')
    expect(parsed.experienceLevel).toBe('6+ years')
    expect(parsed.skills).toEqual(['Node.js', 'PostgreSQL', 'AWS', 'TypeScript'])
    expect(parsed.description).toContain('Build the hiring API')
  })

  it('uses the first short line as the title when the document has no label', () => {
    const parsed = parseJobDescription('Product Designer\n\nOwn the vendor hiring screens.\nWork with engineering.')
    expect(parsed.title).toBe('Product Designer')
    expect(parsed.description.length).toBeGreaterThan(30)
  })

  it('maps year ranges onto the three experience choices', () => {
    expect(experienceFromText('0-2 years')).toBe('0-2 years')
    expect(experienceFromText('3 to 5 years')).toBe('3-5 years')
    expect(experienceFromText('junior')).toBe('0-2 years')
  })
})

describe('isJobDescriptionFile', () => {
  it('accepts pdf and docx only', () => {
    expect(isJobDescriptionFile({ name: 'role.pdf', type: 'application/pdf' })).toBe(true)
    expect(isJobDescriptionFile({ name: 'role.docx', type: '' })).toBe(true)
    expect(isJobDescriptionFile({ name: 'role.doc', type: 'application/msword' })).toBe(false)
    expect(isJobDescriptionFile({ name: 'role.txt', type: 'text/plain' })).toBe(false)
  })
})

/** T2: the recruiter's JD PDF had its labels inline, so the location was missed and the form kept its default city. */
const INLINE_JD = `Senior Backend Engineer (Python/FastAPI)
Company: Lumora Fintech Pvt Ltd Location: Bengaluru, Karnataka, India (Hybrid)
Experience: 4-6 years Employment type: Full-time
About the role
We are looking for a Senior Backend Engineer to design, build and operate payment APIs. Location: our office or home.
Skills: Python, FastAPI, PostgreSQL, Redis
`

describe('inline labels and experience ranges (T2)', () => {
  it('reads "Company: … Location: …" and "Experience: … Employment type: …" on one line', () => {
    const parsed = parseJobDescription(INLINE_JD)
    expect(parsed.title).toBe('Senior Backend Engineer (Python/FastAPI)')
    expect(parsed.location).toBe('Bengaluru, Karnataka, India (Hybrid)')
    expect(parsed.experienceLevel).toBe('6+ years') // 4-6 spans 3-5 and 6+; a Senior title takes the upper choice
    expect(parsed.skills).toEqual(['Python', 'FastAPI', 'PostgreSQL', 'Redis'])
    // The JD's own figure stays visible to candidates in the description.
    expect(parsed.description).toContain('Experience: 4-6 years')
  })

  it('no location in the document leaves the field empty (the form keeps its own default)', () => {
    expect(parseJobDescription('Data Analyst\nExperience: 2 years\nSQL and dashboards for the finance team.').location).toBe('')
  })

  it('maps ranges to the nearest of the three existing choices', () => {
    expect(experienceFromText('4-6 years')).toBe('3-5 years') // overlaps 3-5 by two years, 6+ by one
    expect(experienceFromText('4-6 years', 'Senior Backend Engineer')).toBe('6+ years')
    expect(experienceFromText('2-4 years')).toBe('3-5 years')
    expect(experienceFromText('2-4 years', 'Junior Developer')).toBe('0-2 years')
    expect(experienceFromText('5-7 years')).toBe('6+ years')
    expect(experienceFromText('3-5 years', 'Senior Engineer')).toBe('3-5 years')
  })
})
