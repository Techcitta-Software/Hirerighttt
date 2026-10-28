import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  isDeepFilterVoiceIsolationEnabled,
  isDeepFilterVoiceIsolationSupported,
} from './deepFilterVoiceIsolation'

describe('deepFilterVoiceIsolation config', () => {
  const env = import.meta.env

  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_DEEPFILTER_NET3', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.assign(import.meta.env, env)
  })

  it('is enabled by default', () => {
    expect(isDeepFilterVoiceIsolationEnabled()).toBe(true)
  })

  it('respects VITE_ENABLE_DEEPFILTER_NET3=false', () => {
    vi.stubEnv('VITE_ENABLE_DEEPFILTER_NET3', 'false')
    expect(isDeepFilterVoiceIsolationEnabled()).toBe(false)
  })

  it('reports browser support in test env', () => {
    expect(typeof isDeepFilterVoiceIsolationSupported()).toBe('boolean')
  })
})
