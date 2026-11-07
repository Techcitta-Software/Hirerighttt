import { Link } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './AppPages.module.css'

/** Uses the same marketing header/footer as every other public page. */
export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main className={styles.main} style={{ textAlign: 'center', padding: '96px 16px', flex: 1 }}>
        <p style={{ letterSpacing: '0.12em', fontWeight: 700, color: '#5f6686', margin: 0 }}>404</p>
        <h1 style={{ fontSize: '2.2rem', margin: '8px 0 12px' }}>Page not found</h1>
        <p style={{ color: '#5f6686', maxWidth: 420, margin: '0 auto 24px' }}>
          That link doesn’t exist in HireRight. Head back to the product or sign in
          to continue your hiring journey.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/" className={styles.primary}>
            Go home
          </Link>
          <Link to="/login" className={styles.secondary}>
            Sign in
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
