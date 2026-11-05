export type InterviewFocusViolation =
  | 'TAB_HIDDEN'
  | 'FULLSCREEN_EXIT'
  | 'WINDOW_BLUR'

/** Integrity log event type for a focus / fullscreen violation. */
export type InterviewIntegrityFocusEvent = 'TAB_OR_WINDOW_LEFT' | 'FULLSCREEN_EXITED'

export function integrityEventTypeForViolation(
  reason: InterviewFocusViolation,
): InterviewIntegrityFocusEvent {
  return reason === 'FULLSCREEN_EXIT' ? 'FULLSCREEN_EXITED' : 'TAB_OR_WINDOW_LEFT'
}

/** Fullscreen is mandatory, including on devices that cannot support it. */
export function shouldRequireInterviewFullscreen(): boolean {
  return typeof window !== 'undefined'
}

export type FullscreenRequestResult = 'granted' | 'unsupported' | 'denied'

export type FullscreenRequestDetail = {
  result: FullscreenRequestResult
  /** Browser error name when result is denied (e.g. NotAllowedError). */
  errorName?: string
}

export function isInterviewFullscreenActive(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement)
}

export function interviewFullscreenSupported(): boolean {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown }
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen)
}

export function fullscreenDeniedUserMessage(detail?: Pick<FullscreenRequestDetail, 'errorName'>): string {
  if (detail?.errorName === 'NotAllowedError') {
    return (
      'Your browser needs fullscreen for the locked interview room. Click Join again — when the address bar ' +
      'or top of the window asks to allow fullscreen, choose Allow. If you blocked it before, reset the ' +
      'permission for this site in browser settings and try again.'
    )
  }
  return (
    'Fullscreen is required. Click Join again and approve the fullscreen prompt when it appears.'
  )
}

/** Call directly from a click handler (before other long async work) so the browser shows the prompt. */
export async function requestInterviewFullscreen(): Promise<FullscreenRequestDetail> {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void
  }
  try {
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) {
      return { result: 'unsupported' }
    }
    if (isInterviewFullscreenActive()) return { result: 'granted' }
    if (el.requestFullscreen) {
      await el.requestFullscreen()
    } else {
      await el.webkitRequestFullscreen!()
    }
    return isInterviewFullscreenActive()
      ? { result: 'granted' }
      : { result: 'denied', errorName: 'NotAllowedError' }
  } catch (err) {
    const errorName = err instanceof Error ? err.name : undefined
    return { result: 'denied', errorName }
  }
}

export function exitInterviewFullscreen(): void {
  const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void }
  try {
    if (!isInterviewFullscreenActive()) return
    if (doc.exitFullscreen) void doc.exitFullscreen()
    else doc.webkitExitFullscreen?.()
  } catch {
    // ignore
  }
}

export function violationMessage(reason: InterviewFocusViolation): string {
  switch (reason) {
    case 'TAB_HIDDEN':
      return 'You left the interview tab or minimized the browser. The session ended and your answers so far were scored.'
    case 'FULLSCREEN_EXIT':
      return 'Fullscreen was exited during the interview. The session ended and your answers so far were scored.'
    case 'WINDOW_BLUR':
      return 'You switched away from the interview window. The session ended and your answers so far were scored.'
    default:
      return 'The interview session ended for integrity reasons. Your answers so far were scored.'
  }
}

export type InterviewRoomGuardOptions = {
  requireFullscreen: boolean
  onViolation: (detail: { reason: InterviewFocusViolation; message: string }) => void
}

export function attachInterviewRoomGuard(options: InterviewRoomGuardOptions): () => void {
  let ended = false

  const fire = (reason: InterviewFocusViolation) => {
    if (ended) return
    ended = true
    options.onViolation({ reason, message: violationMessage(reason) })
  }

  const onVisibility = () => {
    if (document.hidden) fire('TAB_HIDDEN')
  }

  const onPageHide = () => {
    fire('TAB_HIDDEN')
  }

  const onFullscreen = () => {
    if (options.requireFullscreen && !isInterviewFullscreenActive()) {
      fire('FULLSCREEN_EXIT')
    }
  }

  const onBlur = () => {
    fire(document.hidden ? 'TAB_HIDDEN' : 'WINDOW_BLUR')
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    const fullscreenExit = key === 'escape' || key === 'f11'
    const navigation = key === 'f5' ||
      ((event.ctrlKey || event.metaKey) && ['l', 't', 'w', 'r', 'n', 'tab'].includes(key)) ||
      (event.altKey && ['tab', 'f4', 'arrowleft', 'arrowright', 'home'].includes(key))
    if (!fullscreenExit && !navigation) return
    event.preventDefault()
    fire(fullscreenExit ? 'FULLSCREEN_EXIT' : 'TAB_HIDDEN')
  }

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    fire('TAB_HIDDEN')
    event.preventDefault()
    event.returnValue = ''
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('blur', onBlur)
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('fullscreenchange', onFullscreen)
  document.addEventListener('webkitfullscreenchange', onFullscreen)
  window.addEventListener('keydown', onKeyDown, true)

  // Catch exits during async setup before the guard was attached.
  queueMicrotask(() => {
    if (ended) return
    if (document.hidden) fire('TAB_HIDDEN')
    else if (options.requireFullscreen && !isInterviewFullscreenActive()) fire('FULLSCREEN_EXIT')
    else if (!document.hasFocus()) fire('WINDOW_BLUR')
  })

  return () => {
    ended = true
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('beforeunload', onBeforeUnload)
    document.removeEventListener('fullscreenchange', onFullscreen)
    document.removeEventListener('webkitfullscreenchange', onFullscreen)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}
