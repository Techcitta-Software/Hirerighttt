import { Outlet } from 'react-router-dom'
import { AppNavBar } from './AppNavBar'
import { AppFooter } from './AppFooter'
import styles from './AppShell.module.css'

/** Wraps authenticated app routes with shared header and footer. */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <AppNavBar />
      <main className={styles.main} id="app-main">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  )
}
