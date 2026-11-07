import { Outlet } from 'react-router-dom'
import { AppNavBar } from './AppNavBar'
import { AppFooter } from './AppFooter'
import styles from './AppShell.module.css'

/** Wraps authenticated app routes with shared header and footer. */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <a href="#app-main" className="ds-skip-link">
        Skip to content
      </a>
      <AppNavBar />
      <main className={styles.main} id="app-main" tabIndex={-1}>
        <Outlet />
      </main>
      <AppFooter />
    </div>
  )
}
