import { Link } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './NotFoundPage.module.css'

/** Uses the same marketing header/footer as every other public page. */
export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main className={styles.main}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.text}>
          That link doesn’t exist on HireRighttt. Head back to the home page or sign in to continue.
        </p>
        <div className={styles.actions}>
          <Link to="/" className="ds-btn ds-btn--primary">
            Go home
          </Link>
          <Link to="/login" className="ds-btn ds-btn--secondary">
            Sign in
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
