import { describe, expect, it } from 'vitest'
import {
  accountDeletionRequestPath,
  accountExportFileName,
  buildAccountExport,
  isVisibleToEmployers,
  profileVisibilityFor,
} from './candidatePrivacy'

describe('candidate privacy', () => {
  it('maps "Visible to employers" to the server profileVisibility', () => {
    expect(profileVisibilityFor(true)).toBe('marketplace')
    expect(profileVisibilityFor(false)).toBe('private')
    expect(isVisibleToEmployers({ profileVisibility: 'private' })).toBe(false)
    expect(isVisibleToEmployers({ profileVisibility: 'marketplace' })).toBe(true)
    expect(isVisibleToEmployers({ profileVisibility: 'organization_only' })).toBe(true)
    // Server default (talent_index): no value = marketplace.
    expect(isVisibleToEmployers({})).toBe(true)
    expect(isVisibleToEmployers(null)).toBe(true)
  })

  it('names the export after the account and the local date', () => {
    const local = new Date(2026, 10, 21, 0, 30)  // 21 Nov, 00:30 local: still 20 Nov in UTC east of Greenwich
    expect(accountExportFileName('Kavya.QA1@example.com', local)).toBe('hirerighttt-data-kavya-qa1-example-com-2026-11-21.json')
    expect(accountExportFileName(undefined, local)).toBe('hirerighttt-data-account-2026-11-21.json')
  })

  it('exports the account payload as readable JSON', () => {
    const json = buildAccountExport({ user: { email: 'a@example.com' }, applications: [] }, new Date('2026-11-21T00:00:00Z'))
    const parsed = JSON.parse(json)
    expect(parsed.user.email).toBe('a@example.com')
    expect(parsed.exportedAt).toBe('2026-11-21T00:00:00.000Z')
    expect(json).toContain('\n  ')
  })

  it('sends deletion requests to the contact form, prefilled', () => {
    const path = accountDeletionRequestPath('a@example.com')
    expect(path.startsWith('/contact?message=')).toBe(true)
    expect(decodeURIComponent(path.split('message=')[1])).toContain('delete my HireRighttt account (a@example.com)')
  })
})
