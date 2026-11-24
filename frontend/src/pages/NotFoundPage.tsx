import { useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import { getUser } from '../lib/store'
import styles from './NotFoundPage.module.css'

/** Uses the same marketing header/footer as every other public page. */
export function NotFoundPage() {
  useLayoutEffect(() => {
    document.title = 'Page not found · HireRighttt'
  }, [])
  const user = getUser()
  const dashboardPath = user?.role === 'employer' ? '/employer/dashboard' : '/dashboard'

  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main className={styles.main}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.text}>
          {user
            ? 'That link doesn’t exist on HireRighttt. Your dashboard has everything you were working on.'
            : 'That link doesn’t exist on HireRighttt. Head back to the home page or sign in to continue.'}
        </p>
        <div className={styles.actions}>
          {/* Signed-in visitors were offered "Sign in"; they get their dashboard instead. */}
          {user ? (
            <>
              <Link to={dashboardPath} className="ds-btn ds-btn--primary">
                Go to dashboard
              </Link>
              <Link to="/" className="ds-btn ds-btn--secondary">
                Go home
              </Link>
            </>
          ) : (
            <>
              <Link to="/" className="ds-btn ds-btn--primary">
                Go home
              </Link>
              <Link to="/login" className="ds-btn ds-btn--secondary">
                Sign in
              </Link>
            </>
          )}
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
