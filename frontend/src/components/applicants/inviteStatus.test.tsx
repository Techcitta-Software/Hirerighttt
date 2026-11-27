import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { indexApplicant } from '../../lib/applicantSearch'
import type { EmployerApplicant } from '../../lib/store'
import type { InviteStatus } from '../../lib/vendorApi'
import { ApplicantResumePanel } from './ApplicantResumePanel'
import { ApplicantsSearch } from './ApplicantsSearch'
import { ApplicantTuple } from './ApplicantTuple'
import { InviteApplicantDialog } from './InviteApplicantDialog'
import { defaultSlot, slotError } from './inviteSlot'
import { indexInvites, inviteStatusText } from './inviteStatus'

const NOW = Date.parse('2026-11-26T04:30:00Z')

function inv(over: Partial<InviteStatus>): InviteStatus {
  return {
    token: 't1',
    inviteUrl: 'https://app.example.test/interview/invite/t1',
    candidateEmail: 'rohit@example.com',
    candidateName: 'Rohit Verma',
    jobId: 'job-fe',
    applicationId: null,
    jobTitle: 'Frontend Engineer',
    openLink: true,
    scheduledStart: '2026-11-26T04:29:00Z',
    scheduledEnd: '2026-12-03T04:29:00Z',
    createdAt: '2026-11-26T04:29:00Z',
    emailSentAt: null,
    openedAt: null,
    state: 'sent',
    stateLabel: 'Invite sent',
    reminder: null,
    reminderDue: false,
    ...over,
  }
}

function app(over: Partial<EmployerApplicant>): EmployerApplicant {
  return {
    id: 'rohit',
    jobId: 'job-fe',
    jobTitle: 'Frontend Engineer',
    company: 'Acme',
    candidateName: 'Rohit Verma',
    candidateEmail: 'rohit@example.com',
    experienceYears: '4 years',
    resumeName: 'cv.pdf',
    resumeText: 'SKILLS\nReact, TypeScript',
    appliedAt: '2026-11-25T10:00:00Z',
    status: 'New',
    recordSource: 'application',
    ...over,
  }
}

function tuple(a: EmployerApplicant, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(ApplicantTuple, {
      row: indexApplicant(a),
      terms: [],
      selected: false,
      active: false,
      now: NOW,
      onToggleSelect: () => {},
      onAction: () => {},
      ...extra,
    }),
  )
}

describe('invite status text', () => {
  it('names each state, with the booked time and a due reminder', () => {
    expect(inviteStatusText(inv({ state: 'sent' }))).toBe('Invite sent')
    expect(inviteStatusText(inv({ state: 'opened' }))).toBe('Link opened')
    expect(inviteStatusText(inv({ state: 'started' }))).toBe('Interview started')
    expect(inviteStatusText(inv({ state: 'completed' }))).toBe('Interview completed')
    expect(inviteStatusText(inv({ state: 'expired' }))).toBe('Invite expired')
    const booked = inviteStatusText(inv({ state: 'booked', scheduledStart: '2026-11-27T04:30:00Z', reminderDue: true }))
    expect(booked).toMatch(/^Booked for .*27 Nov.* · reminder due$/)
  })

  it('matches an invite to its application, else to the same e-mail and job; lists the rest as pending', () => {
    const byApp = inv({ token: 'a', applicationId: 'rohit', state: 'booked' })
    const byMail = inv({ token: 'b', candidateEmail: 'ananya@example.com', state: 'opened' })
    const pending = inv({ token: 'c', candidateEmail: 'sneha@example.com' })
    const index = indexInvites([byApp, byMail, pending])
    expect(index.forApplicant(app({}))?.token).toBe('a')
    expect(index.forApplicant(app({ id: 'ana', candidateEmail: 'Ananya@example.com' }))?.token).toBe('b')
    expect(index.forApplicant(app({ id: 'x', candidateEmail: 'nobody@example.com' }))).toBeNull()
    expect(index.unmatched([app({}), app({ id: 'ana', candidateEmail: 'ananya@example.com' })]).map((i) => i.token)).toEqual(['c'])
  })

  it('knows an interview is running from the live sessions or a started invite', () => {
    const live = indexInvites([], [{ applicationId: 'rohit', candidateEmail: 'rohit@example.com', jobId: 'job-fe', startedAt: null }])
    expect(live.inProgress(app({}))).toBe(true)
    expect(live.inProgress(app({ id: 'other', candidateEmail: 'other@example.com' }))).toBe(false)
    expect(indexInvites([inv({ applicationId: 'rohit', state: 'started' })]).inProgress(app({}))).toBe(true)
  })
})

describe('applicant row', () => {
  it('says "Interview in progress" instead of "Not interviewed" while the interview runs', () => {
    expect(tuple(app({}))).toContain('Not interviewed')
    const live = tuple(app({}), { inProgress: true })
    expect(live).toContain('Interview in progress')
    expect(live).not.toContain('Not interviewed')
  })

  it('says "In progress" when interviewSessionStatus is active', () => {
    const html = tuple(app({ interviewSessionStatus: 'active' }))
    expect(html).toMatch(/>\s*In progress\s*</)
    expect(html).not.toContain('Not interviewed')
    expect(html).not.toContain('Interview in progress')
  })

  it('shows the invite state on the row', () => {
    const html = tuple(app({}), { invite: inv({ applicationId: 'rohit', state: 'booked', scheduledStart: '2026-11-27T04:30:00Z' }) })
    expect(html).toContain('data-testid="invite-status"')
    expect(html).toMatch(/Booked for .*27 Nov/)
  })

  it('ranks the only interviewed applicant "#1 of 1" instead of "—"', () => {
    const html = tuple(app({ aiScore: 49, rank: 1 }), { rankTotal: 1 })
    expect(html).toContain('#1 of 1')
  })
})

describe('applicant panel', () => {
  it('shows the invite state and the link as copyable text', () => {
    const noop = () => {}
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(ApplicantResumePanel, {
        row: indexApplicant(app({ aiScore: 49, rank: 1 })),
        terms: [],
        position: { index: 0, total: 1 },
        tab: 'profile',
        onTab: noop,
        rankTotal: 1,
        onClose: noop,
        onShortlist: noop,
        onInvite: noop,
        onDownload: noop,
        onOpenFullReport: noop,
        now: NOW,
        invite: inv({ state: 'opened' }),
      })),
    )
    expect(html).toContain('Link opened')
    expect(html).toContain('value="https://app.example.test/interview/invite/t1"')
    expect(html).toContain('Copy link')
    expect(html).toContain('Rank #1 of 1')
  })
})

describe('invite dialog (row / profile "Invite")', () => {
  it('offers an open link or a date and time slot', () => {
    const html = renderToStaticMarkup(
      createElement(InviteApplicantDialog, { candidateName: 'Rohit Verma', onSubmit: () => {}, onClose: () => {}, now: NOW }),
    )
    expect(html).toContain('Invite Rohit Verma to interview')
    expect(html).toContain('Open link')
    expect(html).toContain('Pick a date and time')
    expect(html).toContain('role="dialog"')
  })

  it('refuses a slot in the past or too soon and proposes a later whole hour', () => {
    expect(slotError('', NOW)).toMatch(/Choose/)
    expect(slotError(new Date(NOW + 5 * 60_000).toISOString(), NOW)).toMatch(/15 minutes/)
    expect(slotError(new Date(NOW + 2 * 3_600_000).toISOString(), NOW)).toBe('')
    const slot = new Date(defaultSlot(NOW)).getTime()
    expect(slot - NOW).toBeGreaterThanOrEqual(60 * 60_000)
    expect(new Date(slot).getMinutes()).toBe(0)
  })
})

describe('CSV export', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      length: 0,
    })
  })

  it('has an Export CSV button in the toolbar', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ['/employer/applicants'] }, createElement(ApplicantsSearch, {
        mode: 'applications',
        applicants: [app({})],
        jobs: [{ id: 'job-fe', title: 'Frontend Engineer' }],
        loading: false,
        onRetry: () => {},
        loadRanking: false,
        loadInviteStatus: false,
        now: NOW,
      })),
    )
    expect(html).toMatch(/<button[^>]*>.*?Export CSV<\/button>/)
  })

  it('wires Export CSV into the bulk bar for the selected rows', () => {
    const src = readFileSync(join(__dirname, 'ApplicantsSearch.tsx'), 'utf8')
    const bulk = src.slice(src.indexOf('aria-label="Bulk actions"'), src.indexOf('Clear selection'))
    expect(bulk).toContain('actions.exportCsv(selectedRows, now)')
    expect(bulk).toContain('Export CSV')
  })
})
