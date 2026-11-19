import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERVIEW_PRICE_INR,
  sanitizeCandidateName,
  sanitizeResumeText,
  sanitizeSkillsList,
  serializeInterviewSessionPayload,
  calculateInterviewPriceINR,
  inrToPaise,
  paiseToInr,
  calculateRetakeCreditStatus,
  applyCouponToInterviewPrice,
  type RawInterviewSessionInput,
} from './interviewSessionPayload'

describe('interviewSessionPayload', () => {
  describe('candidate name sanitization and unicode handling', () => {
    it.each([
      ['अमित शर्मा', 'अमित शर्मा', 'Devanagari script'],
      ['فاطمة الزهراء', 'فاطمة الزهراء', 'Arabic script'],
      ['李小龙 (Bruce Lee)', '李小龙 (Bruce Lee)', 'CJK characters with Latin parens'],
      ['田中 太郎', '田中 太郎', 'Japanese Kanji with space'],
      ['Александр Пушкин', 'Александр Пушкин', 'Cyrillic script'],
      ['François Müller', 'François Müller', 'Latin with diacritics'],
      ['Nguyễn Văn A', 'Nguyễn Văn A', 'Vietnamese tone marks'],
      ['Kavya Subramanian', 'Kavya Subramanian', 'Standard South Asian English'],
      ['O’Connor-Smith, Jr.', 'O’Connor-Smith, Jr.', 'Apostrophes, hyphens, punctuation'],
    ])('preserves valid international unicode name: %s (%s)', (input, expected) => {
      expect(sanitizeCandidateName(input)).toBe(expected)
    })

    it('strips dangerous HTML tags, script injection, and control characters', () => {
      const malicious = '<script>alert("xss")</script>John Doe\x00\x08\x1B'
      expect(sanitizeCandidateName(malicious)).toBe('alert("xss")John Doe')
    })

    it('collapses multiple whitespace, tabs, and newlines into single spaces', () => {
      const messy = '   Jane   \t\t\n   Doe   \r\n   '
      expect(sanitizeCandidateName(messy)).toBe('Jane Doe')
    })

    it.each([
      ['', 'Candidate', 'empty string'],
      ['    ', 'Candidate', 'whitespace only'],
      ['\t\n\r', 'Candidate', 'newlines and tabs only'],
      [null, 'Candidate', 'null value'],
      [undefined, 'Candidate', 'undefined value'],
      [12345, 'Candidate', 'number type'],
      [{}, 'Candidate', 'object type'],
      [[], 'Candidate', 'array type'],
    ])('falls back to default when input is %s (%s)', (input, expected) => {
      expect(sanitizeCandidateName(input)).toBe(expected)
    })

    it('supports custom fallback string', () => {
      expect(sanitizeCandidateName('', 'Anonymous Applicant')).toBe('Anonymous Applicant')
      expect(sanitizeCandidateName(null, 'User_1001')).toBe('User_1001')
    })

    it('truncates excessively long candidate names beyond 120 chars safely', () => {
      const longName = 'A'.repeat(200)
      const sanitized = sanitizeCandidateName(longName)
      expect(sanitized).toHaveLength(120)
    })
  })

  describe('resume text sanitization and large document handling', () => {
    it('strips null bytes and control codes while preserving legitimate newlines and bullets', () => {
      const raw = 'Education:\n• Bachelor of Science\x00\x08 in CS\r\nGPA: 3.9'
      const sanitized = sanitizeResumeText(raw)
      expect(sanitized).toContain('Education:\n• Bachelor of Science in CS\r\nGPA: 3.9')
      expect(sanitized).not.toContain('\x00')
      expect(sanitized).not.toContain('\x08')
    })

    it('handles extremely large resume text without crashing and truncates safely', () => {
      const largeResume = 'Line of resume experience details.\n'.repeat(15_000) // ~525,000 characters
      expect(largeResume.length).toBeGreaterThan(500_000)

      const sanitized = sanitizeResumeText(largeResume, 100_000)
      expect(sanitized.length).toBeLessThanOrEqual(100_000 + 30)
      expect(sanitized).toContain('... [truncated]')
    })

    it('handles falsy or malformed resume text inputs', () => {
      expect(sanitizeResumeText(null)).toBe('')
      expect(sanitizeResumeText(undefined)).toBe('')
      expect(sanitizeResumeText(12345 as unknown as string)).toBe('')
      expect(sanitizeResumeText('')).toBe('')
    })
  })

  describe('skills list sanitization', () => {
    it('deduplicates case-insensitively, trims whitespace, and strips empties', () => {
      const raw = ['  React  ', 'TypeScript', 'react', 'TYPESCRIPT', '', '   ', 'Node.js', null as unknown as string]
      const sanitized = sanitizeSkillsList(raw)
      expect(sanitized).toEqual(['React', 'TypeScript', 'Node.js'])
    })

    it('handles non-array inputs cleanly', () => {
      expect(sanitizeSkillsList(null)).toEqual([])
      expect(sanitizeSkillsList(undefined)).toEqual([])
      expect(sanitizeSkillsList('React, TypeScript')).toEqual([])
    })
  })

  describe('full interview session serialization', () => {
    it('serializes a complete session with unicode candidate details into valid JSON', () => {
      const input: RawInterviewSessionInput = {
        role: 'Senior Frontend Engineer',
        level: '5+ years',
        candidateName: 'Kavya Subramanian (काव्य)',
        email: 'Kavya.Sub@Example.Com  ',
        phone: '+91 98765 43210',
        resumeText: 'Full Stack Engineer with 5 years in React & Node.js.\nProject 1: Real-time Proctoring.',
        jobDescription: 'Seeking Senior Frontend Engineer with experience in WebRTC and TypeScript.',
        jobId: 'job_react_101',
        applicationId: 'app_cand_999',
        organizationId: 'org_techcorp_42',
        inviteToken: 'inv_token_abc123',
        primarySkills: ['React', 'TypeScript', 'WebRTC', 'React'],
        atsScore: 92.4,
        jdMatchScore: 88.6,
        questionMode: 'individual_jd',
        consent: {
          agreed: true,
          termsVersion: '2026-v2',
          timestamp: '2026-11-19T10:00:00.000Z',
          ip: '192.168.1.1',
        },
      }

      const payload = serializeInterviewSessionPayload(input)

      // Serialization invariants
      expect(payload.role).toBe('Senior Frontend Engineer')
      expect(payload.level).toBe('5+ years')
      expect(payload.email).toBe('kavya.sub@example.com') // normalized lowercase
      expect(payload.profile.fullName).toBe('Kavya Subramanian (काव्य)')
      expect(payload.primarySkills).toEqual(['React', 'TypeScript', 'WebRTC']) // deduplicated
      expect(payload.atsScore).toBe(92) // rounded integer
      expect(payload.jdMatchScore).toBe(89) // rounded integer
      expect(payload.jobId).toBe('job_react_101')
      expect(payload.applicationId).toBe('app_cand_999')
      expect(payload.organizationId).toBe('org_techcorp_42')
      expect(payload.inviteToken).toBe('inv_token_abc123')
      expect(payload.consent?.agreed).toBe(true)

      // Verifies JSON safety
      const jsonString = JSON.stringify(payload)
      expect(() => JSON.parse(jsonString)).not.toThrow()
      const reparsed = JSON.parse(jsonString)
      expect(reparsed.profile.fullName).toBe('Kavya Subramanian (काव्य)')
      expect(reparsed.atsScore).toBe(92)
    })

    it('handles empty strings, missing fields, and null objects gracefully without throwing', () => {
      const emptyInput: RawInterviewSessionInput = {}
      const payload = serializeInterviewSessionPayload(emptyInput)

      expect(payload.role).toBe('Software Engineer')
      expect(payload.level).toBe('1–3 years')
      expect(payload.email).toBe('')
      expect(payload.profile.fullName).toBe('Candidate')
      expect(payload.profile.name).toBe('Candidate')
      expect(payload.primarySkills).toBeUndefined()
      expect(payload.atsScore).toBeUndefined()
      expect(payload.consent).toBeUndefined()

      const json = JSON.stringify(payload)
      expect(json).toBeTruthy()
    })
  })

  describe('pricing and credit calculation invariants (₹89 per interview)', () => {
    it('enforces ₹89 fallback when unit price is missing, zero, negative, or invalid', () => {
      expect(DEFAULT_INTERVIEW_PRICE_INR).toBe(89)
      expect(calculateInterviewPriceINR(1)).toBe(89)
      expect(calculateInterviewPriceINR(1, undefined)).toBe(89)
      expect(calculateInterviewPriceINR(1, 0)).toBe(89)
      expect(calculateInterviewPriceINR(1, -50)).toBe(89)
      expect(calculateInterviewPriceINR(1, NaN)).toBe(89)
    })

    it('calculates tiered / multiple interview purchase totals correctly', () => {
      expect(calculateInterviewPriceINR(1, 89)).toBe(89)
      expect(calculateInterviewPriceINR(2, 89)).toBe(178)
      expect(calculateInterviewPriceINR(5, 89)).toBe(445)
      expect(calculateInterviewPriceINR(10, 89)).toBe(890)
    })

    it('handles invalid or non-positive interview counts by returning 0', () => {
      expect(calculateInterviewPriceINR(0, 89)).toBe(0)
      expect(calculateInterviewPriceINR(-1, 89)).toBe(0)
      expect(calculateInterviewPriceINR(-10, 89)).toBe(0)
      expect(calculateInterviewPriceINR(NaN, 89)).toBe(0)
      expect(calculateInterviewPriceINR(null as unknown as number, 89)).toBe(0)
    })

    it('converts INR rupees to paise and paise to rupees accurately', () => {
      expect(inrToPaise(89)).toBe(8900)
      expect(inrToPaise(178)).toBe(17800)
      expect(inrToPaise(0)).toBe(0)
      expect(inrToPaise(-89)).toBe(0)
      expect(inrToPaise(NaN)).toBe(0)

      expect(paiseToInr(8900)).toBe(89)
      expect(paiseToInr(17800)).toBe(178)
      expect(paiseToInr(0)).toBe(0)
      expect(paiseToInr(-500)).toBe(0)
    })

    describe('calculateRetakeCreditStatus business rules', () => {
      it('always grants free access for job interviews regardless of credits or career count', () => {
        const status = calculateRetakeCreditStatus({
          completedCareerInterviews: 5,
          paidCredits: 0,
          isJobInterview: true,
        })
        expect(status.canStart).toBe(true)
        expect(status.creditRequired).toBe(false)
        expect(status.freeInterviewAvailable).toBe(true)
        expect(status.priceInr).toBe(0)
        expect(status.isJobInterview).toBe(true)
      })

      it('grants free access for candidate first career interview (completedCount = 0)', () => {
        const status = calculateRetakeCreditStatus({
          completedCareerInterviews: 0,
          paidCredits: 0,
          isJobInterview: false,
        })
        expect(status.canStart).toBe(true)
        expect(status.freeInterviewAvailable).toBe(true)
        expect(status.creditRequired).toBe(false)
        expect(status.priceInr).toBe(89)
        expect(status.availableCredits).toBe(0)
      })

      it('blocks retake without credits and requires ₹89 payment for second career interview', () => {
        const status = calculateRetakeCreditStatus({
          completedCareerInterviews: 1,
          paidCredits: 0,
          isJobInterview: false,
        })
        expect(status.canStart).toBe(false)
        expect(status.freeInterviewAvailable).toBe(false)
        expect(status.creditRequired).toBe(true)
        expect(status.priceInr).toBe(89)
        expect(status.availableCredits).toBe(0)
      })

      it('allows retake when candidate has paid credits available', () => {
        const status = calculateRetakeCreditStatus({
          completedCareerInterviews: 1,
          paidCredits: 3,
          usedCredits: 1,
          isJobInterview: false,
        })
        expect(status.canStart).toBe(true)
        expect(status.freeInterviewAvailable).toBe(false)
        expect(status.creditRequired).toBe(true)
        expect(status.availableCredits).toBe(2)
      })

      it('safely normalizes negative or malformed counts to zero', () => {
        const status = calculateRetakeCreditStatus({
          completedCareerInterviews: -5,
          paidCredits: -2,
          usedCredits: 'invalid' as unknown as number,
        })
        expect(status.canStart).toBe(true) // 0 completed -> free first interview
        expect(status.availableCredits).toBe(0)
        expect(status.priceInr).toBe(89)
      })
    })

    describe('applyCouponToInterviewPrice guards', () => {
      it('applies percentage discounts correctly', () => {
        // 10% off ₹89 -> ₹89 - ₹9 = ₹80
        const tenOff = applyCouponToInterviewPrice('WELCOME10', 89)
        expect(tenOff.effectivePrice).toBe(80)
        expect(tenOff.discountAmount).toBe(9)
        expect(tenOff.appliedCoupon).toBe('WELCOME10')

        // 50% off ₹89 -> discount = Math.round(44.5) = 45 -> effective = 89 - 45 = 44
        const halfOff = applyCouponToInterviewPrice('HIRERIGHT50', 89)
        expect(halfOff.effectivePrice).toBe(44)
        expect(halfOff.discountAmount).toBe(45)
        expect(halfOff.appliedCoupon).toBe('HIRERIGHT50')

        // 100% off FREEPASS
        const free = applyCouponToInterviewPrice('FREEPASS', 89)
        expect(free.effectivePrice).toBe(0)
        expect(free.discountAmount).toBe(89)
      })

      it('handles invalid or expired coupon codes without reducing base price', () => {
        const res = applyCouponToInterviewPrice('BOGUS_CODE', 89)
        expect(res.effectivePrice).toBe(89)
        expect(res.discountAmount).toBe(0)
        expect(res.appliedCoupon).toBeNull()
        expect(res.error).toMatch(/invalid or expired/i)
      })

      it('handles null, undefined, empty, or whitespace coupons safely', () => {
        expect(applyCouponToInterviewPrice(null, 89).effectivePrice).toBe(89)
        expect(applyCouponToInterviewPrice(undefined, 89).effectivePrice).toBe(89)
        expect(applyCouponToInterviewPrice('', 89).effectivePrice).toBe(89)
        expect(applyCouponToInterviewPrice('   ', 89).effectivePrice).toBe(89)
      })

      it('guarantees effectivePrice is never negative', () => {
        const res = applyCouponToInterviewPrice('FREEPASS', 0)
        expect(res.effectivePrice).toBe(0)
      })
    })
  })
})
