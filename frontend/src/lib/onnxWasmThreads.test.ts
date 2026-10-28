import { describe, expect, it } from 'vitest'
import { onnxWasmThreadCount } from './onnxWasmThreads'

describe('onnxWasmThreadCount', () => {
  it('uses a single thread when cross-origin isolation is off', () => {
    expect(onnxWasmThreadCount()).toBe(1)
  })
})
