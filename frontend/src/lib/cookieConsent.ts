const STORAGE_KEY = 'hireright.cookieConsent'
const CONSENT_VERSION = 1

export type CookieConsentChoice = {
  version: number
  essential: true
  /** HireRighttt does not enable non-essential marketing/analytics cookies by default. */
  analytics: false
  decidedAt: string
}

export function getCookieConsent(): CookieConsentChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CookieConsentChoice
    if (parsed?.version !== CONSENT_VERSION || parsed.essential !== true) return null
    return parsed
  } catch {
    return null
  }
}

export function hasCookieConsentDecision(): boolean {
  return Boolean(getCookieConsent())
}

export function acceptEssentialCookiesOnly(): CookieConsentChoice {
  const choice: CookieConsentChoice = {
    version: CONSENT_VERSION,
    essential: true,
    analytics: false,
    decidedAt: new Date().toISOString(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
  return choice
}

export function clearCookieConsentForTesting(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Never shown in the interview room (or its lobby / completion pages): the bar sat on top of the mic, camera and
 * "Use keyboard" controls and swallowed clicks, so a candidate lost a question. It appears again on the next page.
 */
export function cookieBannerHiddenOn(pathname: string): boolean {
  return /^\/interview(\/|$)/.test(pathname)
}
