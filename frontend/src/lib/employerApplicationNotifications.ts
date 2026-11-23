import type { EmployerApplicationAlert } from './vendorApi'
import { addNotification, getUser } from './store'

const BASELINE_SUFFIX = 'hireright.employerAppAlertBaseline'
const SYNCED_IDS_SUFFIX = 'hireright.employerAppAlertSynced'
/** Unread applications this recent are shown on a browser's first sign-in. */
const RECENT_ALERT_MS = 7 * 24 * 60 * 60 * 1000

function baselineKey(email: string) {
  return `${BASELINE_SUFFIX}.${email}`
}

function syncedIdsKey(email: string) {
  return `${SYNCED_IDS_SUFFIX}.${email}`
}

function loadSyncedIds(email: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(syncedIdsKey(email)) || '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveSyncedIds(email: string, ids: Set<string>) {
  localStorage.setItem(syncedIdsKey(email), JSON.stringify([...ids].slice(-400)))
}

/** Push unread employer application alerts into the nav bell inbox (same pattern as job-match). */
export function syncEmployerApplicationNotifications(alerts: EmployerApplicationAlert[]) {
  const user = getUser()
  const email = user?.email?.toLowerCase()
  if (!email || user?.role !== 'employer') return

  const synced = loadSyncedIds(email)

  if (!localStorage.getItem(baselineKey(email))) {
    // First sign-in on this browser: only old alerts are skipped. Unread applications from the last week still
    // reach the bell (before, a new device showed "You're all caught up" over 24 unread applications).
    const cutoff = Date.now() - RECENT_ALERT_MS
    for (const alert of alerts) {
      const at = Date.parse(alert.createdAt || '')
      if (alert.id && !(Number.isFinite(at) && at >= cutoff)) synced.add(alert.id)
    }
    saveSyncedIds(email, synced)
    localStorage.setItem(baselineKey(email), new Date().toISOString())
  }

  let changed = false
  for (const alert of alerts) {
    if (!alert.id || alert.read || synced.has(alert.id)) continue
    synced.add(alert.id)
    changed = true

    const extras: string[] = []
    if (alert.hasInterviewReport) extras.push('HireRighttt report ready')
    if (alert.hasResume) extras.push('Resume attached')

    addNotification(
      {
        kind: 'application',
        alertId: alert.id,
        jobId: alert.jobId,
        title: 'New application',
        body: `${alert.candidateName} applied for ${alert.jobTitle}.${extras.length ? ` ${extras.join(' · ')}.` : ''}`,
        href: `/employer/jobs?jobId=${encodeURIComponent(alert.jobId)}`,
        createdAt: alert.createdAt,
      },
      email,
    )
  }

  if (changed) saveSyncedIds(email, synced)
}

export function rememberEmployerApplicationAlertIds(alertIds: string[]) {
  const email = getUser()?.email?.toLowerCase()
  if (!email || !alertIds.length || getUser()?.role !== 'employer') return
  const synced = loadSyncedIds(email)
  for (const id of alertIds) {
    if (id) synced.add(id)
  }
  saveSyncedIds(email, synced)
  if (!localStorage.getItem(baselineKey(email))) {
    localStorage.setItem(baselineKey(email), new Date().toISOString())
  }
}
