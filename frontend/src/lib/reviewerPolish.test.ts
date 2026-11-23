import { describe, expect, it } from 'vitest'
import { formatPhoneForDisplay } from './phone'
import { EXPERIENCE_RANGE_LABELS, monthsToLabel } from './resumeExperience'

describe('formatPhoneForDisplay', () => {
  it('formats Indian numbers stored as bare digits', () => {
    expect(formatPhoneForDisplay('919845012345')).toBe('+91 98450 12345')
    expect(formatPhoneForDisplay('9845012345')).toBe('98450 12345')
  })

  it('leaves other values as typed', () => {
    expect(formatPhoneForDisplay('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    expect(formatPhoneForDisplay('')).toBe('')
  })
})

describe('EXPERIENCE_RANGE_LABELS', () => {
  it('offers every range the resume parser can produce, so the profile form never falls back to the first option', () => {
    for (const months of [6, 18, 30, 48, 72, 120, 200]) {
      expect(EXPERIENCE_RANGE_LABELS).toContain(monthsToLabel(months))
    }
  })
})
