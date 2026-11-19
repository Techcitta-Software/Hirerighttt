import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

const DIALOG_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type DialogInitialFocus = 'field' | 'dialog'

/**
 * Dialog behaviour from the UI rulebook (§2.10): move focus into the dialog, lock page scroll while
 * open, and return focus to the trigger on close.
 * Initial focus: an element marked `data-autofocus`, else the first field (`initial="field"`), else the
 * dialog panel itself (give it `tabIndex={-1}`).
 */
export function useDialogFocus(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  initial: DialogInitialFocus = 'dialog',
) {
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const node = ref.current
    const marked = node?.querySelector<HTMLElement>('[data-autofocus]')
    const field =
      initial === 'field'
        ? node?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
        : null
    ;(marked ?? field ?? node)?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      if (trigger?.isConnected) trigger.focus()
    }
    // Runs once per open: the ref object and the initial mode do not change while a dialog is open.
  }, [open, ref, initial])
}

/** Esc closes the dialog and Tab stays inside it. Skipped while another dialog is stacked on top. */
export function handleDialogKeyDown(e: KeyboardEvent<HTMLElement>, onClose: () => void, covered = false) {
  if (covered) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    onClose()
    return
  }
  if (e.key !== 'Tab') return
  const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)).filter(
    (n) => n.offsetParent !== null,
  )
  if (!nodes.length) {
    e.preventDefault()
    return
  }
  const idx = nodes.indexOf(document.activeElement as HTMLElement)
  if (idx === -1) {
    e.preventDefault()
    ;(e.shiftKey ? nodes[nodes.length - 1] : nodes[0]).focus()
  } else if (e.shiftKey && idx === 0) {
    e.preventDefault()
    nodes[nodes.length - 1].focus()
  } else if (!e.shiftKey && idx === nodes.length - 1) {
    e.preventDefault()
    nodes[0].focus()
  }
}

/**
 * One-call dialog wiring: put `ref` on the dialog panel (with `tabIndex={-1}`) and `onKeyDown` on the
 * overlay that wraps it.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  opts: { initial?: DialogInitialFocus; covered?: boolean } = {},
) {
  const ref = useRef<T>(null)
  useDialogFocus(open, ref, opts.initial)
  const { covered = false } = opts
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => handleDialogKeyDown(e, onClose, covered),
    [onClose, covered],
  )
  return { ref, onKeyDown }
}
