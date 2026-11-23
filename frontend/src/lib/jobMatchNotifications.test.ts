import { describe, expect, it } from 'vitest'
import { isForYouJobNotification } from './jobMatchNotifications'

describe('jobMatchNotifications', () => {
  it('candidate bell lists only job_match rows with a job id', () => {
    expect(
      isForYouJobNotification({
        id: 'a',
        kind: 'job_match',
        jobId: 'job-1',
        title: 'T',
        body: 'B',
        read: false,
        createdAt: new Date().toISOString(),
      }),
    ).toBe(true)
    expect(
      isForYouJobNotification({
        id: 'b',
        kind: 'application',
        title: 'Applied',
        body: 'B',
        read: false,
        createdAt: new Date().toISOString(),
      }),
    ).toBe(false)
    expect(
      isForYouJobNotification({
        id: 'c',
        kind: 'status',
        title: 'Status',
        body: 'B',
        read: false,
        createdAt: new Date().toISOString(),
      }),
    ).toBe(false)
    expect(
      isForYouJobNotification({
        id: 'd',
        kind: 'job_match',
        jobId: '  ',
        title: 'T',
        body: 'B',
        read: false,
        createdAt: new Date().toISOString(),
      }),
    ).toBe(false)
  })
})