/**
 * DeepFilterNet3 voice isolation (browser WASM) — runs on the mic stream before Silero VAD + Moonshine STT.
 * STT model is unchanged; only the audio fed to VAD is enhanced.
 */

import { DeepFilterNet3Core } from 'deepfilternet3-noise-filter'

export type DeepFilterVoiceStatus = 'disabled' | 'idle' | 'loading' | 'ready' | 'error'

export type DeepFilterVoiceState = {
  status: DeepFilterVoiceStatus
  stage: string
  activeOnStream: boolean
}

export type DeepFilterMediaSession = {
  stream: MediaStream
  /** True when DeepFilterNet3 is processing; false when passthrough raw mic. */
  isolationActive: boolean
  dispose: () => void
}

const SAMPLE_RATE = 48_000

function envFlagEnabled(raw: string | undefined, defaultOn = true): boolean {
  if (raw === undefined || raw === '') return defaultOn
  const v = raw.trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off'
}

function suppressionLevelFromEnv(): number {
  const raw = import.meta.env.VITE_DEEPFILTER_SUPPRESSION_LEVEL
  if (raw === undefined || raw === '') return 70
  const n = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(n)) return 70
  return Math.max(0, Math.min(100, n))
}

function assetConfigFromEnv(): { cdnUrl?: string } | undefined {
  const cdn = import.meta.env.VITE_DEEPFILTER_CDN_URL?.trim()
  return cdn ? { cdnUrl: cdn.replace(/\/+$/, '') } : undefined
}

export function isDeepFilterVoiceIsolationEnabled(): boolean {
  return envFlagEnabled(import.meta.env.VITE_ENABLE_DEEPFILTER_NET3, true)
}

export function isDeepFilterVoiceIsolationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof WebAssembly !== 'undefined'
  )
}

class DeepFilterVoiceIsolationService {
  private state: DeepFilterVoiceState = {
    status: isDeepFilterVoiceIsolationEnabled() ? 'idle' : 'disabled',
    stage: isDeepFilterVoiceIsolationEnabled() ? 'Idle' : 'Disabled',
    activeOnStream: false,
  }
  private listeners = new Set<(s: DeepFilterVoiceState) => void>()
  private preloadCore: DeepFilterNet3Core | null = null
  private preloadTimer: number | null = null

  getState(): DeepFilterVoiceState {
    return this.state
  }

  subscribe(listener: (s: DeepFilterVoiceState) => void) {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  startGradualPreloadAfterLogin(delayMs = 4000) {
    if (!isDeepFilterVoiceIsolationEnabled() || !isDeepFilterVoiceIsolationSupported()) return
    if (this.state.status === 'ready' || this.state.status === 'loading') return
    if (this.preloadTimer) return

    this.preloadTimer = window.setTimeout(() => {
      this.preloadTimer = null
      void this.preloadAssets()
    }, delayMs)
  }

  async preloadAssets(): Promise<boolean> {
    if (!isDeepFilterVoiceIsolationEnabled() || !isDeepFilterVoiceIsolationSupported()) {
      this.patchState({ status: 'disabled', stage: 'Disabled' })
      return false
    }
    if (this.state.status === 'ready') return true

    try {
      this.patchState({ status: 'loading', stage: 'Loading DeepFilterNet3…' })
      const core = this.createCore()
      await core.initialize()
      this.preloadCore = core
      this.patchState({ status: 'ready', stage: 'DeepFilterNet3 ready' })
      return true
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'DeepFilterNet3 failed to load'
      console.warn('[DeepFilterNet3]', message)
      this.preloadCore = null
      this.patchState({ status: 'error', stage: message })
      return false
    }
  }

  /**
   * Build an interview MediaStream with DeepFilterNet3 on the mic when available.
   * Falls back to the raw stream on error (Moonshine STT unchanged).
   */
  async attachToMediaStream(raw: MediaStream): Promise<DeepFilterMediaSession> {
    const passthrough = (): DeepFilterMediaSession => ({
      stream: raw,
      isolationActive: false,
      dispose: () => undefined,
    })

    if (!isDeepFilterVoiceIsolationEnabled() || !isDeepFilterVoiceIsolationSupported()) {
      return passthrough()
    }

    const rawAudio = raw.getAudioTracks()[0]
    if (!rawAudio) return passthrough()

    let core = this.preloadCore
    if (!core || this.state.status === 'error') {
      const ok = await this.preloadAssets()
      if (!ok) return passthrough()
      core = this.preloadCore
    }
    if (!core) return passthrough()

    const sessionCore = this.createCore()
    try {
      await sessionCore.initialize()
    } catch (err) {
      console.warn('[DeepFilterNet3] session init failed', err)
      return passthrough()
    }

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
    try {
      if (audioContext.state !== 'running') {
        await audioContext.resume()
      }

      const workletNode = await sessionCore.createAudioWorkletNode(audioContext)
      sessionCore.setSuppressionLevel(suppressionLevelFromEnv())

      const destination = audioContext.createMediaStreamDestination()
      const sourceNode = audioContext.createMediaStreamSource(
        new MediaStream([rawAudio]),
      )
      sourceNode.connect(workletNode).connect(destination)

      const processedTrack = destination.stream.getAudioTracks()[0]
      if (!processedTrack) {
        throw new Error('DeepFilterNet3 produced no audio track')
      }

      const videoTracks = raw.getVideoTracks()
      const stream = new MediaStream([...videoTracks, processedTrack])

      this.patchState({
        status: 'ready',
        stage: 'Voice isolation active',
        activeOnStream: true,
      })

      return {
        stream,
        isolationActive: true,
        dispose: () => {
          try {
            sourceNode.disconnect()
            workletNode.disconnect()
            destination.disconnect()
          } catch {
            // ignore
          }
          sessionCore.destroy()
          void audioContext.close()
          try {
            rawAudio.stop()
          } catch {
            // ignore
          }
          this.patchState({
            activeOnStream: false,
            stage: 'DeepFilterNet3 ready',
          })
        },
      }
    } catch (err) {
      console.warn('[DeepFilterNet3] graph failed', err)
      sessionCore.destroy()
      void audioContext.close()
      this.patchState({
        status: 'error',
        stage: err instanceof Error ? err.message : 'Voice isolation unavailable',
        activeOnStream: false,
      })
      return passthrough()
    }
  }

  private createCore(): DeepFilterNet3Core {
    return new DeepFilterNet3Core({
      sampleRate: SAMPLE_RATE,
      noiseReductionLevel: suppressionLevelFromEnv(),
      assetConfig: assetConfigFromEnv(),
    })
  }

  private patchState(partial: Partial<DeepFilterVoiceState>) {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach((fn) => fn(this.state))
  }
}

export const deepFilterVoiceIsolation = new DeepFilterVoiceIsolationService()

export function deepFilterVoiceIsolationHint(_active = false): string {
  return 'Pause when you finish speaking to advance to the next question.'
}
