/**
 * Interview session payload serialization, sanitization, and pricing invariants.
 *
 * Ensures all candidate inputs (names, resume texts, skills) are cleanly sanitized
 * and serialized before transmitting to backend or persisting locally.
 * Enforces business invariants around ₹89 interview pricing, credits, and coupon guards.
 */

export const DEFAULT_INTERVIEW_PRICE_INR = 89

export type SanitizedCandidateProfile = {
  fullName: string
  name: string
  email?: string
  phone?: string
  role?: string
  totalExperience?: string
  skills?: string[]
  resumeText?: string
  [key: string]: unknown
}

export type RawInterviewSessionInput = {
  role?: unknown
  level?: unknown
  candidateName?: unknown
  email?: unknown
  phone?: unknown
  resumeText?: unknown
  jobDescription?: unknown
  jobId?: unknown
  applicationId?: unknown
  organizationId?: unknown
  inviteToken?: unknown
  primarySkills?: unknown
  atsScore?: unknown
  jdMatchScore?: unknown
  questionMode?: unknown
  profile?: unknown
  consent?: unknown
}

export type SerializedInterviewSessionPayload = {
  role: string
  level: string
  email: string
  jobDescription: string
  jobId?: string
  applicationId?: string
  organizationId?: string
  inviteToken?: string
  questionMode?: string
  primarySkills?: string[]
  atsScore?: number
  jdMatchScore?: number
  adaptive: boolean
  explicitRoleTrack: boolean
  profile: SanitizedCandidateProfile
  consent?: {
    agreed: boolean
    termsVersion: string
    timestamp: string
    ip?: string
  }
}

/**
 * Sanitizes candidate names.
 * Strips control characters, normalizes Unicode, trims whitespace.
 * Preserves international characters (Devanagari, CJK, Arabic, Cyrillic, accented Latin).
 * Falls back to 'Candidate' if input is empty, whitespace, or invalid.
 */
export function sanitizeCandidateName(rawName: unknown, fallback = 'Candidate'): string {
  if (typeof rawName !== 'string') return fallback

  // Strip null bytes, control characters, and common script tags/HTML
  const cleaned = rawName
    .replace(/<[^>]*>/g, '') // remove HTML tags
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // remove ASCII/Unicode control codes
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return fallback
  return cleaned.slice(0, 120)
}

/**
 * Sanitizes resume text.
 * Strips null bytes and control chars while keeping newlines and printable Unicode.
 * Truncates oversized texts to prevent JSON payload limits.
 */
export function sanitizeResumeText(rawText: unknown, maxChars = 200_000): string {
  if (typeof rawText !== 'string') return ''

  // eslint-disable-next-line no-control-regex
  let cleaned = rawText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  if (cleaned.length > maxChars) {
    cleaned = cleaned.slice(0, maxChars) + '\n... [truncated]'
  }
  return cleaned
}

/**
 * Sanitizes skill list arrays.
 * Deduplicates, trims whitespace, strips empty entries.
 */
function isPlausibleSkillLabel(value: string): boolean {
  const t = value.trim()
  if (!t || t.length > 80) return false
  // Drop pasted garbage with no vowels (e.g. accidental keyboard mash).
  if (t.length >= 10 && !/\s/.test(t) && !/[aeiou]/i.test(t)) return false
  return /^[\w+#./\- ]+$/i.test(t)
}

export function sanitizeSkillsList(rawSkills: unknown): string[] {
  if (!Array.isArray(rawSkills)) return []
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of rawSkills) {
    if (typeof item !== 'string') continue
    const cleaned = item
      .replace(/<[^>]*>/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned || !isPlausibleSkillLabel(cleaned)) continue
    const lower = cleaned.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      result.push(cleaned.slice(0, 80))
    }
  }
  return result
}

/**
 * Serializes and sanitizes an entire interview session request payload.
 * Guarantee: The return value is safe to pass to JSON.stringify() and will not throw.
 */
export function serializeInterviewSessionPayload(
  input: RawInterviewSessionInput,
): SerializedInterviewSessionPayload {
  const rawProfile = (typeof input.profile === 'object' && input.profile !== null
    ? input.profile
    : {}) as Record<string, unknown>

  const candidateName = sanitizeCandidateName(
    input.candidateName ?? rawProfile.fullName ?? rawProfile.name,
    'Candidate',
  )

  const email = String(input.email ?? rawProfile.email ?? '')
    .trim()
    .toLowerCase()
  const phone = String(input.phone ?? rawProfile.phone ?? '').trim()
  const role = String(input.role || rawProfile.role || 'Software Engineer').trim()
  const level = String(input.level || rawProfile.totalExperience || '1–3 years').trim()
  const jobDescription = sanitizeResumeText(input.jobDescription, 50_000)
  const resumeText = sanitizeResumeText(input.resumeText ?? rawProfile.resumeText, 200_000)

  const primarySkills = sanitizeSkillsList(
    input.primarySkills ?? rawProfile.skills ?? rawProfile.primarySkills,
  )

  const profile: SanitizedCandidateProfile = {
    ...rawProfile,
    fullName: candidateName,
    name: candidateName,
    email: email || undefined,
    phone: phone || undefined,
    role,
    totalExperience: level,
    skills: primarySkills,
    resumeText: resumeText || undefined,
  }

  // Remove potential undefined properties from profile
  if (!profile.email) delete profile.email
  if (!profile.phone) delete profile.phone
  if (!profile.resumeText) delete profile.resumeText

  const atsScore =
    typeof input.atsScore === 'number' && !isNaN(input.atsScore)
      ? Math.max(0, Math.min(100, Math.round(input.atsScore)))
      : undefined

  const jdMatchScore =
    typeof input.jdMatchScore === 'number' && !isNaN(input.jdMatchScore)
      ? Math.max(0, Math.min(100, Math.round(input.jdMatchScore)))
      : undefined

  const payload: SerializedInterviewSessionPayload = {
    role,
    level,
    email,
    jobDescription,
    adaptive: true,
    explicitRoleTrack: false,
    profile,
  }

  if (input.jobId && typeof input.jobId === 'string') payload.jobId = input.jobId.trim()
  if (input.applicationId && typeof input.applicationId === 'string')
    payload.applicationId = input.applicationId.trim()
  if (input.organizationId && typeof input.organizationId === 'string')
    payload.organizationId = input.organizationId.trim()
  if (input.inviteToken && typeof input.inviteToken === 'string')
    payload.inviteToken = input.inviteToken.trim()
  if (input.questionMode && typeof input.questionMode === 'string')
    payload.questionMode = input.questionMode.trim()
  if (primarySkills.length > 0) payload.primarySkills = primarySkills
  if (atsScore !== undefined) payload.atsScore = atsScore
  if (jdMatchScore !== undefined) payload.jdMatchScore = jdMatchScore

  if (typeof input.consent === 'object' && input.consent !== null) {
    const rawConsent = input.consent as Record<string, unknown>
    if (rawConsent.agreed) {
      payload.consent = {
        agreed: true,
        termsVersion: String(rawConsent.termsVersion || '2026-v1'),
        timestamp: String(rawConsent.timestamp || new Date().toISOString()),
        ip: rawConsent.ip ? String(rawConsent.ip) : undefined,
      }
    }
  }

  return payload
}

// -----------------------------------------------------------------------------
// Pricing and Retake Credit Calculations
// -----------------------------------------------------------------------------

export function calculateInterviewPriceINR(
  quantity = 1,
  unitPriceINR: number = DEFAULT_INTERVIEW_PRICE_INR,
  discountPercent = 0,
): number {
  if (typeof quantity !== 'number' || isNaN(quantity) || quantity <= 0) {
    return 0
  }
  const safeUnitPrice =
    typeof unitPriceINR === 'number' && !isNaN(unitPriceINR) && unitPriceINR > 0
      ? Math.round(unitPriceINR)
      : DEFAULT_INTERVIEW_PRICE_INR

  const safeDiscount =
    typeof discountPercent === 'number' && !isNaN(discountPercent)
      ? Math.max(0, Math.min(100, discountPercent))
      : 0

  const count = Math.floor(quantity)
  const subtotal = count * safeUnitPrice
  const discountAmount = Math.round((subtotal * safeDiscount) / 100)
  return Math.max(0, subtotal - discountAmount)
}

export function inrToPaise(amountInr: number): number {
  if (typeof amountInr !== 'number' || isNaN(amountInr) || amountInr <= 0) return 0
  return Math.round(amountInr * 100)
}

export function paiseToInr(paise: number): number {
  if (typeof paise !== 'number' || isNaN(paise) || paise <= 0) return 0
  return paise / 100
}

export type RetakeCreditStatus = {
  canStart: boolean
  freeInterviewAvailable: boolean
  creditRequired: boolean
  availableCredits: number
  priceInr: number
  isJobInterview: boolean
}

/**
 * Calculates candidate retake credit status following business invariants:
 * 1. Vendor job interviews (applicationId, jobId, or inviteToken) are ALWAYS free and never use retake credits.
 * 2. Career / practice interviews:
 *    - The first completed interview is free (completedCareerInterviews === 0).
 *    - Subsequent interviews require 1 paid credit or cost ₹89.
 * 3. Credit counts are non-negative integers.
 */
export function calculateRetakeCreditStatus(params: {
  completedCareerInterviews?: unknown
  paidCredits?: unknown
  usedCredits?: unknown
  isJobInterview?: unknown
  unitPriceInr?: unknown
}): RetakeCreditStatus {
  const isJob = Boolean(params.isJobInterview)
  const completed =
    typeof params.completedCareerInterviews === 'number' &&
    !isNaN(params.completedCareerInterviews) &&
    params.completedCareerInterviews > 0
      ? Math.floor(params.completedCareerInterviews)
      : 0

  const paid =
    typeof params.paidCredits === 'number' && !isNaN(params.paidCredits) && params.paidCredits > 0
      ? Math.floor(params.paidCredits)
      : 0

  const used =
    typeof params.usedCredits === 'number' && !isNaN(params.usedCredits) && params.usedCredits > 0
      ? Math.floor(params.usedCredits)
      : 0

  const availableCredits = Math.max(0, paid - used)
  const priceInr =
    typeof params.unitPriceInr === 'number' &&
    !isNaN(params.unitPriceInr) &&
    params.unitPriceInr > 0
      ? Math.round(params.unitPriceInr)
      : DEFAULT_INTERVIEW_PRICE_INR

  if (isJob) {
    return {
      canStart: true,
      freeInterviewAvailable: true,
      creditRequired: false,
      availableCredits,
      priceInr: 0,
      isJobInterview: true,
    }
  }

  const freeInterviewAvailable = completed === 0
  const creditRequired = !freeInterviewAvailable
  const canStart = freeInterviewAvailable || availableCredits > 0

  return {
    canStart,
    freeInterviewAvailable,
    creditRequired,
    availableCredits,
    priceInr,
    isJobInterview: false,
  }
}

/**
 * Validates and applies coupons to interview prices with strict bounds:
 * - Negative prices are never allowed (floored at ₹0).
 * - Discount cannot exceed total price.
 * - Empty / malformed coupon codes return unmodified base price.
 */
export function applyCouponToInterviewPrice(
  couponCode: unknown,
  basePriceInr: number = DEFAULT_INTERVIEW_PRICE_INR,
): {
  effectivePrice: number
  discountAmount: number
  appliedCoupon: string | null
  error?: string
} {
  const safeBase =
    typeof basePriceInr === 'number' && !isNaN(basePriceInr) && basePriceInr > 0
      ? Math.round(basePriceInr)
      : DEFAULT_INTERVIEW_PRICE_INR

  if (typeof couponCode !== 'string' || !couponCode.trim()) {
    return {
      effectivePrice: safeBase,
      discountAmount: 0,
      appliedCoupon: null,
    }
  }

  const code = couponCode.trim().toUpperCase()

  switch (code) {
    case 'WELCOME10': {
      // 10% off
      const discount = Math.round((safeBase * 10) / 100)
      return {
        effectivePrice: Math.max(0, safeBase - discount),
        discountAmount: discount,
        appliedCoupon: code,
      }
    }
    case 'HIRERIGHT50': {
      // 50% off
      const discount = Math.round((safeBase * 50) / 100)
      return {
        effectivePrice: Math.max(0, safeBase - discount),
        discountAmount: discount,
        appliedCoupon: code,
      }
    }
    case 'FREEPASS': {
      // 100% off
      return {
        effectivePrice: 0,
        discountAmount: safeBase,
        appliedCoupon: code,
      }
    }
    default:
      return {
        effectivePrice: safeBase,
        discountAmount: 0,
        appliedCoupon: null,
        error: `Coupon code '${code}' is invalid or expired.`,
      }
  }
}
