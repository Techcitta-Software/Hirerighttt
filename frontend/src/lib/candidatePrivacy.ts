/**
 * Candidate privacy controls that used to be local-only checkboxes:
 * - "Visible to employers" is the server-side profile.profileVisibility ('marketplace' | 'private'), which the
 *   talent search honours (backend db/talent_index.py).
 * - "Download my data" exports what the account API returns (account, profile, interview, applications).
 */
import { apiMe, apiSaveProfile } from './api'
import { ensureApiSession } from './apiSession'
import { getUser, profileKey } from './store'

export type ProfileVisibility = 'marketplace' | 'organization_only' | 'private'

export function isVisibleToEmployers(profile: unknown): boolean {
  const value = (profile as { profileVisibility?: unknown } | null | undefined)?.profileVisibility
  return value !== 'private'
}

export function profileVisibilityFor(visible: boolean): ProfileVisibility {
  return visible ? 'marketplace' : 'private'
}

/** Saves the visibility on the server and mirrors the returned profile locally. */
export async function saveProfileVisibility(visible: boolean): Promise<Record<string, unknown>> {
  if (!(await ensureApiSession())) throw new Error('Sign in again to change your privacy settings.')
  const saved = (await apiSaveProfile({ profileVisibility: profileVisibilityFor(visible) })) as {
    profile?: Record<string, unknown>
  }
  const profile = saved?.profile ?? {}
  const email = getUser()?.email
  if (email) {
    try {
      localStorage.setItem(profileKey(email), JSON.stringify(profile))
    } catch {
      /* storage unavailable */
    }
  }
  return profile
}

/** File name for the export, e.g. hirerighttt-data-kavya-example-com-2026-11-21.json */
export function accountExportFileName(email: string | undefined, now = new Date()): string {
  const who = (email || 'account').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`  // the user's own date, not UTC
  return `hirerighttt-data-${who}-${day}.json`
}

export function buildAccountExport(me: unknown, now = new Date()): string {
  return JSON.stringify({ exportedAt: now.toISOString(), source: 'HireRighttt', ...(me as object) }, null, 2)
}

/** Downloads the signed-in candidate's data as JSON. */
export async function downloadMyData(): Promise<void> {
  if (!(await ensureApiSession())) throw new Error('Sign in again to download your data.')
  const me = await apiMe()
  const blob = new Blob([buildAccountExport(me)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = accountExportFileName(getUser()?.email)
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Account deletion is handled by support (there is no self-serve delete API yet): prefilled contact form. */
export function accountDeletionRequestPath(email: string | undefined): string {
  const message = `Please delete my HireRighttt account${email ? ` (${email})` : ''} and the data linked to it.`
  return `/contact?message=${encodeURIComponent(message)}`
}
