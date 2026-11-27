/** Shown once, in this tab, when the first request fails before the API has answered /api/health. */
export const COLD_START_BANNER = 'Waking up the server — this can take up to a minute…'

/** The one retry uses a long timeout so a sleeping host can finish booting. */
export const COLD_START_RETRY_TIMEOUT_MS = 75_000

export type ColdStartInput = {
  /** /api/health has already returned ok in this tab. */
  healthSucceeded: boolean
  /** This tab already used its one cold-start retry. */
  alreadyRetriedThisTab: boolean
  /** The failure was a timeout or a network error (no HTTP answer). */
  isTimeoutOrNetwork: boolean
}

export type ColdStartDecision = {
  retry: boolean
  banner: string
  timeoutMs: number
}

/**
 * First timeout or network failure in a tab, before health has succeeded: show the waking-up banner and
 * retry that request once. Later failures, and any failure after health is up, are left to the caller.
 */
export function decideColdStartRetry(input: ColdStartInput): ColdStartDecision {
  const retry = input.isTimeoutOrNetwork && !input.healthSucceeded && !input.alreadyRetriedThisTab
  return {
    retry,
    banner: retry ? COLD_START_BANNER : '',
    timeoutMs: COLD_START_RETRY_TIMEOUT_MS,
  }
}

let banner = ''
const listeners = new Set<(message: string) => void>()

export function getColdStartBanner(): string {
  return banner
}

export function setColdStartBanner(message: string) {
  banner = message
  for (const listener of listeners) listener(message)
}

export function subscribeColdStartBanner(listener: (message: string) => void): () => void {
  listeners.add(listener)
  listener(banner)
  return () => {
    listeners.delete(listener)
  }
}
