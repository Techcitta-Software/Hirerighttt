import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getInterviewFinishJob,
  resetInterviewFinishJobForTests,
  retryInterviewFinishJob,
  startInterviewFinishJob,
  subscribeInterviewFinishJob,
} from './interviewFinishJob'

const meta = { role: 'Frontend Engineer', level: 'Mid', startedAt: '2026-11-19T10:00:00.000Z' }

describe('interviewFinishJob', () => {
  afterEach(() => resetInterviewFinishJobForTests())

  it('is pending until the background work finishes, then done', async () => {
    let release!: () => void
    const job = startInterviewFinishJob(meta, () => new Promise<void>((resolve) => (release = resolve)))
    expect(getInterviewFinishJob()).toBe(job)
    expect(job.status).toBe('pending')
    const seen: string[] = []
    subscribeInterviewFinishJob((j) => seen.push(j.status))
    release()
    await job.promise
    expect(job.status).toBe('done')
    expect(seen).toEqual(['done'])
  })

  it('records a failure without rejecting and can be retried', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('scoring offline')).mockResolvedValueOnce(undefined)
    const job = startInterviewFinishJob(meta, run)
    await expect(job.promise).resolves.toBeUndefined()
    expect(job.status).toBe('failed')
    expect(job.error).toBe('scoring offline')

    retryInterviewFinishJob()
    expect(job.status).toBe('pending')
    await job.promise
    expect(job.status).toBe('done')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('ignores retry unless the job failed', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const job = startInterviewFinishJob(meta, run)
    await job.promise
    retryInterviewFinishJob()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a newer job replaces an older one and the older one stops reporting', async () => {
    let releaseOld!: () => void
    const old = startInterviewFinishJob(meta, () => new Promise<void>((resolve) => (releaseOld = resolve)))
    const next = startInterviewFinishJob(meta, async () => {})
    await next.promise
    releaseOld()
    await old.promise
    expect(getInterviewFinishJob()).toBe(next)
    expect(old.status).toBe('pending')
  })
})
