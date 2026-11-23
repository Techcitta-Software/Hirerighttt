import { describe, expect, it } from 'vitest'
import { retakeActionFor, type RetakeStatus } from './retakePayment'

const status = (over: Partial<RetakeStatus>): RetakeStatus => ({
  completedInterviews: 1,
  freeInterviewAvailable: false,
  retakeCredits: 0,
  canStartCareerInterview: false,
  priceInr: 89,
  paymentsConfigured: true,
  razorpayKeyId: 'rzp_test_x',
  ...over,
})

describe('retake page action', () => {
  it('starts directly while the free interview is unused', () => {
    expect(retakeActionFor(status({ freeInterviewAvailable: true, canStartCareerInterview: true }))).toBe('start-free')
  })

  it('starts directly with an unused paid credit', () => {
    expect(retakeActionFor(status({ retakeCredits: 1, canStartCareerInterview: true }))).toBe('start-credit')
  })

  it('asks for payment once the free interview is used (the server answers 402 otherwise)', () => {
    expect(retakeActionFor(status({}))).toBe('pay')
  })

  it('does not send candidates into a start that will fail when payments are not configured', () => {
    expect(retakeActionFor(status({ paymentsConfigured: false }))).toBe('unavailable')
  })

  it('lets the server decide when the status could not be read', () => {
    expect(retakeActionFor(null)).toBe('start-free')
  })
})
