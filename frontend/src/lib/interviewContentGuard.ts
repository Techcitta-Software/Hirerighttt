/**
 * Copy / paste / developer-tool protection for the locked interview room.
 *
 * Honest scope: a browser cannot stop a phone camera, a second device or a screenshot taken by the operating
 * system. This layer (1) blocks the easy routes (clipboard, right-click, drag and drop, selecting the question
 * text, developer-tool shortcuts), (2) records every attempt so a recruiter can review it, and (3) does not
 * change the score by itself. The fullscreen / tab-switch lock in interviewRoomLock.ts is separate and untouched.
 */

export type ContentGuardKind =
  | 'COPY_PASTE_ATTEMPT'
  | 'BLOCKED_SHORTCUT'
  | 'DEVTOOLS_SUSPECTED'
  | 'MULTIPLE_MONITORS'
  | 'SCREENSHOT_ATTEMPT'

export type ContentGuardEvent = {
  kind: ContentGuardKind
  message: string
  /** Show the candidate a short on-screen notice (silent for heuristic signals). */
  notify: boolean
}

type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }

/** Developer-tool, view-source, save and print shortcuts. Clipboard shortcuts are handled by clipboard events. */
export function classifyBlockedShortcut(e: KeyLike): { label: string } | null {
  const key = (e.key || '').toLowerCase()
  const mod = Boolean(e.ctrlKey || e.metaKey)
  if (key === 'f12') return { label: 'developer tools' }
  if (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) return { label: 'developer tools' }
  if (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(key)) return { label: 'developer tools' }
  if (mod && key === 'u') return { label: 'view source' }
  if (mod && key === 's') return { label: 'save page' }
  if (mod && key === 'p') return { label: 'print' }
  return null
}

/** Screenshot shortcuts. The OS handles them, so these can only be recorded, not blocked. */
export function isScreenshotKey(e: KeyLike): boolean {
  const key = (e.key || '').toLowerCase()
  if (key === 'printscreen') return true
  if (e.metaKey && e.shiftKey && ['s', '3', '4', '5'].includes(key)) return true // Win+Shift+S, macOS capture
  return false
}

type GuardWindow = {
  outerWidth: number
  innerWidth: number
  outerHeight: number
  innerHeight: number
}

type GuardScreen = {
  isExtended?: boolean
  addEventListener?: (type: string, cb: () => void) => void
  removeEventListener?: (type: string, cb: () => void) => void
}

export type ContentGuardOptions = {
  onEvent: (event: ContentGuardEvent) => void
  /** Injectable for tests; defaults to `document`. */
  target?: EventTarget
  win?: GuardWindow
  screenInfo?: GuardScreen
  clearClipboard?: () => void
  /** Developer-tool size heuristic interval; 0 disables it (tests). */
  devtoolsIntervalMs?: number
  /** Minimum gap between two events of the same kind (ms). */
  throttleMs?: number
  maxEvents?: number
  now?: () => number
}

const TEXT_FIELD = /^(input|textarea)$/i

function isTextField(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  return Boolean(el && ((el.tagName && TEXT_FIELD.test(el.tagName)) || el.isContentEditable))
}

export function attachInterviewContentGuard(options: ContentGuardOptions): () => void {
  const target: EventTarget = options.target ?? document
  const win: GuardWindow | undefined =
    options.win ?? (typeof window !== 'undefined' ? (window as unknown as GuardWindow) : undefined)
  const screenInfo: GuardScreen | undefined =
    options.screenInfo ?? (typeof window !== 'undefined' ? (window.screen as unknown as GuardScreen) : undefined)
  const now = options.now ?? (() => Date.now())
  const throttleMs = options.throttleMs ?? 2000
  const maxEvents = options.maxEvents ?? 60
  const last = new Map<ContentGuardKind, number>()
  let count = 0

  const emit = (kind: ContentGuardKind, message: string, notify: boolean) => {
    const t = now()
    if (count >= maxEvents) return
    if (t - (last.get(kind) ?? -Infinity) < throttleMs) return
    last.set(kind, t)
    count += 1
    options.onEvent({ kind, message, notify })
  }

  const block = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onCopy = (e: Event) => {
    block(e)
    emit('COPY_PASTE_ATTEMPT', 'Tried to copy content from the interview room.', true)
  }
  const onCut = (e: Event) => {
    block(e)
    emit('COPY_PASTE_ATTEMPT', 'Tried to cut content in the interview room.', true)
  }
  const onPaste = (e: Event) => {
    block(e)
    emit('COPY_PASTE_ATTEMPT', 'Tried to paste text into the interview room.', true)
  }
  const onDrop = (e: Event) => {
    block(e)
    emit('COPY_PASTE_ATTEMPT', 'Tried to drag and drop content into the interview room.', true)
  }
  const onDragStart = (e: Event) => block(e)
  const onContextMenu = (e: Event) => {
    block(e)
    emit('BLOCKED_SHORTCUT', 'Opened the right-click menu in the interview room.', true)
  }
  const onSelectStart = (e: Event) => {
    if (isTextField(e.target)) return // typing and editing the answer box stays possible
    block(e)
  }
  const onBeforeInput = (e: Event) => {
    const type = (e as InputEvent).inputType || ''
    if (type === 'insertFromPaste' || type === 'insertFromDrop' || type === 'insertFromYank') {
      block(e)
      emit('COPY_PASTE_ATTEMPT', 'Tried to paste text into the answer box.', true)
    }
  }
  const onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent
    // Insert-key clipboard variants do not always raise clipboard events in every browser.
    if ((k.ctrlKey && k.key === 'Insert') || (k.shiftKey && k.key === 'Insert')) {
      block(e)
      emit('COPY_PASTE_ATTEMPT', 'Used a clipboard shortcut in the interview room.', true)
      return
    }
    const hit = classifyBlockedShortcut(k)
    if (hit) {
      block(e)
      emit('BLOCKED_SHORTCUT', `Pressed a blocked shortcut (${hit.label}).`, true)
    }
  }
  const onKeyUp = (e: Event) => {
    if (!isScreenshotKey(e as KeyboardEvent)) return
    try {
      options.clearClipboard?.()
    } catch {
      /* clipboard may be unavailable */
    }
    emit('SCREENSHOT_ATTEMPT', 'A screenshot shortcut was pressed.', true)
  }

  const listeners: [string, (e: Event) => void][] = [
    ['copy', onCopy],
    ['cut', onCut],
    ['paste', onPaste],
    ['drop', onDrop],
    ['dragstart', onDragStart],
    ['dragover', block],
    ['contextmenu', onContextMenu],
    ['selectstart', onSelectStart],
    ['beforeinput', onBeforeInput],
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
  ]
  for (const [type, fn] of listeners) target.addEventListener(type, fn, { capture: true })

  // Several monitors let a candidate keep notes or an assistant open out of the camera's view.
  const checkScreens = () => {
    if (screenInfo?.isExtended) {
      emit('MULTIPLE_MONITORS', 'More than one display is connected.', false)
    }
  }
  checkScreens()
  screenInfo?.addEventListener?.('change', checkScreens)

  // Docked developer tools shrink the page inside the window. In fullscreen the gap is normally ~0.
  let suspicious = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const interval = options.devtoolsIntervalMs ?? 2000
  if (interval > 0 && win) {
    timer = setInterval(() => {
      const gap = Math.max(win.outerWidth - win.innerWidth, win.outerHeight - win.innerHeight)
      suspicious = gap > 200 ? suspicious + 1 : 0
      if (suspicious >= 2) {
        emit('DEVTOOLS_SUSPECTED', 'The browser window layout suggests developer tools may be open.', false)
      }
    }, interval)
  }

  return () => {
    for (const [type, fn] of listeners) target.removeEventListener(type, fn, { capture: true })
    screenInfo?.removeEventListener?.('change', checkScreens)
    if (timer) clearInterval(timer)
  }
}

/** Camera names used by virtual-camera software (pre-recorded video, face swapping). */
const VIRTUAL_CAMERA_RE = /\b(obs|obs-camera|virtual|manycam|snap camera|xsplit|vcam|splitcam|chromacam|mmhmm|e2esoft|fake)\b/i

export function looksLikeVirtualCamera(label: string | undefined | null): boolean {
  return VIRTUAL_CAMERA_RE.test(String(label || ''))
}
