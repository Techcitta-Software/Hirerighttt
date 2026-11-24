import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedRequest, clearRequestCache, peekCachedRequest } from './requestCache'
import { createSharedPoller } from './sharedPoller'
import { mapWithConcurrency } from './concurrency'
import { routeChunkForPath } from '../routeImports'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('cachedRequest', () => {
  beforeEach(() => clearRequestCache())

  it('shares one in-flight request between callers', async () => {
    const d = deferred<{ jobs: number[] }>()
    const load = vi.fn(() => d.promise)
    const a = cachedRequest('/api/jobs', 5_000, load)
    const b = cachedRequest('/api/jobs', 5_000, load)
    d.resolve({ jobs: [1, 2] })
    expect(await a).toEqual({ jobs: [1, 2] })
    expect(await b).toEqual({ jobs: [1, 2] })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reuses a settled answer within the TTL and refetches after it', async () => {
    vi.useFakeTimers()
    try {
      const load = vi.fn(async () => ({ n: load.mock.calls.length }))
      await cachedRequest('k', 1_000, load)
      await cachedRequest('k', 1_000, load)
      expect(load).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1_001)
      await cachedRequest('k', 1_000, load)
      expect(load).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives every caller its own copy', async () => {
    const load = async () => ({ list: [1] })
    const a = await cachedRequest('copy', 5_000, load)
    a.list.push(2)
    const b = await cachedRequest('copy', 5_000, load)
    expect(b.list).toEqual([1])
  })

  it('never caches failures', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ ok: true })
    await expect(cachedRequest('fail', 5_000, load)).rejects.toThrow('down')
    await expect(cachedRequest('fail', 5_000, load)).resolves.toEqual({ ok: true })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('is cleared by clearRequestCache (writes, sign-in/out)', async () => {
    const load = vi.fn(async () => 1)
    await cachedRequest('clear', 5_000, load)
    clearRequestCache()
    expect(peekCachedRequest('clear')).toBeNull()
    await cachedRequest('clear', 5_000, load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('peek returns an in-flight request without starting one', async () => {
    expect(peekCachedRequest('peek')).toBeNull()
    const d = deferred<number>()
    void cachedRequest('peek', 5_000, () => d.promise)
    const peeked = peekCachedRequest<number>('peek')
    expect(peeked).not.toBeNull()
    d.resolve(7)
    expect(await peeked).toBe(7)
  })
})

describe('createSharedPoller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs one request for several subscribers and one interval for all of them', async () => {
    const load = vi.fn(async () => ['alert'])
    const poller = createSharedPoller(load, { intervalMs: 30_000, isHidden: () => false })
    const a = vi.fn()
    const b = vi.fn()
    const offA = poller.subscribe(a)
    const offB = poller.subscribe(b)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledWith(['alert'])
    expect(b).toHaveBeenCalledWith(['alert'])

    await vi.advanceTimersByTimeAsync(30_000)
    expect(load).toHaveBeenCalledTimes(2)
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(2)

    offA()
    offB()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('hands a late subscriber the recent answer without a new request', async () => {
    const load = vi.fn(async () => 1)
    const poller = createSharedPoller(load, { intervalMs: 30_000, reuseMs: 10_000, isHidden: () => false })
    const off1 = poller.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    const late = vi.fn()
    const off2 = poller.subscribe(late)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    expect(late).toHaveBeenCalledWith(1)
    off1()
    off2()
  })

  it('skips polls while the tab is hidden', async () => {
    let hidden = false
    const load = vi.fn(async () => 1)
    const poller = createSharedPoller(load, { intervalMs: 1_000, isHidden: () => hidden })
    const off = poller.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    hidden = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(load).toHaveBeenCalledTimes(1)
    hidden = false
    await vi.advanceTimersByTimeAsync(1_000)
    expect(load).toHaveBeenCalledTimes(2)
    off()
  })

  it('marks only the first request as foreground', async () => {
    const seen: boolean[] = []
    const poller = createSharedPoller(
      async ({ background }) => {
        seen.push(background)
        return 1
      },
      { intervalMs: 1_000, isHidden: () => false },
    )
    const off = poller.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(2_000)
    expect(seen).toEqual([false, true, true])
    off()
  })

  it('reset drops the previous answer (account switch)', async () => {
    const load = vi.fn(async () => load.mock.calls.length)
    const poller = createSharedPoller(load, { intervalMs: 30_000, isHidden: () => false })
    const off1 = poller.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    off1()
    poller.reset()
    const next = vi.fn()
    const off2 = poller.subscribe(next)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)
    expect(next).toHaveBeenCalledWith(2)
    off2()
  })
})

describe('mapWithConcurrency', () => {
  it('never runs more than the limit at once and visits every item', async () => {
    let running = 0
    let peak = 0
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 1))
      seen.push(n)
      running -= 1
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('handles an empty list', async () => {
    const worker = vi.fn(async () => {})
    await mapWithConcurrency([], 4, worker)
    expect(worker).not.toHaveBeenCalled()
  })
})

describe('routeChunkForPath', () => {
  it('maps app pages to the chunk that serves them', () => {
    expect(routeChunkForPath('/dashboard')).toBe('appPages')
    expect(routeChunkForPath('/dashboard/report')).toBe('appPages')
    expect(routeChunkForPath('/jobs')).toBe('appPages')
    expect(routeChunkForPath('/jobs/acme/abc')).toBe('jobInvite')
    expect(routeChunkForPath('/employer/dashboard')).toBe('vendorDashboard')
    expect(routeChunkForPath('/employer/candidates')).toBe('resumes')
    expect(routeChunkForPath('/employer/applicants')).toBe('employer')
    expect(routeChunkForPath('/resumes')).toBe('resumes')
    expect(routeChunkForPath('/interview/invite/tok')).toBe('interviewInvite')
    expect(routeChunkForPath('/')).toBe('home')
    expect(routeChunkForPath('/login/')).toBe('auth')
    expect(routeChunkForPath('/nope')).toBeNull()
  })
})
