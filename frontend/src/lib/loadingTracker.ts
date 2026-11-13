/**
 * Counts API requests the user is waiting on, so one global indicator can show during slow loads.
 * Background traffic (polling, health checks, in-interview telemetry) is ignored — it should never flash
 * a loader at someone who is not waiting for anything.
 */
type Listener = (pending: number) => void

const QUIET_PATHS: RegExp[] = [
  /^\/api\/health/,
  /^\/api\/me$/,
  /^\/api\/llm-status/,
  /^\/api\/mail\/status/,
  /application-alerts/,
  /job-alerts/,
  /^\/api\/interview-invites\/[^/]+$/, // invite page refreshes every 15s
  /^\/api\/interview\/(review-events|integrity|transcribe|turn|interact|recordings|artifacts|tts)/,
  /^\/api\/resolve-cache\//,
]

let pending = 0
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(pending)
}

export function isQuietRequest(path: string): boolean {
  const p = path.split('?')[0]
  return QUIET_PATHS.some((re) => re.test(p))
}

/** Call when a request starts; call the returned function once when it settles. */
export function trackRequest(path: string): () => void {
  if (isQuietRequest(path)) return () => undefined
  pending += 1
  emit()
  let done = false
  return () => {
    if (done) return
    done = true
    pending = Math.max(0, pending - 1)
    emit()
  }
}

/** Keeps the loader up while a page waits on something other than one apiFetch call; returns the release. */
export function holdLoading(): () => void {
  pending += 1
  emit()
  let done = false
  return () => {
    if (done) return
    done = true
    pending = Math.max(0, pending - 1)
    emit()
  }
}

export function subscribePending(listener: Listener): () => void {
  listeners.add(listener)
  listener(pending)
  return () => {
    listeners.delete(listener)
  }
}
