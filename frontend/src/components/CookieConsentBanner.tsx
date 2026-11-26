import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { acceptEssentialCookiesOnly, cookieBannerHiddenOn, hasCookieConsentDecision } from '../lib/cookieConsent'
import styles from './CookieConsentBanner.module.css'

/**
 * One slim line at the bottom of the screen. We only use essential storage, so there is nothing to choose:
 * "OK" (or following the "Learn more" link) records the notice as seen and it does not come back.
 */
export function CookieConsentBanner() {
  const { pathname } = useLocation()
  const [visible, setVisible] = useState(() => !hasCookieConsentDecision())

  useEffect(() => {
    function onConsentReset() {
      setVisible(!hasCookieConsentDecision())
    }
    window.addEventListener('hireright:cookie-consent-reset', onConsentReset)
    return () => window.removeEventListener('hireright:cookie-consent-reset', onConsentReset)
  }, [])

  if (!visible || cookieBannerHiddenOn(pathname)) return null

  function acknowledge() {
    try {
      acceptEssentialCookiesOnly()
    } catch {
      // Storage blocked: hide for this visit anyway.
    }
    setVisible(false)
  }

  return (
    <section className={styles.bar} aria-label="Cookie notice">
      <p className={styles.text}>
        HireRighttt uses only essential cookies and local storage to keep you signed in. No ads, no tracking.
      </p>
      <div className={styles.actions}>
        <Link to="/cookies" className={styles.learnMore} onClick={acknowledge}>
          Learn more
        </Link>
        <button type="button" className={styles.okBtn} onClick={acknowledge}>
          OK
        </button>
      </div>
    </section>
  )
}
