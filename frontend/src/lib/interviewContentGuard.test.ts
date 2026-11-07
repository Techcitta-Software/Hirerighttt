import { describe, expect, it } from 'vitest'
import {
  attachInterviewContentGuard,
  classifyBlockedShortcut,
  isScreenshotKey,
  looksLikeVirtualCamera,
  type ContentGuardEvent,
} from './interviewContentGuard'

function setup(extra: Partial<Parameters<typeof attachInterviewContentGuard>[0]> = {}) {
  const target = new EventTarget()
  const events: ContentGuardEvent[] = []
  let clipboardCleared = 0
  let clock = 0
  const detach = attachInterviewContentGuard({
    target,
    onEvent: (e) => events.push(e),
    win: { outerWidth: 1280, innerWidth: 1280, outerHeight: 720, innerHeight: 720 },
    screenInfo: { isExtended: false },
    clearClipboard: () => void (clipboardCleared += 1),
    devtoolsIntervalMs: 0,
    now: () => (clock += 5000),
    ...extra,
  })
  const fire = (type: string, init: Record<string, unknown> = {}) => {
    const ev = new Event(type, { cancelable: true })
    for (const [k, v] of Object.entries(init)) Object.defineProperty(ev, k, { value: v })
    target.dispatchEvent(ev)
    return ev
  }
  return { target, events, fire, detach, cleared: () => clipboardCleared }
}

describe('content guard', () => {
  it('blocks and records copy, cut and paste', () => {
    const g = setup()
    expect(g.fire('copy').defaultPrevented).toBe(true)
    expect(g.fire('cut').defaultPrevented).toBe(true)
    expect(g.fire('paste').defaultPrevented).toBe(true)
    expect(g.events.map((e) => e.kind)).toEqual(['COPY_PASTE_ATTEMPT', 'COPY_PASTE_ATTEMPT', 'COPY_PASTE_ATTEMPT'])
    expect(g.events.every((e) => e.notify)).toBe(true)
  })

  it('blocks paste-by-input-event (context menu / drag paths) in the answer box', () => {
    const g = setup()
    expect(g.fire('beforeinput', { inputType: 'insertFromPaste' }).defaultPrevented).toBe(true)
    expect(g.fire('beforeinput', { inputType: 'insertText' }).defaultPrevented).toBe(false) // normal typing is allowed
  })

  it('blocks right-click, drag and drop', () => {
    const g = setup()
    expect(g.fire('contextmenu').defaultPrevented).toBe(true)
    expect(g.fire('dragstart').defaultPrevented).toBe(true)
    expect(g.fire('drop').defaultPrevented).toBe(true)
  })

  it('blocks selecting page text but not text inside the answer box', () => {
    const g = setup()
    expect(g.fire('selectstart', { target: { tagName: 'DIV' } }).defaultPrevented).toBe(true)
    expect(g.fire('selectstart', { target: { tagName: 'TEXTAREA' } }).defaultPrevented).toBe(false)
  })

  it('blocks developer-tool, view-source, save and print shortcuts', () => {
    const g = setup()
    for (const init of [
      { key: 'F12' },
      { key: 'I', ctrlKey: true, shiftKey: true },
      { key: 'u', ctrlKey: true },
      { key: 's', metaKey: true },
      { key: 'p', ctrlKey: true },
    ]) {
      expect(g.fire('keydown', init).defaultPrevented).toBe(true)
    }
    expect(g.events.every((e) => e.kind === 'BLOCKED_SHORTCUT')).toBe(true)
  })

  it('leaves ordinary typing and editing shortcuts alone', () => {
    const g = setup()
    expect(g.fire('keydown', { key: 'a' }).defaultPrevented).toBe(false)
    expect(g.fire('keydown', { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(g.events).toHaveLength(0)
  })

  it('records screenshot keys and clears the clipboard', () => {
    const g = setup()
    g.fire('keyup', { key: 'PrintScreen' })
    expect(g.events[0].kind).toBe('SCREENSHOT_ATTEMPT')
    expect(g.cleared()).toBe(1)
  })

  it('rate-limits repeated attempts of the same kind', () => {
    const g = setup({ now: () => 1000, throttleMs: 2000 })
    for (let i = 0; i < 10; i++) g.fire('paste')
    expect(g.events).toHaveLength(1)
  })

  it('caps the total number of recorded events', () => {
    const g = setup({ maxEvents: 3 })
    for (let i = 0; i < 20; i++) g.fire('paste')
    expect(g.events).toHaveLength(3)
  })

  it('records a second monitor silently', () => {
    const g = setup({ screenInfo: { isExtended: true } })
    expect(g.events[0]).toMatchObject({ kind: 'MULTIPLE_MONITORS', notify: false })
  })

  it('stops listening after detach', () => {
    const g = setup()
    g.detach()
    expect(g.fire('paste').defaultPrevented).toBe(false)
    expect(g.events).toHaveLength(0)
  })
})

describe('classifiers', () => {
  it('classifies shortcuts', () => {
    expect(classifyBlockedShortcut({ key: 'F12' })).toBeTruthy()
    expect(classifyBlockedShortcut({ key: 'c', ctrlKey: true })).toBeNull() // clipboard events handle copy
    expect(isScreenshotKey({ key: 'PrintScreen' })).toBe(true)
    expect(isScreenshotKey({ key: 's', metaKey: true, shiftKey: true })).toBe(true)
    expect(isScreenshotKey({ key: 's' })).toBe(false)
  })

  it('spots common virtual cameras without flagging real ones', () => {
    for (const label of ['OBS Virtual Camera', 'ManyCam Virtual Webcam', 'Snap Camera', 'XSplit VCam', 'mmhmm']) {
      expect(looksLikeVirtualCamera(label)).toBe(true)
    }
    for (const label of ['Integrated Camera', 'HD Webcam C920', 'FaceTime HD Camera', 'USB2.0 HD UVC WebCam', '']) {
      expect(looksLikeVirtualCamera(label)).toBe(false)
    }
  })
})
