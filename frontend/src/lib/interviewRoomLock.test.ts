import { describe, expect, it } from 'vitest'
import { fullscreenDeniedUserMessage, violationMessage } from './interviewRoomLock'

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
})
