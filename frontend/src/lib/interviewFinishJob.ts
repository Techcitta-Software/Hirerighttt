/**
 * Background work that runs after the candidate leaves the interview room (scoring the answers and saving the
 * report). The interview page starts it and navigates straight to the completion page, which waits on it.
 *
 * Kept at module level so it survives the route change; a full page reload drops it (the completion page then
 * falls back to whatever result is already stored).
 */

export type InterviewFinishMeta = {
  role: string
  level: string
  startedAt: string
}

export type InterviewFinishStatus = 'pending' | 'done' | 'failed'

export type InterviewFinishJob = {
  meta: InterviewFinishMeta
  status: InterviewFinishStatus
  error: string
  /** Settles when the current attempt finishes; never rejects. */
  promise: Promise<void>
}

type Listener = (job: InterviewFinishJob) => void

let current: InterviewFinishJob | null = null
let currentRun: (() => Promise<void>) | null = null
const listeners = new Set<Listener>()

function notify(job: InterviewFinishJob) {
  for (const listener of listeners) listener(job)
}

function attempt(job: InterviewFinishJob, run: () => Promise<void>): Promise<void> {
  return run().then(
    () => {
      if (current !== job) return
      job.status = 'done'
      job.error = ''
      notify(job)
    },
    (err: unknown) => {
      if (current !== job) return
      console.warn('[interviewFinishJob] background finish failed', err)
      job.status = 'failed'
      job.error = err instanceof Error && err.message ? err.message : 'We could not score this interview.'
      notify(job)
    },
  )
}

export function startInterviewFinishJob(meta: InterviewFinishMeta, run: () => Promise<void>): InterviewFinishJob {
  const job: InterviewFinishJob = { meta, status: 'pending', error: '', promise: Promise.resolve() }
  current = job
  currentRun = run
  job.promise = attempt(job, run)
  return job
}

/** Re-runs the last job after a failure. No-op while it is pending or once it is done. */
export function retryInterviewFinishJob(): void {
  const job = current
  const run = currentRun
  if (!job || !run || job.status !== 'failed') return
  job.status = 'pending'
  job.error = ''
  notify(job)
  job.promise = attempt(job, run)
}

export function getInterviewFinishJob(): InterviewFinishJob | null {
  return current
}

export function subscribeInterviewFinishJob(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test helper. */
export function resetInterviewFinishJobForTests(): void {
  current = null
  currentRun = null
  listeners.clear()
}
