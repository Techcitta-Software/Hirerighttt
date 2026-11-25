import { describe, expect, it } from 'vitest'
import { extractNameFromText, looksLikePersonName } from './resumeName'
import { resumeNameOf } from './candidateName'

const SPLIT = 'RS\nRavi Shankar\nNallamothu\nAI Engineer · Generative AI\nCONTACT\nE-MAIL\nnallamothuravi9@gmail.com\nSKILLS\nGoogle Gemini API'
const JUMBLED =
  'PROFILE RS AI Engineer who ships Generative AI in Python. Hands-on with the Google Gemini API, Amazon Bedrock and ' +
  'AWS. Ravi Shankar Looking to build reliable AI products. Nallamothu CORE STRENGTHS RAG Engineering CONTACT ' +
  'E-MAIL nallamothuravi9@gmail.com LOCATION Hyderabad, India'

describe('resume name: two-column layouts and split surnames', () => {
  it('never treats a product or API as a name', () => {
    for (const v of ['Gemini API', 'Google Gemini API', 'Amazon Bedrock', 'FastAPI', 'Hyderabad']) {
      expect(looksLikePersonName(v)).toBe(false)
    }
  })
  it('joins a surname on its own line, confirmed by the email', () => {
    expect(extractNameFromText(SPLIT)).toBe('Ravi Shankar Nallamothu')
  })
  it('finds the name in a two-column resume read out of order', () => {
    expect(extractNameFromText(JUMBLED)).toBe('Ravi Shankar Nallamothu')
  })
  it('ignores an AI extract that is a product name', () => {
    expect(resumeNameOf({ resumeFullName: 'Gemini API', resumeText: JUMBLED })).toBe('Ravi Shankar Nallamothu')
  })
  it('does not add a city from the email to the name', () => {
    expect(extractNameFromText('Rahul Verma\nrahul.hyderabad@gmail.com\nHyderabad, India')).toBe('Rahul Verma')
  })
  it('keeps ordinary resumes unchanged', () => {
    expect(extractNameFromText('KAVYA IYER\nSenior Frontend Developer\nkavya.iyer@gmail.com | Chennai')).toBe('Kavya Iyer')
  })
})
