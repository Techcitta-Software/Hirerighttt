import { describe, expect, it } from 'vitest'
import { applicationTimeline, timelineFromStatus } from './applicationTimeline'

function step(steps: { key: string; label: string; done: boolean; current: boolean }[], label: string) {
  const found = steps.find((item) => item.label === label)
  if (!found) throw new Error(`Missing step ${label}`)
  return found
}

describe('application timeline', () => {
  it('marks Selected as the current step', () => {
    const steps = timelineFromStatus('Selected')
    expect(steps.map((item) => item.label)).toEqual(['Applied', 'In review', 'Selected', 'Not selected'])
    expect(step(steps, 'Selected').current).toBe(true)
    expect(steps.filter((item) => item.current).map((item) => item.label)).toEqual(['Selected'])
    expect(step(steps, 'Applied').done).toBe(true)
    expect(step(steps, 'In review').done).toBe(true)
    expect(step(steps, 'Not selected').done).toBe(false)
    expect(step(steps, 'Not selected').current).toBe(false)
  })

  it('does not mark Selected done when the status is Not selected', () => {
    const steps = applicationTimeline({ status: 'Not selected', jobStatus: 'active' })
    expect(steps).not.toBeNull()
    expect(step(steps!, 'Not selected').current).toBe(true)
    expect(step(steps!, 'Selected').done).toBe(false)
    expect(step(steps!, 'Selected').current).toBe(false)
    expect(step(steps!, 'Applied').done).toBe(true)
    expect(step(steps!, 'In review').done).toBe(true)
  })

  it('does not invent progress for a removed job', () => {
    expect(
      applicationTimeline({
        status: 'Selected',
        jobStatus: 'deleted',
        timeline: [{ key: 'applied', label: 'Applied', done: true, current: true }],
      }),
    ).toBeNull()
  })
})
