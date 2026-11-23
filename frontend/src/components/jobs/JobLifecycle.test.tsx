import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmployerJob } from '../../lib/store'
import { isJobClosedError, JOB_CLOSED_MESSAGE, resolvePublicJob } from '../../lib/resolvePublicJob'
import { updateVendorJob, vendorJobStatus } from '../../lib/vendorApi'
import { JobLifecycleActions, JobStatusBadge } from './JobLifecycle'
import { jobEditPatch, jobStatusActions, splitSkills, validateJobEdit, type JobEditDraft } from './jobStatusRules'

const apiFetch = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const JOB: EmployerJob = {
  id: 'job-1',
  title: 'Backend Engineer',
  company: 'Acme',
  roleTrack: 'Software Engineer',
  experienceLevel: '3-5 years',
  location: 'Remote',
  jobDescription: 'Build Python services on PostgreSQL and ship them every week.',
  requiredSkills: ['Python', 'PostgreSQL'],
  createdByEmail: 'r@acme.test',
  createdAt: '2026-11-01T00:00:00Z',
  shareableCode: 'abc123',
  status: 'active',
}

const draft = (over: Partial<JobEditDraft> = {}): JobEditDraft => ({
  title: JOB.title,
  roleTrack: JOB.roleTrack,
  experienceLevel: JOB.experienceLevel,
  location: JOB.location,
  jobDescription: JOB.jobDescription,
  skills: JOB.requiredSkills.join(', '),
  ...over,
})

afterEach(() => apiFetch.mockReset())

describe('job status', () => {
  it('reads legacy "active" and missing status as published', () => {
    expect(vendorJobStatus({ status: 'active' })).toBe('published')
    expect(vendorJobStatus({})).toBe('published')
    expect(vendorJobStatus({ status: 'CLOSED' })).toBe('closed')
  })

  it('offers the moves the API allows', () => {
    expect(jobStatusActions('published').map((a) => a.key)).toEqual(['close', 'unpublish'])
    expect(jobStatusActions('closed').map((a) => a.to)).toEqual(['published'])
    expect(jobStatusActions('draft').map((a) => a.key)).toEqual(['publish'])
    expect(jobStatusActions('archived')).toEqual([])
  })

  it('shows a badge and the right buttons per status', () => {
    const open = renderToStaticMarkup(
      createElement(JobLifecycleActions, { job: JOB, onChanged: () => {}, onNotice: () => {} }),
    )
    expect(open).toContain('Edit')
    expect(open).toContain('Close job')
    expect(open).toContain('Unpublish')
    expect(open).not.toContain('Reopen')
    const closed = renderToStaticMarkup(
      createElement(JobLifecycleActions, { job: { ...JOB, status: 'closed' }, onChanged: () => {}, onNotice: () => {} }),
    )
    expect(closed).toContain('Reopen')
    expect(closed).not.toContain('Close job')
    expect(renderToStaticMarkup(createElement(JobStatusBadge, { status: 'closed' }))).toContain('Closed')
    expect(renderToStaticMarkup(createElement(JobStatusBadge, { status: 'draft' }))).toContain('Unpublished')
    expect(renderToStaticMarkup(createElement(JobStatusBadge, { status: 'active' }))).toContain('Accepting applications')
  })

  it('disables every action while the row is busy', () => {
    const html = renderToStaticMarkup(
      createElement(JobLifecycleActions, { job: JOB, disabled: true, onChanged: () => {}, onNotice: () => {} }),
    )
    expect(html.match(/disabled=""/g)?.length).toBe(3)
  })
})

describe('edit form', () => {
  it('validates with the API limits', () => {
    expect(validateJobEdit(draft())).toBe('')
    expect(validateJobEdit(draft({ title: ' ' }))).toMatch(/title/)
    expect(validateJobEdit(draft({ jobDescription: 'short' }))).toMatch(/30 characters/)
    expect(validateJobEdit(draft({ skills: ' , ' }))).toMatch(/skill/)
    expect(validateJobEdit(draft({ location: '' }))).toMatch(/location/)
  })

  it('sends only the fields that changed', () => {
    expect(jobEditPatch(JOB, draft())).toEqual({})
    expect(jobEditPatch(JOB, draft({ title: ' Staff Engineer ', skills: 'Python, Go, Python' }))).toEqual({
      title: 'Staff Engineer',
      requiredSkills: ['Python', 'Go'],
    })
    expect(splitSkills('a; b, ,c')).toEqual(['a', 'b', 'c'])
  })
})

describe('API client', () => {
  it('PATCHes the job and returns the saved copy', async () => {
    apiFetch.mockReturnValueOnce(respond(200, { job: { ...JOB, status: 'closed' }, changed: ['status'] }))
    const out = await updateVendorJob('job-1', { status: 'closed' })
    expect(apiFetch).toHaveBeenCalledWith('/api/vendor/jobs/job-1', { method: 'PATCH', body: '{"status":"closed"}' })
    expect(out.job.status).toBe('closed')
  })

  it('surfaces the API error (e.g. a 409 transition)', async () => {
    apiFetch.mockReturnValueOnce(respond(409, { error: 'A closed job cannot be moved to draft.' }))
    await expect(updateVendorJob('job-1', { status: 'draft' })).rejects.toThrow('cannot be moved')
  })
})

describe('closed share link (candidate side)', () => {
  it('stops at the 410 and reports the closed message', async () => {
    apiFetch.mockReturnValue(respond(410, { error: JOB_CLOSED_MESSAGE, code: 'JOB_CLOSED' }))
    const out = await resolvePublicJob('abc123', 'acme')
    expect(out.job).toBeNull()
    expect(isJobClosedError(out.error)).toBe(true)
    expect(apiFetch).toHaveBeenCalledTimes(1) // no second try without the company slug
  })

  it('keeps "not found" separate from "closed"', async () => {
    apiFetch.mockReturnValue(respond(404, { error: 'Job link not found or expired.' }))
    const out = await resolvePublicJob('nope')
    expect(isJobClosedError(out.error)).toBe(false)
  })
})
