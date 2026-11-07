/**
 * Remembers where an emailed interview link should bring the candidate back to after they sign in
 * or create their account, so "click the link -> sign in -> interview" works without extra steps.
 */
const RETURN_KEY = 'hireright.inviteReturn'
const EMAIL_KEY = 'hireright.inviteEmail'

export function rememberInviteReturn(path: string, email?: string | null) {
  try {
    sessionStorage.setItem(RETURN_KEY, path)
    if (email) sessionStorage.setItem(EMAIL_KEY, email)
  } catch {
    /* storage unavailable (private mode) — the candidate can reopen the email link */
  }
}

export function peekInviteReturn(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_KEY)
    return value && value.startsWith('/interview/invite/') ? value : null
  } catch {
    return null
  }
}

export function consumeInviteReturn(): string | null {
  const value = peekInviteReturn()
  try {
    if (value) sessionStorage.removeItem(RETURN_KEY)
  } catch {
    /* ignore */
  }
  return value
}

export function readInviteEmail(): string {
  try {
    return sessionStorage.getItem(EMAIL_KEY) || ''
  } catch {
    return ''
  }
}

export function clearInviteReturn() {
  try {
    sessionStorage.removeItem(RETURN_KEY)
    sessionStorage.removeItem(EMAIL_KEY)
  } catch {
    /* ignore */
  }
}
