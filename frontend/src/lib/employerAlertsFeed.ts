import { ensureApiSession } from './apiSession'
import { syncEmployerApplicationNotifications } from './employerApplicationNotifications'
import { createSharedPoller } from './sharedPoller'
import { getUser } from './store'
import { fetchEmployerApplicationAlerts, type EmployerApplicationAlert } from './vendorApi'

const POLL_MS = 30_000

let feedEmail: string | null = null

const poller = createSharedPoller<EmployerApplicationAlert[]>(
  async ({ background }) => {
    const ok = await ensureApiSession()
    if (!ok) throw new Error('No API session')
    const { alerts } = await fetchEmployerApplicationAlerts({ background })
    // Feed the nav-bell inbox once per poll, however many components are listening.
    syncEmployerApplicationNotifications(alerts)
    return alerts
  },
  { intervalMs: POLL_MS },
)

/**
 * Employer application alerts, polled once every 30 s for the whole app (bell + dashboard share it).
 * Returns the unsubscribe function.
 */
export function subscribeEmployerApplicationAlerts(
  listener: (alerts: EmployerApplicationAlert[]) => void,
): () => void {
  const email = getUser()?.email?.trim().toLowerCase() || null
  if (email !== feedEmail) {
    // Another account signed in: never hand it the previous account's alerts.
    poller.reset()
    feedEmail = email
  }
  return poller.subscribe(listener)
}
