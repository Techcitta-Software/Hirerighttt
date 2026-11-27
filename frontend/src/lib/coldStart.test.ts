import { describe, expect, it } from 'vitest'
import { COLD_START_BANNER, COLD_START_RETRY_TIMEOUT_MS, decideColdStartRetry } from './coldStart'

describe('cold-start retry', () => {
  it('wakes the server on the first timeout before health has succeeded', () => {
    const decision = decideColdStartRetry({
      healthSucceeded: false,
      alreadyRetriedThisTab: false,
      isTimeoutOrNetwork: true,
    })
    expect(decision.retry).toBe(true)
    expect(decision.banner).toBe(COLD_START_BANNER)
    expect(decision.timeoutMs).toBe(75_000)
    expect(COLD_START_RETRY_TIMEOUT_MS).toBe(75_000)
  })

  it('does not retry after health has succeeded, or after the one retry in this tab', () => {
    expect(
      decideColdStartRetry({ healthSucceeded: true, alreadyRetriedThisTab: false, isTimeoutOrNetwork: true }).retry,
    ).toBe(false)
    expect(
      decideColdStartRetry({ healthSucceeded: false, alreadyRetriedThisTab: true, isTimeoutOrNetwork: true }).retry,
    ).toBe(false)
    expect(
      decideColdStartRetry({ healthSucceeded: false, alreadyRetriedThisTab: false, isTimeoutOrNetwork: false }).retry,
    ).toBe(false)
  })
})
