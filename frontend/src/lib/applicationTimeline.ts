import type { ApiApplication, ApiApplicationTimelineStep } from './api'

export type ApplicationTimelineStep = ApiApplicationTimelineStep

const STEPS: { key: string; label: string }[] = [
  { key: 'applied', label: 'Applied' },
  { key: 'in-review', label: 'In review' },
  { key: 'selected', label: 'Selected' },
  { key: 'not-selected', label: 'Not selected' },
]

/**
 * Which of the four steps is current.
 * Selected and Not selected are alternate endings: one never completes the other.
 * Interview is the older in-progress value and stays on In review.
 * Offer is a positive outcome and lands on Selected.
 */
function currentStepKey(status: string | null | undefined): string {
  switch ((status || '').trim()) {
    case 'In Review':
    case 'Interview':
      return 'in-review'
    case 'Selected':
    case 'Offer':
      return 'selected'
    case 'Not selected':
      return 'not-selected'
    default:
      return 'applied'
  }
}

/** The four progress steps when the API did not send a timeline. */
export function timelineFromStatus(status: string | null | undefined): ApplicationTimelineStep[] {
  const current = currentStepKey(status)
  const passedReview = current === 'selected' || current === 'not-selected'
  return STEPS.map((step) => {
    if (step.key === 'selected' || step.key === 'not-selected') {
      return { key: step.key, label: step.label, done: false, current: step.key === current }
    }
    const done = step.key === 'applied' ? current !== 'applied' : passedReview
    return { key: step.key, label: step.label, done, current: step.key === current }
  })
}

function usableTimeline(steps: ApiApplicationTimelineStep[] | null | undefined): ApplicationTimelineStep[] | null {
  if (!Array.isArray(steps) || steps.length === 0) return null
  const usable = steps.every(
    (step) => step && typeof step.key === 'string' && step.key && typeof step.label === 'string' && step.label,
  )
  if (!usable) return null
  return steps.map((step) => ({
    key: step.key,
    label: step.label,
    done: Boolean(step.done),
    current: Boolean(step.current),
  }))
}

/**
 * Steps to render for one application.
 * A removed job returns null so the page shows the removed message and does not invent progress.
 */
export function applicationTimeline(
  app: Pick<ApiApplication, 'status' | 'jobStatus' | 'timeline'>,
): ApplicationTimelineStep[] | null {
  if (app.jobStatus === 'deleted') return null
  return usableTimeline(app.timeline) ?? timelineFromStatus(app.status)
}
