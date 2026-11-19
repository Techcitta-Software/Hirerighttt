import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachInterviewRoomGuard,
  isInterviewFullscreenActive,
  exitInterviewFullscreen,
  type InterviewFocusViolation,
} from './interviewRoomLock'
import {
  attachInterviewContentGuard,
  looksLikeVirtualCamera,
  type ContentGuardEvent,
} from './interviewContentGuard'

describe('interviewRoomLock edge tests', () => {
  describe('looksLikeVirtualCamera pattern detection', () => {
    it.each([
      ['OBS Virtual Camera', 'OBS standard virtual camera'],
      ['OBS-Camera (Device 1)', 'OBS hyphenated camera'],
      ['OBS Studio Virtual Webcam', 'OBS Studio variant'],
      ['obs-cam-loopback', 'OBS lowercase pattern'],
      ['ManyCam Video Device', 'ManyCam video source'],
      ['ManyCam Virtual Webcam', 'ManyCam virtual label'],
      ['manycam software', 'ManyCam lowercase'],
      ['CamTwist', 'CamTwist exact name'],
      ['CamTwist (Virtual)', 'CamTwist with parentheses'],
      ['camtwist video stream', 'CamTwist lowercase'],
      ['vMix Video', 'vMix video output'],
      ['vMix Virtual Audio/Video', 'vMix virtual composite'],
      ['vmix capture device', 'vMix lowercase'],
      ['SplitCam Video Driver', 'SplitCam driver device'],
      ['SplitCam Capture', 'SplitCam capture'],
      ['splitcam filter', 'SplitCam lowercase'],
      ['DroidCam Source 1', 'DroidCam mobile relay'],
      ['DroidCam Video Device', 'DroidCam video source'],
      ['droidcam wireless webcam', 'DroidCam lowercase'],
      ['Fake Webcam', 'Explicit fake webcam'],
      ['Fake Video Source Device', 'Fake video device'],
      ['fake-camera-driver', 'Fake hyphenated'],
      ['v4l2loopback', 'Linux v4l2 loopback module device'],
      ['Loopback Video Device', 'Loopback video device'],
      ['Snap Camera', 'Snap camera filters'],
      ['XSplit VCam', 'XSplit virtual background cam'],
      ['mmhmm Camera', 'mmhmm presentation virtual cam'],
      ['ChromaCam', 'ChromaCam green screen replacement'],
      ['e2eSoft VCam', 'e2eSoft driver'],
    ])('detects virtual camera pattern: %s (%s)', (label) => {
      expect(looksLikeVirtualCamera(label)).toBe(true)
    })

    it.each([
      ['Integrated Camera', 'Built-in laptop webcam'],
      ['Integrated Camera (04f2:b626)', 'Built-in camera with USB hardware id'],
      ['HD Pro Webcam C920', 'Logitech C920 external USB camera'],
      ['Logitech BRIO 4K Stream Edition', 'Logitech BRIO 4K camera'],
      ['FaceTime HD Camera', 'Apple built-in webcam'],
      ['FaceTime HD Camera (Built-in)', 'Apple built-in with parens'],
      ['USB2.0 HD UVC WebCam', 'Generic USB UVC webcam'],
      ['Microsoft LifeCam HD-3000', 'Microsoft USB camera'],
      ['Realtek High Definition Audio', 'Audio hardware name'],
      ['Anker PowerConf C200 2K Webcam', 'Anker external camera'],
    ])('accepts legitimate hardware camera: %s (%s)', (label) => {
      expect(looksLikeVirtualCamera(label)).toBe(false)
    })

    it('handles falsy, null, undefined, whitespace and malformed inputs safely', () => {
      expect(looksLikeVirtualCamera(null)).toBe(false)
      expect(looksLikeVirtualCamera(undefined)).toBe(false)
      expect(looksLikeVirtualCamera('')).toBe(false)
      expect(looksLikeVirtualCamera('   ')).toBe(false)
      expect(looksLikeVirtualCamera('\t\n')).toBe(false)
      // Non-string types coerced safely
      expect(looksLikeVirtualCamera(123 as unknown as string)).toBe(false)
      expect(looksLikeVirtualCamera({} as unknown as string)).toBe(false)
    })

    it('avoids false positives on similar English words that contain camera substrings', () => {
      // "observation" contains "obs" but boundary \b prevents matching
      expect(looksLikeVirtualCamera('Observation Room Cam')).toBe(false)
      // "spotted" contains nothing virtual
      expect(looksLikeVirtualCamera('Spotted Desk Cam')).toBe(false)
    })
  })

  describe('room guard fullscreen violation thresholds and key combinations', () => {
    let doc: EventTarget & {
      hidden: boolean
      fullscreenElement: object | null
      webkitFullscreenElement?: object | null
      hasFocus: () => boolean
      documentElement: object
      exitFullscreen?: () => Promise<void>
      webkitExitFullscreen?: () => void
    }
    let win: EventTarget
    let detach: (() => void) | undefined
    const violations: { reason: InterviewFocusViolation; message: string }[] = []

    beforeEach(() => {
      violations.length = 0
      doc = Object.assign(new EventTarget(), {
        hidden: false,
        fullscreenElement: {},
        webkitFullscreenElement: null,
        hasFocus: () => true,
        documentElement: {
          requestFullscreen: vi.fn().mockResolvedValue(undefined),
        },
        exitFullscreen: vi.fn().mockResolvedValue(undefined),
      })
      win = new EventTarget()
      vi.stubGlobal('document', doc)
      vi.stubGlobal('window', win)
    })

    afterEach(() => {
      detach?.()
      detach = undefined
      vi.unstubAllGlobals()
    })

    function attach(requireFullscreen = true) {
      detach = attachInterviewRoomGuard({
        requireFullscreen,
        onViolation: (detail) => violations.push(detail),
      })
    }

    it.each([
      { key: 'Tab', altKey: true, desc: 'Alt+Tab window switch', expectedReason: 'TAB_HIDDEN' },
      { key: 'tab', altKey: true, desc: 'Alt+tab lowercase', expectedReason: 'TAB_HIDDEN' },
      { key: 'Tab', metaKey: true, desc: 'Cmd+Tab macOS app switch', expectedReason: 'TAB_HIDDEN' },
      { key: 'Tab', ctrlKey: true, desc: 'Ctrl+Tab browser tab switch', expectedReason: 'TAB_HIDDEN' },
      { key: 'Meta', desc: 'Windows / Command key press', expectedReason: 'TAB_HIDDEN' },
      { key: 'OS', desc: 'Legacy Windows key (OS key)', expectedReason: 'TAB_HIDDEN' },
      { key: 'Escape', desc: 'Escape key fullscreen exit', expectedReason: 'FULLSCREEN_EXIT' },
      { key: 'F11', desc: 'F11 browser fullscreen toggle', expectedReason: 'FULLSCREEN_EXIT' },
      { key: 'F12', desc: 'F12 developer tools', expectedReason: 'TAB_HIDDEN' },
      { key: 'I', ctrlKey: true, shiftKey: true, desc: 'Ctrl+Shift+I devtools inspect', expectedReason: 'TAB_HIDDEN' },
      { key: 'i', ctrlKey: true, shiftKey: true, desc: 'Ctrl+Shift+i lowercase inspect', expectedReason: 'TAB_HIDDEN' },
      { key: 'I', metaKey: true, shiftKey: true, desc: 'Cmd+Shift+I macOS devtools inspect', expectedReason: 'TAB_HIDDEN' },
      { key: 'J', ctrlKey: true, shiftKey: true, desc: 'Ctrl+Shift+J devtools console', expectedReason: 'TAB_HIDDEN' },
      { key: 'C', ctrlKey: true, shiftKey: true, desc: 'Ctrl+Shift+C devtools element picker', expectedReason: 'TAB_HIDDEN' },
      { key: 'F4', altKey: true, desc: 'Alt+F4 close window', expectedReason: 'TAB_HIDDEN' },
      { key: 'F5', desc: 'F5 refresh page', expectedReason: 'TAB_HIDDEN' },
      { key: 'r', ctrlKey: true, desc: 'Ctrl+R reload page', expectedReason: 'TAB_HIDDEN' },
      { key: 'r', metaKey: true, desc: 'Cmd+R reload page', expectedReason: 'TAB_HIDDEN' },
      { key: 'w', ctrlKey: true, desc: 'Ctrl+W close tab', expectedReason: 'TAB_HIDDEN' },
      { key: 'w', metaKey: true, desc: 'Cmd+W close tab', expectedReason: 'TAB_HIDDEN' },
      { key: 't', ctrlKey: true, desc: 'Ctrl+T new tab', expectedReason: 'TAB_HIDDEN' },
      { key: 'l', ctrlKey: true, desc: 'Ctrl+L focus URL bar', expectedReason: 'TAB_HIDDEN' },
    ])('intercepts and ends session on $desc', ({ key, altKey, metaKey, ctrlKey, shiftKey, expectedReason }) => {
      attach()
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key,
        altKey: Boolean(altKey),
        metaKey: Boolean(metaKey),
        ctrlKey: Boolean(ctrlKey),
        shiftKey: Boolean(shiftKey),
      })
      win.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe(expectedReason)
    })

    it('permits innocent candidate keystrokes without violation', () => {
      attach()
      const allowedKeys = [
        { key: 'a' },
        { key: 'Z' },
        { key: 'Enter' },
        { key: 'Backspace' },
        { key: ' ' },
        { key: 'ArrowDown' },
        { key: 'ArrowUp' },
        { key: 'Tab' }, // plain tab for navigation without ctrl/alt/meta
        { key: 'Shift' },
        { key: 'Control' },
      ]
      for (const k of allowedKeys) {
        const ev = Object.assign(new Event('keydown', { cancelable: true }), k)
        win.dispatchEvent(ev)
        expect(ev.defaultPrevented).toBe(false)
      }
      expect(violations).toHaveLength(0)
    })

    it('triggers FULLSCREEN_EXIT immediately on document fullscreen change when fullscreenElement is null', () => {
      attach(true)
      doc.fullscreenElement = null
      doc.dispatchEvent(new Event('fullscreenchange'))
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('FULLSCREEN_EXIT')
    })

    it('respects requireFullscreen = false when fullscreenElement is null', () => {
      attach(false)
      doc.fullscreenElement = null
      doc.dispatchEvent(new Event('fullscreenchange'))
      expect(violations).toHaveLength(0)
    })

    it('supports webkitFullscreenElement fallback', () => {
      doc.fullscreenElement = null
      doc.webkitFullscreenElement = {} // Webkit active
      expect(isInterviewFullscreenActive()).toBe(true)

      doc.webkitFullscreenElement = null
      expect(isInterviewFullscreenActive()).toBe(false)
    })

    it('supports exitInterviewFullscreen cleanly', () => {
      doc.fullscreenElement = {}
      exitInterviewFullscreen()
      expect(doc.exitFullscreen).toHaveBeenCalledTimes(1)
    })
  })

  describe('rapid violation debouncing and multiple concurrent event processing', () => {
    let doc: EventTarget & {
      hidden: boolean
      fullscreenElement: object | null
      hasFocus: () => boolean
      documentElement: object
    }
    let win: EventTarget
    let detach: (() => void) | undefined
    const violations: { reason: InterviewFocusViolation; message: string }[] = []

    beforeEach(() => {
      violations.length = 0
      doc = Object.assign(new EventTarget(), {
        hidden: false,
        fullscreenElement: {},
        hasFocus: () => true,
        documentElement: {},
      })
      win = new EventTarget()
      vi.stubGlobal('document', doc)
      vi.stubGlobal('window', win)
    })

    afterEach(() => {
      detach?.()
      detach = undefined
      vi.unstubAllGlobals()
    })

    it('debounces a synchronous barrage of 50 concurrent exit events into exactly one violation', () => {
      detach = attachInterviewRoomGuard({
        requireFullscreen: true,
        onViolation: (detail) => violations.push(detail),
      })

      // Simulate simultaneous fullscreen loss, window blur, visibility loss, key combinations, and unload
      doc.fullscreenElement = null
      doc.hidden = true

      for (let i = 0; i < 10; i++) {
        doc.dispatchEvent(new Event('fullscreenchange'))
        doc.dispatchEvent(new Event('webkitfullscreenchange'))
        win.dispatchEvent(new Event('blur'))
        doc.dispatchEvent(new Event('visibilitychange'))
        win.dispatchEvent(new Event('pagehide'))
      }

      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('FULLSCREEN_EXIT')
    })

    it('ensures debouncing holds across asynchronous microtask boundary', async () => {
      detach = attachInterviewRoomGuard({
        requireFullscreen: true,
        onViolation: (detail) => violations.push(detail),
      })

      // Fire event in first tick
      win.dispatchEvent(new Event('blur'))
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('WINDOW_BLUR')

      // Wait for microtask queue to drain (microtask checks document.hidden / fullscreen)
      doc.fullscreenElement = null
      doc.hidden = true
      await Promise.resolve()

      // Subsequent events after microtask should still be suppressed
      doc.dispatchEvent(new Event('fullscreenchange'))
      doc.dispatchEvent(new Event('visibilitychange'))
      expect(violations).toHaveLength(1)
    })

    it('cleans up all listeners on detach so subsequent bursts fire zero violations', () => {
      detach = attachInterviewRoomGuard({
        requireFullscreen: true,
        onViolation: (detail) => violations.push(detail),
      })

      detach()
      detach = undefined

      doc.fullscreenElement = null
      doc.hidden = true

      for (let i = 0; i < 20; i++) {
        doc.dispatchEvent(new Event('fullscreenchange'))
        win.dispatchEvent(new Event('blur'))
        doc.dispatchEvent(new Event('visibilitychange'))
        win.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }))
      }

      expect(violations).toHaveLength(0)
    })

    it('content guard debounces rapid clipboard spam within throttleMs window', () => {
      const target = new EventTarget()
      const contentEvents: ContentGuardEvent[] = []
      let currentTime = 1000

      const detachGuard = attachInterviewContentGuard({
        target,
        throttleMs: 2000,
        now: () => currentTime,
        onEvent: (e) => contentEvents.push(e),
      })

      // 50 rapid copy/paste events at t = 1000
      for (let i = 0; i < 50; i++) {
        const ev = new Event('copy', { cancelable: true })
        target.dispatchEvent(ev)
      }
      expect(contentEvents).toHaveLength(1)
      expect(contentEvents[0].kind).toBe('COPY_PASTE_ATTEMPT')

      // Advance time by 1500ms (still within throttle window of 2000ms)
      currentTime = 2500
      for (let i = 0; i < 10; i++) {
        target.dispatchEvent(new Event('paste', { cancelable: true }))
      }
      expect(contentEvents).toHaveLength(1)

      // Advance time by 2500ms (currentTime = 3500 > 1000 + 2000)
      currentTime = 3500
      target.dispatchEvent(new Event('paste', { cancelable: true }))
      expect(contentEvents).toHaveLength(2)

      detachGuard()
    })

    it('content guard caps maximum total recorded events at maxEvents threshold', () => {
      const target = new EventTarget()
      const contentEvents: ContentGuardEvent[] = []
      let currentTime = 1000

      const detachGuard = attachInterviewContentGuard({
        target,
        throttleMs: 10,
        maxEvents: 5,
        now: () => (currentTime += 20),
        onEvent: (e) => contentEvents.push(e),
      })

      // Dispatch 30 throttled events across time
      for (let i = 0; i < 30; i++) {
        target.dispatchEvent(new Event('copy', { cancelable: true }))
      }

      expect(contentEvents).toHaveLength(5)

      detachGuard()
    })

    it('developer tools heuristic requires consecutive suspicious window layout gaps', () => {
      vi.useFakeTimers()
      const target = new EventTarget()
      const contentEvents: ContentGuardEvent[] = []
      const fakeWin = {
        outerWidth: 1920,
        innerWidth: 1920,
        outerHeight: 1080,
        innerHeight: 1080,
      }

      const detachGuard = attachInterviewContentGuard({
        target,
        win: fakeWin,
        devtoolsIntervalMs: 1000,
        throttleMs: 500,
        onEvent: (e) => contentEvents.push(e),
      })

      // Interval 1: Normal window dimensions
      vi.advanceTimersByTime(1000)
      expect(contentEvents).toHaveLength(0)

      // Interval 2: Temporary resize (gap > 200px) - suspicious count = 1 (threshold is 2)
      fakeWin.innerWidth = 1600 // gap = 320px
      vi.advanceTimersByTime(1000)
      expect(contentEvents).toHaveLength(0)

      // Interval 3: Second consecutive suspicious check -> emits DEVTOOLS_SUSPECTED
      vi.advanceTimersByTime(1000)
      expect(contentEvents).toHaveLength(1)
      expect(contentEvents[0].kind).toBe('DEVTOOLS_SUSPECTED')

      detachGuard()
      vi.useRealTimers()
    })
  })
})
