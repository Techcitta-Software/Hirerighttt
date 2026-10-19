const STORAGE_KEY = 'hireright.cookieConsent'
const CONSENT_VERSION = 1

export type CookieConsentChoice = {
  version: number
  essential: true
  /** HireRight does not enable non-essential marketing/analytics cookies by default. */
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
