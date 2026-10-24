import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  getNotifications,
  markNotificationRead,
  markNotificationsRead,
  type AppNotification,
} from '../lib/store'
import { rememberNotifiedJobIds, syncJobMatchNotifications } from '../lib/jobMatchNotifications'
import { fetchCandidateJobAlerts, fetchOpenJobs } from '../lib/vendorApi'
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
  if (kind === 'job_match') return 'Job match'
  if (kind === 'application') return 'Application'
  if (kind === 'status') return 'Status update'
  return 'Update'
}

export function CandidateNotificationBell() {
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<AppNotification[]>([])

  function refreshList() {
    const all = getNotifications()
    const unreadOnly = all.filter((n) => !n.read)
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
    async function pollJobAlerts() {
      try {
        const ok = await ensureApiSession()
        if (!ok || cancelled) return
        const [res, alertsRes] = await Promise.all([
          fetchOpenJobs({ summary: true, scope: 'matched', limit: 30 }),
          fetchCandidateJobAlerts().catch(() => ({ alerts: [] as { jobId: string; title: string; company: string }[] })),
        ])
        const fromJobs = (res.jobs ?? []).map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
        }))
        const fromAlerts = (alertsRes.alerts ?? []).map((a) => ({
          id: a.jobId,
          title: a.title,
          company: a.company,
        }))
        const merged = [...fromAlerts]
        for (const j of fromJobs) {
          if (!merged.some((m) => m.id === j.id)) merged.push(j)
        }
        syncJobMatchNotifications(merged)
      } catch {
        /* ignore — bell still shows stored notifications */
      }
    }
    void pollJobAlerts()
    const timer = window.setInterval(() => void pollJobAlerts(), 90_000)
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

  function dismissItems(toDismiss: AppNotification[]) {
    const jobIds = toDismiss.filter((n) => n.kind === 'job_match' && n.jobId).map((n) => n.jobId!)
    if (jobIds.length) rememberNotifiedJobIds(jobIds)
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
                    When an employer posts a role that fits your profile, it will show up here.
                  </p>
                </li>
              ) : (
                items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`${styles.item} ${!n.read ? styles.itemUnread : ''} ${
                        n.kind === 'job_match' ? styles.itemJobMatch : ''
                      }`}
                      onClick={() => openItem(n)}
                    >
                      <span className={styles.itemIcon} aria-hidden="true">
                        {n.kind === 'job_match' ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="7" width="20" height="14" rx="2" />
                            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
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
