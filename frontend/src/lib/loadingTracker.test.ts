import { describe, expect, it } from 'vitest'
import { holdLoading, isQuietRequest, subscribePending, trackRequest } from './loadingTracker'

describe('loading tracker', () => {
  it('ignores background traffic', () => {
    for (const path of [
      '/api/health',
      '/api/me',
      '/api/vendor/application-alerts',
      '/api/interview-invites/abc123',
      '/api/interview/review-events',
      '/api/interview/integrity',
    ]) {
      expect(isQuietRequest(path)).toBe(true)
    }
  })

  it('counts requests the user is waiting on', () => {
    for (const path of ['/api/vendor/jobs', '/api/jobs?scope=all', '/api/profile', '/api/interview/start', '/api/interview-invites/abc/reschedule']) {
      expect(isQuietRequest(path)).toBe(false)
    }
  })

  it('tracks pending requests and settles each once', () => {
    const seen: number[] = []
    const stop = subscribePending((n) => seen.push(n))
    const a = trackRequest('/api/vendor/jobs')
    const b = trackRequest('/api/jobs')
    const quiet = trackRequest('/api/health')
    a()
    a()
    b()
    quiet()
    stop()
    expect(seen).toEqual([0, 1, 2, 1, 0])
  })

  it('lets a page hold the loader and releases it once', () => {
    const seen: number[] = []
    const stop = subscribePending((n) => seen.push(n))
    const release = holdLoading()
    release()
    release()
    stop()
    expect(seen).toEqual([0, 1, 0])
  })
})
