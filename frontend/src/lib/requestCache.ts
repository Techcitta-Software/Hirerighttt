/**
 * Small shared cache for idempotent API reads that several components ask for at about the same time
 * (e.g. the candidate bell and the jobs page both loading /api/jobs on mount).
 * - Callers that ask while a request is in flight share it.
 * - A settled answer is reused for `ttlMs`; failures are never cached.
 * - Every caller gets its own copy, so one caller mutating the result cannot affect another.
 * - clearRequestCache() is called by api.ts on every write and on sign-in/out, so a read after a
 *   write always goes to the server.
 */
type Entry = {
  at: number
  ttlMs: number
  promise: Promise<unknown>
  settled: boolean
}

const entries = new Map<string, Entry>()
let generation = 0

function copy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

function freshEntry(key: string, now = Date.now()): Entry | null {
  const entry = entries.get(key)
  if (!entry) return null
  if (!entry.settled) return entry
  if (now - entry.at < entry.ttlMs) return entry
  entries.delete(key)
  return null
}

export function cachedRequest<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const existing = freshEntry(key)
  if (existing) return (existing.promise as Promise<T>).then(copy)

  const gen = generation
  const entry: Entry = { at: Date.now(), ttlMs, promise: Promise.resolve(), settled: false }
  entry.promise = load().then(
    (value) => {
      entry.settled = true
      entry.at = Date.now()
      // A write happened while this was loading: do not keep a possibly stale answer.
      if (gen !== generation && entries.get(key) === entry) entries.delete(key)
      return value
    },
    (err) => {
      if (entries.get(key) === entry) entries.delete(key)
      throw err
    },
  )
  entries.set(key, entry)
  return (entry.promise as Promise<T>).then(copy)
}

/** The in-flight or still-fresh answer for `key`, without starting a request. */
export function peekCachedRequest<T>(key: string): Promise<T> | null {
  const entry = freshEntry(key)
  return entry ? (entry.promise as Promise<T>).then(copy) : null
}

export function clearRequestCache(): void {
  generation += 1
  entries.clear()
}
