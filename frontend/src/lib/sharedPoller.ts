/**
 * One poller shared by every component that wants the same server data on an interval
 * (e.g. the employer notification bell and the employer dashboard both watch application alerts).
 * Instead of each component running its own timer and request, they subscribe here:
 * - the first subscriber starts one interval; the last one to leave stops it;
 * - a subscriber that joins while a request is in flight shares it, and one that joins shortly after
 *   a poll gets that answer straight away instead of a new request;
 * - polls are skipped while the tab is hidden and caught up when it becomes visible again.
 */
export type SharedPoller<T> = {
  /** Calls `listener` with every fresh result. Returns the unsubscribe function. */
  subscribe(listener: (value: T) => void): () => void
  /** Polls now (sharing an in-flight request) and notifies every subscriber. */
  refresh(): Promise<T | undefined>
  /** Drops the cached result (e.g. after sign-out). */
  reset(): void
}

type PollerOptions = {
  intervalMs: number
  /** A result younger than this is handed to a new subscriber without a new request. */
  reuseMs?: number
  isHidden?: () => boolean
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function createSharedPoller<T>(
  load: (ctx: { background: boolean }) => Promise<T>,
  { intervalMs, reuseMs = Math.min(intervalMs, 10_000), isHidden = documentHidden }: PollerOptions,
): SharedPoller<T> {
  const listeners = new Set<(value: T) => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<T | undefined> | null = null
  let last: { at: number; value: T } | null = null
  let polls = 0
  let generation = 0

  function notify(value: T) {
    for (const listener of [...listeners]) {
      try {
        listener(value)
      } catch {
        /* one listener must not break the others */
      }
    }
  }

  function refresh(): Promise<T | undefined> {
    if (inFlight) return inFlight
    const gen = generation
    // Only the very first request may raise the loading veil; interval polls run in the background.
    const background = polls > 0
    polls += 1
    inFlight = load({ background })
      .then((value) => {
        if (gen !== generation) return undefined
        last = { at: Date.now(), value }
        notify(value)
        return value
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  function tick() {
    if (isHidden()) return
    void refresh()
  }

  function onVisibility() {
    if (isHidden() || !listeners.size) return
    if (!last || Date.now() - last.at >= intervalMs) void refresh()
  }

  function start() {
    if (timer) return
    timer = setInterval(tick, intervalMs)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      start()
      if (last && Date.now() - last.at < reuseMs) {
        const value = last.value
        queueMicrotask(() => {
          if (listeners.has(listener)) listener(value)
        })
      } else {
        // Joins an in-flight request when there is one; its result reaches this listener too.
        void refresh()
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) stop()
      }
    },
    refresh,
    reset() {
      generation += 1
      last = null
      inFlight = null
      polls = 0
    },
  }
}
