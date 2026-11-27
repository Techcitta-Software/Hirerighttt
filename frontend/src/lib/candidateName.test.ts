import { describe, expect, it } from 'vitest'
import { firstWordOf, nameInResume, resolveCandidateNameFrom, resumeNameOf, withoutAppendedEmailTokens } from './candidateName'
import { extractNameFromText, normalizePersonName } from './resumeName'

const NEW_RESUME = 'Bharath Krishna Pachimatla\nAI Engineer | Generative AI | Python\nHyderabad, India | +91 9010383256'
const OLD_RESUME = 'Giribabu Kothapalli\nIT Recruiter\nHyderabad, India'
const CAPS_RESUME = 'KAVYA IYER\nSenior Data Analyst\nkavya@example.com | +91 98765 43210'

describe('candidate name: the resume always wins', () => {
  it('uses the resume name over a different signup name', () => {
    expect(resolveCandidateNameFrom({ resumeText: NEW_RESUME }, { name: 'Ravi Teja' })).toBe('Bharath Krishna Pachimatla')
  })

  it('uses the resume name over a different saved profile name', () => {
    const profile = { fullName: 'Giribabu Kothapalli', name: 'Giribabu Kothapalli', resumeText: NEW_RESUME }
    expect(resolveCandidateNameFrom(profile, 'Bharath')).toBe('Bharath Krishna Pachimatla')
  })

  it('uses the parsed resume name only when it is written on the resume', () => {
    expect(resolveCandidateNameFrom({ resumeFullName: 'Mallory Fake', resumeText: NEW_RESUME }, '')).toBe(
      'Bharath Krishna Pachimatla',
    )
    expect(nameInResume('Bharath Pachimatla', NEW_RESUME)).toBe(true)
    expect(nameInResume('Mallory Fake', NEW_RESUME)).toBe(false)
  })

  it('follows the new resume when the resume is replaced', () => {
    const before = { fullName: 'Giribabu Kothapalli', resumeFullName: 'Giribabu Kothapalli', resumeText: OLD_RESUME }
    expect(resolveCandidateNameFrom(before, 'Signup Name')).toBe('Giribabu Kothapalli')
    const after = { ...before, resumeText: NEW_RESUME }
    expect(resolveCandidateNameFrom(after, 'Signup Name')).toBe('Bharath Krishna Pachimatla')
  })

  it('names an applicant row by the resume on the row, not the name typed at signup', () => {
    const applicantRow = { fullName: 'Signup Name', resumeText: CAPS_RESUME }
    expect(resolveCandidateNameFrom(applicantRow, 'Signup Name')).toBe('Kavya Iyer')
  })
})

describe('candidate name: fallbacks', () => {
  it('falls back to the signup name without a resume', () => {
    expect(resolveCandidateNameFrom({}, { name: 'Priya Nair' })).toBe('Priya Nair')
    expect(resolveCandidateNameFrom({ fullName: 'Typed Name' }, { name: 'Priya Nair' })).toBe('Priya Nair')
    expect(resolveCandidateNameFrom(null, { name: 'Priya Nair' })).toBe('Priya Nair')
  })

  it('falls back to the signup name when the resume has no readable name', () => {
    expect(resolveCandidateNameFrom({ resumeText: 'ai engineer | python | fastapi | rag' }, 'Priya Nair')).toBe(
      'Priya Nair',
    )
  })

  it('never uses the demo placeholder and ends at Candidate', () => {
    expect(resolveCandidateNameFrom({ fullName: 'Arjun Sharma' }, 'Bharath')).toBe('Bharath')
    expect(resolveCandidateNameFrom({ fullName: 'Arjun Sharma' }, { name: 'Arjun Sharma' })).toBe(
      'Arjun Sharma',
    )
    expect(resolveCandidateNameFrom({}, '')).toBe('Candidate')
    expect(firstWordOf('Candidate')).toBe('there')
    expect(firstWordOf('Kavya Iyer')).toBe('Kavya')
  })
})

describe('candidate name: extraction and normalisation', () => {
  it('title-cases all-caps resume names', () => {
    expect(extractNameFromText(CAPS_RESUME)).toBe('Kavya Iyer')
    expect(resumeNameOf({ resumeText: CAPS_RESUME })).toBe('Kavya Iyer')
    expect(resumeNameOf({ resumeFullName: 'KAVYA IYER', resumeText: CAPS_RESUME })).toBe('Kavya Iyer')
    expect(normalizePersonName("d'souza")).toBe("D'Souza")
  })

  it('keeps initials and mixed-case names as written', () => {
    expect(extractNameFromText('K. Ramesh Rao\nBackend Engineer')).toBe('K. Ramesh Rao')
    expect(normalizePersonName('Ronald McDonald')).toBe('Ronald McDonald')
    expect(normalizePersonName('B.K. SINGH')).toBe('B.K. Singh')
  })

  it('does not take a job title or technology list for a name', () => {
    expect(extractNameFromText('Senior Software Engineer\nPython | AWS | React')).toBeNull()
    expect(resolveCandidateNameFrom({ resumeText: 'Python Developer\nReact Node AWS' }, 'Asha Rao')).toBe('Asha Rao')
  })

  it('does not append an email token with a dot, digits, or a word already in the name', () => {
    const text = 'Priya Nair\nEngineer\npriya.cand.proc9@gmail.com\nHyderabad'
    expect(withoutAppendedEmailTokens('Priya Nair cand.proc Nair9 Nair')).toBe('Priya Nair')
    expect(withoutAppendedEmailTokens("Priya D'Souza Souza")).toBe("Priya D'Souza")
    expect(withoutAppendedEmailTokens('B.K. Singh')).toBe('B.K. Singh')
    expect(resumeNameOf({ resumeFullName: 'Priya Nair cand.proc Nair9', resumeText: text })).toBe('Priya Nair')
    expect(resumeNameOf({ resumeText: 'B.K. Singh\nBackend Engineer' })).toBe('B.K. Singh')
  })
})
