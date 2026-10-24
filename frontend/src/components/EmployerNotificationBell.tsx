import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  getNotifications,
  markNotificationRead,
  markNotificationsRead,
  type AppNotification,
} from '../lib/store'
import {
  rememberEmployerApplicationAlertIds,
  syncEmployerApplicationNotifications,
} from '../lib/employerApplicationNotifications'
import {
  fetchEmployerApplicationAlerts,
  markEmployerApplicationAlertsRead,
} from '../lib/vendorApi'
import { ensureApiSession } from '../lib/apiSession'
import styles from './CandidateNotificationBell.module.css'

function timeAgo(iso: string) {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return 'Just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function kindLabel(kind: AppNotification['kind']) {
  if (kind === 'application') return 'Application'
  if (kind === 'job_match') return 'Job match'
  if (kind === 'status') return 'Status update'
  return 'Update'
}

export function EmployerNotificationBell() {
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<AppNotification[]>([])

  function refreshList() {
    const unreadOnly = getNotifications().filter((n) => !n.read)
    setItems(unreadOnly)
    setUnread(unreadOnly.length)
  }

  useEffect(() => {
    refreshList()
    const onSync = () => refreshList()
    window.addEventListener('hireright-auth', onSync)
    return () => window.removeEventListener('hireright-auth', onSync)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const ok = await ensureApiSession()
        if (!ok || cancelled) return
        const { alerts } = await fetchEmployerApplicationAlerts()
        if (cancelled) return
        syncEmployerApplicationNotifications(alerts)
      } catch {
        /* bell still shows stored notifications */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: globalThis.MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function dismissOnServer(alertIds: string[]) {
    if (!alertIds.length) return
    try {
      await ensureApiSession()
      await markEmployerApplicationAlertsRead(alertIds)
    } catch {
      /* local dismiss still applies */
    }
  }

  function dismissItems(toDismiss: AppNotification[]) {
    const alertIds = toDismiss.map((n) => n.alertId).filter(Boolean) as string[]
    if (alertIds.length) rememberEmployerApplicationAlertIds(alertIds)
    void dismissOnServer(alertIds)
  }

  function openItem(n: AppNotification) {
    dismissItems([n])
    markNotificationRead(n.id)
    refreshList()
    setOpen(false)
    if (n.href) navigate(n.href)
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.bellBtn} ${unread > 0 ? styles.bellBtnActive : ''}`}
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        onClick={() => {
          const nextOpen = !open
          setOpen(nextOpen)
          if (nextOpen) refreshList()
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className={styles.bellBadge}>{unread > 9 ? '9+' : unread}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.panel}
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <div className={styles.panelHead}>
              <div>
                <p className={styles.panelEyebrow}>Inbox</p>
                <h2 className={styles.panelTitle}>Notifications</h2>
              </div>
              {unread > 0 && (
                <button
                  type="button"
                  className={styles.markAllBtn}
                  onClick={() => {
                    dismissItems(items)
                    markNotificationsRead()
                    refreshList()
                  }}
                >
                  Clear all
                </button>
              )}
            </div>

            <ul className={styles.list}>
              {items.length === 0 ? (
                <li className={styles.empty}>
                  <div className={styles.emptyIcon} aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </div>
                  <p className={styles.emptyTitle}>You&apos;re all caught up</p>
                  <p className={styles.emptyBody}>
                    New candidate applications for your job openings will appear here.
                  </p>
                </li>
              ) : (
                items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`${styles.item} ${!n.read ? styles.itemUnread : ''} ${
                        n.kind === 'application' ? styles.itemJobMatch : ''
                      }`}
                      onClick={() => openItem(n)}
                    >
                      <span className={styles.itemIcon} aria-hidden="true">
                        {n.kind === 'application' ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                          </svg>
                        )}
                      </span>
                      <span className={styles.itemBody}>
                        <span className={styles.itemMeta}>
                          <span className={styles.itemKind}>{kindLabel(n.kind)}</span>
                          <span className={styles.itemTime}>{timeAgo(n.createdAt)}</span>
                        </span>
                        <span className={styles.itemTitle}>{n.title}</span>
                        <span className={styles.itemText}>{n.body}</span>
                      </span>
                      {!n.read && <span className={styles.unreadDot} aria-hidden="true" />}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
