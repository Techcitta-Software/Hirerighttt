import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachInterviewRoomGuard,
  requestInterviewFullscreen,
  shouldRequireInterviewFullscreen,
  fullscreenDeniedUserMessage,
  integrityEventTypeForViolation,
  violationMessage,
} from './interviewRoomLock'

describe('interviewRoomLock', () => {
  it('violationMessage explains tab leave', () => {
    expect(violationMessage('TAB_HIDDEN')).toMatch(/left the interview tab/i)
  })

  it('violationMessage explains fullscreen exit', () => {
    expect(violationMessage('FULLSCREEN_EXIT')).toMatch(/fullscreen/i)
  })

  it('fullscreenDeniedUserMessage mentions Allow for NotAllowedError', () => {
    expect(fullscreenDeniedUserMessage({ errorName: 'NotAllowedError' })).toMatch(/Allow/i)
  })

  it('integrityEventTypeForViolation maps focus reasons', () => {
    expect(integrityEventTypeForViolation('FULLSCREEN_EXIT')).toBe('FULLSCREEN_EXITED')
    expect(integrityEventTypeForViolation('TAB_HIDDEN')).toBe('TAB_OR_WINDOW_LEFT')
    expect(integrityEventTypeForViolation('WINDOW_BLUR')).toBe('TAB_OR_WINDOW_LEFT')
  })
})


describe('locked interview lifecycle', () => {
  let doc: EventTarget & { hidden: boolean; fullscreenElement: object | null; hasFocus: () => boolean; documentElement: object }
  let win: EventTarget
  let detach: (() => void) | undefined
  const onViolation = vi.fn()

  beforeEach(() => {
    onViolation.mockClear()
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

  function attach() {
    detach = attachInterviewRoomGuard({ requireFullscreen: true, onViolation })
  }

  it('requires fullscreen even when the browser does not support it', async () => {
    expect(shouldRequireInterviewFullscreen()).toBe(true)
    expect(await requestInterviewFullscreen()).toEqual({ result: 'unsupported' })
  })

  it('ends immediately on fullscreen exit without a grace period', () => {
    attach()
    doc.fullscreenElement = null
    doc.dispatchEvent(new Event('fullscreenchange'))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ reason: 'FULLSCREEN_EXIT' }))
  })

  it('handles prefixed fullscreen exit events', () => {
    attach()
    doc.fullscreenElement = null
    doc.dispatchEvent(new Event('webkitfullscreenchange'))
    expect(onViolation).toHaveBeenCalledTimes(1)
  })

  it('ends on tab hiding and deduplicates subsequent exit events', () => {
    attach()
    doc.hidden = true
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('blur'))
    win.dispatchEvent(new Event('pagehide'))
    expect(onViolation).toHaveBeenCalledTimes(1)
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ reason: 'TAB_HIDDEN' }))
  })

  it('ends synchronously on switching windows', () => {
    attach()
    win.dispatchEvent(new Event('blur'))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ reason: 'WINDOW_BLUR' }))
  })

  it.each([
    ['Escape', false, 'FULLSCREEN_EXIT'],
    ['F11', false, 'FULLSCREEN_EXIT'],
    ['t', true, 'TAB_HIDDEN'],
    ['r', true, 'TAB_HIDDEN'],
  ])('blocks the %s exit attempt and ends the session', (key, ctrlKey, reason) => {
    attach()
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key, ctrlKey })
    win.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ reason }))
  })

  it('leaves normal typing and tabbing available', () => {
    attach()
    for (const key of ['a', 'Tab', 'Enter']) {
      win.dispatchEvent(Object.assign(new Event('keydown'), { key }))
    }
    expect(onViolation).not.toHaveBeenCalled()
  })

  it('ends even if a reload is cancelled in the browser confirmation', () => {
    attach()
    const event = new Event('beforeunload', { cancelable: true })
    win.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onViolation).toHaveBeenCalledTimes(1)
  })

  it('detects a fullscreen exit that happened before attach', async () => {
    doc.fullscreenElement = null
    attach()
    await Promise.resolve()
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ reason: 'FULLSCREEN_EXIT' }))
  })

  it('removes listeners and cancels the initial check after detach', async () => {
    attach()
    detach?.()
    doc.fullscreenElement = null
    doc.dispatchEvent(new Event('fullscreenchange'))
    win.dispatchEvent(new Event('blur'))
    await Promise.resolve()
    expect(onViolation).not.toHaveBeenCalled()
  })
})
