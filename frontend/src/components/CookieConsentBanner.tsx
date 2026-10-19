import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { acceptEssentialCookiesOnly, hasCookieConsentDecision } from '../lib/cookieConsent'
import styles from './CookieConsentBanner.module.css'

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(!hasCookieConsentDecision())
  }, [])

  useEffect(() => {
    function onConsentReset() {
      setVisible(!hasCookieConsentDecision())
    }
    window.addEventListener('hireright:cookie-consent-reset', onConsentReset)
    return () => window.removeEventListener('hireright:cookie-consent-reset', onConsentReset)
  }, [])

  if (!visible) return null

  function accept() {
    acceptEssentialCookiesOnly()
    setVisible(false)
  }

  return (
    <div className={styles.bar} role="dialog" aria-labelledby="cookie-consent-title" aria-live="polite">
      <div className={styles.inner}>
        <div className={styles.copy}>
          <p id="cookie-consent-title" className={styles.title}>
            Cookies &amp; local storage
          </p>
          <p className={styles.body}>
            We use only what is necessary to run HireRight: sign-in session tokens, security, and settings
            stored on your device. We do not use advertising cookies or sell your data. See our policies
            for details.
          </p>
          <div className={styles.links}>
            <Link to="/privacy" onClick={() => setVisible(false)}>
              Privacy Policy
            </Link>
            <Link to="/cookies" onClick={() => setVisible(false)}>
              Cookie Policy
            </Link>
            <Link to="/terms" onClick={() => setVisible(false)}>
              Terms &amp; Conditions
            </Link>
          </div>
        </div>
        <div className={styles.actions}>
          <Link to="/cookies" className={styles.secondaryBtn} onClick={() => setVisible(false)}>
            Cookie settings
          </Link>
          <button type="button" className={styles.acceptBtn} onClick={accept}>
            Accept essential only
          </button>
        </div>
      </div>
    </div>
  )
}
