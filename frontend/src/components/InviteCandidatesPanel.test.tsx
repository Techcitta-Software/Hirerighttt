import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InviteCandidatesPanel } from './InviteCandidatesPanel'

const JOBS = [
  { id: 'be', title: 'Backend Platform Engineer' },
  { id: 'fe', title: 'Senior Frontend Engineer' },
]

describe('InviteCandidatesPanel', () => {
  it('opened from a job page, has that job chosen as the role', () => {
    const html = renderToStaticMarkup(createElement(InviteCandidatesPanel, { jobs: JOBS, embedded: true, defaultJobId: 'be' }))
    expect(html).toMatch(/<option value="be" selected="">Backend Platform Engineer<\/option>/)
  })

  it('defaults to a general interview without a job, or with an unknown job', () => {
    for (const defaultJobId of [undefined, 'gone']) {
      const html = renderToStaticMarkup(createElement(InviteCandidatesPanel, { jobs: JOBS, embedded: true, defaultJobId }))
      expect(html).toMatch(/<option value="" selected="">/)
    }
  })
})
