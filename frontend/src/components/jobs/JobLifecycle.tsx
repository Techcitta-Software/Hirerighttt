import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { handleDialogKeyDown, useDialogFocus } from '../useDialog'
import { ensureApiSession } from '../../lib/apiSession'
import { updateVendorJob, vendorJobStatus, type VendorJob, type VendorJobStatus } from '../../lib/vendorApi'
import type { EmployerJob } from '../../lib/store'
import { JOB_STATUS_LABEL, jobStatusActions, type JobStatusAction } from './jobStatusRules'
import dash from '../../pages/EmployerDashboard.module.css'
import styles from './JobLifecycle.module.css'

const BADGE_CLASS: Record<VendorJobStatus, string> = {
  published: styles.badgePublished,
  draft: styles.badgeDraft,
  closed: styles.badgeClosed,
  archived: styles.badgeArchived,
}

export function JobStatusBadge({ status, inline = false }: { status: string | undefined; inline?: boolean }) {
  const s = vendorJobStatus({ status })
  return (
    <span className={`${styles.badge} ${inline ? styles.badgeInline : ''} ${BADGE_CLASS[s]}`} data-testid="job-status-badge" data-status={s}>
      {JOB_STATUS_LABEL[s]}
    </span>
  )
}

type Notice = (text: string, tone?: 'success' | 'error') => void

/**
 * Edit + status buttons for one job (Close job / Reopen / Unpublish / Publish), each status change behind a
 * confirm dialog with a busy state. `onChanged` gets the job as the API saved it.
 */
export function JobLifecycleActions({
  job,
  onChanged,
  onNotice,
  onEdit,
  disabled = false,
  showEdit = true,
  compact = true,
  primaryOnly = false,
  variant = 'buttons',
  onDelete,
  deleting = false,
}: {
  job: EmployerJob
  onChanged: (job: VendorJob) => void
  onNotice: Notice
  /** Opens the job form (the Create job dialog in edit mode). No Edit button without it. */
  onEdit?: (job: EmployerJob) => void
  disabled?: boolean
  showEdit?: boolean
  compact?: boolean
  /** Only the main status move (Close job / Reopen / Publish), for tight table rows. */
  primaryOnly?: boolean
  /**
   * 'menu': Edit, every status move and Delete live behind one accessible "More actions" (⋯) button, for list
   * rows. The confirm dialogs are the same in both variants.
   */
  variant?: 'buttons' | 'menu'
  /** Menu variant only: adds a destructive "Delete job" item (the caller owns the delete confirm). */
  onDelete?: (job: EmployerJob) => void
  deleting?: boolean
}) {
  const [pending, setPending] = useState<JobStatusAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirmRef = useRef<HTMLDivElement>(null)
  useDialogFocus(Boolean(pending), confirmRef)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  // Fixed position from the trigger, so the menu is never clipped by a scrolling table or card wrapper; it opens
  // upwards when there is no room below, and closes on scroll or resize instead of drifting.
  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const menuH = menuRef.current?.offsetHeight ?? 180
    const below = window.innerHeight - r.bottom
    const right = Math.max(8, window.innerWidth - r.right)
    setMenuStyle(
      below < menuH + 12 && r.top > menuH + 12
        ? { position: 'fixed', bottom: window.innerHeight - r.top + 4, right, top: 'auto' }
        : { position: 'fixed', top: r.bottom + 4, right },
    )
    const close = () => setMenuOpen(false)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
    function onPointer(e: PointerEvent) {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [menuOpen])

  function closeMenu(focusTrigger = true) {
    setMenuOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeMenu()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
      items[next]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      setMenuOpen(false)
    }
  }
  const status = vendorJobStatus(job)
  const actions = jobStatusActions(status).slice(0, primaryOnly ? 1 : undefined)
  const btn = compact ? `${dash.btnSm}` : ''

  function close() {
    if (busy) return
    setPending(null)
  }

  async function confirm(action: JobStatusAction) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await ensureApiSession()
      const { job: saved } = await updateVendorJob(job.id, { status: action.to })
      onChanged(saved)
      onNotice(action.done(job.title), 'success')
      setPending(null)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The change was not saved. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const menuActions = jobStatusActions(status)
  const controls =
    variant === 'menu' ? (
      <span className={styles.menuWrap}>
        <button
          ref={triggerRef}
          type="button"
          className={`${dash.btnSecondary} ${btn} ${styles.menuTrigger}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`More actions for ${job.title}`}
          disabled={disabled || busy || deleting}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">⋯</span>
        </button>
        {menuOpen ? (
          <div ref={menuRef} className={styles.menu} style={menuStyle} role="menu" aria-label={`Actions for ${job.title}`} onKeyDown={onMenuKeyDown}>
            {showEdit && onEdit ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  closeMenu(false)
                  onEdit(job)
                }}
              >
                Edit job
              </button>
            ) : null}
            {menuActions.map((a) => (
              <button
                key={a.key}
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  closeMenu(false)
                  setError('')
                  setPending(a)
                }}
              >
                {a.label}
              </button>
            ))}
            {onDelete ? (
              <>
                <span className={styles.menuSep} role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={() => {
                    closeMenu(false)
                    onDelete(job)
                  }}
                >
                  Delete job
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </span>
    ) : null

  return (
    <>
      {controls ?? (
      <span className={styles.actions}>
        {showEdit && onEdit ? (
          <button
            type="button"
            className={`${dash.btnSecondary} ${btn}`}
            disabled={disabled || busy}
            onClick={() => onEdit?.(job)}
            aria-label={`Edit job ${job.title}`}
          >
            Edit
          </button>
        ) : null}
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`${dash.btnSecondary} ${btn}`}
            disabled={disabled || busy}
            onClick={() => {
              setError('')
              setPending(a)
            }}
            aria-label={`${a.label}: ${job.title}`}
          >
            {busy && pending?.key === a.key ? a.busyLabel : a.label}
          </button>
        ))}
      </span>
      )}

      {pending ? (
        <div
          className={`${dash.modalOverlay} ${styles.dialog}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`job-status-title-${job.id}`}
          aria-describedby={`job-status-body-${job.id}`}
          onKeyDown={(e) => handleDialogKeyDown(e, close)}
        >
          <div ref={confirmRef} tabIndex={-1} className={`${dash.modal} ${dash.modalSm}`}>
            <div className={dash.modalHeader}>
              <h2 id={`job-status-title-${job.id}`}>{pending.title(job.title)}</h2>
            </div>
            <div className={dash.modalBody}>
              <p id={`job-status-body-${job.id}`} className={dash.modalSub}>
                {pending.body}
              </p>
              {error ? (
                <p className={`ds-alert ds-alert--error ${dash.modalError}`} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className={dash.modalFooter}>
              <button type="button" className={dash.btnSecondary} onClick={close} disabled={busy} data-autofocus>
                Cancel
              </button>
              <button
                type="button"
                className={pending.danger ? `${dash.btnPrimary} ${styles.confirmDanger}` : dash.btnPrimary}
                disabled={busy}
                aria-busy={busy}
                onClick={() => void confirm(pending)}
              >
                {busy ? pending.busyLabel : pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
