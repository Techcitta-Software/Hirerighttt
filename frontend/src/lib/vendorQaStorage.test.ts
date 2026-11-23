/** Vendor QA regressions that touch browser storage: the nav bell on a new browser, and the talent vault cache. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmployerApplicationAlert } from './vendorApi'

function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
}

const added: { alertId?: string }[] = []
vi.mock('./store', () => ({
  getUser: () => ({ email: 'rec@org.test', role: 'employer' }),
  addNotification: (n: { alertId?: string }) => added.push(n),
}))

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  added.length = 0
})
afterEach(() => vi.unstubAllGlobals())

const alert = (id: string, daysAgo: number): EmployerApplicationAlert => ({
  id,
  applicationId: id,
  jobId: 'j1',
  jobTitle: 'Frontend',
  candidateName: 'Kavya',
  candidateEmail: 'k@x.test',
  hasInterviewReport: false,
  hasResume: true,
  createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  read: false,
})

describe('employer bell on a browser it has never seen', () => {
  it('shows unread applications from the last week instead of "all caught up"', async () => {
    const { syncEmployerApplicationNotifications } = await import('./employerApplicationNotifications')
    syncEmployerApplicationNotifications([alert('new1', 1), alert('new2', 3), alert('old', 30)])
    expect(added.map((n) => n.alertId).sort()).toEqual(['new1', 'new2'])
    // The next poll does not add them twice.
    syncEmployerApplicationNotifications([alert('new1', 1), alert('new2', 3), alert('old', 30)])
    expect(added).toHaveLength(2)
  })
})
