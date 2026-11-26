/**
 * Words candidates see when something goes wrong in the interview. Never developer text (env var names, "Gemini",
 * "Failed to fetch"): say what happened in plain words and what happens next.
 */

export const START_FAILED_MESSAGE = 'We couldn’t start your interview right now — please try again in a minute.'
export const OFFLINE_START_MESSAGE = 'You’re offline. Check your internet connection, then try again.'
export const OFFLINE_ANSWER_MESSAGE = 'You’re offline — your answer will be sent when you reconnect.'
export const ANSWER_SAVED_MESSAGE = 'You’re back online — your answer was saved.'
export const OFFLINE_SYNC_MESSAGE = 'You’re offline — we’ll keep saving your interview as soon as you reconnect.'
export const SYNC_RETRY_MESSAGE = 'We couldn’t save your progress just now. We’ll keep trying automatically.'
export const PREPARING_QUESTIONS_MESSAGE = 'Preparing your questions…'
/** Show PREPARING_QUESTIONS_MESSAGE when starting takes longer than this. */
export const PREPARING_AFTER_MS = 3_000

const DEVELOPER_TEXT_RE =
  /GEMINI|GOOGLE_API|VITE_|API[_ ]?KEY|\bLLM\b|Gemini|client LLM|Traceback|Exception|\bstack\b|undefined|null is not|status \d{3}|\b5\d\d\b/i
const NETWORK_ERROR_RE = /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|offline/i

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function isNetworkError(err: unknown): boolean {
  if (isOffline()) return true
  const message = err instanceof Error ? err.message : String(err ?? '')
  return NETWORK_ERROR_RE.test(message)
}

/** The lobby message when "Enter interview room" failed. Friendly text from our own code passes through. */
export function candidateStartErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return OFFLINE_START_MESSAGE
  const e = err as { code?: string; name?: string; message?: string } | null
  if (e?.name === 'InterviewLlmError' || /^LLM_/.test(String(e?.code || ''))) return START_FAILED_MESSAGE
  const message = String(e?.message || '').trim()
  if (!message || DEVELOPER_TEXT_RE.test(message)) return START_FAILED_MESSAGE
  return message
}

/** The in-room banner when the background save of the interview log failed (was the raw "Failed to fetch"). */
export function candidateSyncErrorMessage(err: unknown): string {
  return isNetworkError(err) ? OFFLINE_SYNC_MESSAGE : SYNC_RETRY_MESSAGE
}

/** Resolves when the browser is online again (immediately if it already is). */
export function waitForOnline(target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window !== 'undefined' ? window : null): Promise<void> {
  if (!isOffline() || !target) return Promise.resolve()
  return new Promise((resolve) => {
    const on = () => {
      target.removeEventListener('online', on)
      resolve()
    }
    target.addEventListener('online', on)
  })
}

/**
 * Runs `send` (e.g. saving the answer and loading the next question). On a network failure it tells the candidate
 * (onOffline), waits until the browser is back online, and retries — so the answer is queued, not lost. onSaved
 * fires when a send succeeded after at least one failure. Non-network errors are thrown as before.
 */
export async function sendWithReconnect<T>(
  send: () => Promise<T>,
  hooks: {
    onOffline?: () => void
    onSaved?: () => void
    waitOnline?: () => Promise<void>
    retryDelayMs?: number
    maxAttempts?: number
    /** Stop retrying (the candidate left, the interview ended). */
    cancelled?: () => boolean
  } = {},
): Promise<T> {
  const maxAttempts = hooks.maxAttempts ?? 20
  const waitOnline = hooks.waitOnline ?? (() => waitForOnline())
  let failed = false
  for (let attempt = 1; ; attempt++) {
    try {
      const out = await send()
      if (failed) hooks.onSaved?.()
      return out
    } catch (err) {
      if (!isNetworkError(err) || attempt >= maxAttempts || hooks.cancelled?.()) throw err
      if (!failed) hooks.onOffline?.()
      failed = true
      await waitOnline()
      await new Promise((r) => setTimeout(r, hooks.retryDelayMs ?? 1_500))
      if (hooks.cancelled?.()) throw err
    }
  }
}
