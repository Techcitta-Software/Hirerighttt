/**
 * Plays the interviewer's neural voice (server-side text-to-speech) as it streams in.
 *
 * The server sends raw 16-bit PCM, mono, 24 kHz. Chunks are decoded and scheduled back to back on one
 * AudioContext, so the first words play about a second after the request and the rest follows without gaps.
 * If the voice cannot start (no key, quota used up, offline) `speakNeural` resolves `false` straight away and the
 * caller uses the browser's own voice instead; after a failure the neural path rests briefly so the next
 * question is not delayed by another doomed request.
 */
import { apiFetch } from './api'

const SAMPLE_RATE = 24_000
/** Wait this long for the first audio before giving up and using the device voice. */
const FIRST_AUDIO_TIMEOUT_MS = 6_000
/** After a failed start, skip the neural voice for this long. */
const REST_AFTER_FAILURE_MS = 60_000
/** Audio buffered before playback starts, so a slow network chunk does not cause a stutter. */
const PREROLL_SECONDS = 0.25

let restUntil = 0
let sharedContext: AudioContext | null = null

export function isNeuralVoiceEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.VITE_NEURAL_VOICE === 'false') return false
  if (!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)) return false
  return Date.now() >= restUntil
}

function audioContext(): AudioContext {
  if (sharedContext && sharedContext.state !== 'closed') return sharedContext
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  try {
    sharedContext = new Ctor({ sampleRate: SAMPLE_RATE })
  } catch {
    sharedContext = new Ctor()
  }
  return sharedContext
}

/** 16-bit little-endian PCM bytes -> floats in [-1, 1]. `bytes.length` must be even. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Float32Array(bytes.byteLength >> 1)
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

export type NeuralPlayback = {
  /** Stops the audio and the download. Safe to call more than once. */
  cancel: () => void
}

type Callbacks = { onStart?: () => void; onEnd?: () => void }

let active: { cancel: () => void } | null = null

export function cancelNeuralSpeech(): void {
  active?.cancel()
  active = null
}

/**
 * Speak `text` with the neural voice. Resolves `true` once speech has started (callbacks then report the
 * end), or `false` if it could not start, in which case no callback has fired and nothing is playing.
 */
export async function speakNeural(text: string, callbacks: Callbacks = {}): Promise<boolean> {
  if (!isNeuralVoiceEnabled() || !text.trim()) return false
  cancelNeuralSpeech()

  const controller = new AbortController()
  const sources = new Set<AudioBufferSourceNode>()
  let cancelled = false
  let streamDone = false
  let started = false
  let ended = false
  let nextTime = 0

  const ctx = audioContext()
  const finish = () => {
    if (ended) return
    ended = true
    if (active === handle) active = null
    callbacks.onEnd?.()
  }
  const handle: NeuralPlayback = {
    cancel: () => {
      if (cancelled) return
      cancelled = true
      controller.abort()
      for (const s of sources) {
        try {
          s.onended = null
          s.stop()
        } catch {
          /* already stopped */
        }
      }
      sources.clear()
    },
  }
  active = handle

  const maybeFinish = () => {
    if (!cancelled && streamDone && sources.size === 0) finish()
  }

  const firstAudioTimer = window.setTimeout(() => {
    if (!started) controller.abort()
  }, FIRST_AUDIO_TIMEOUT_MS)

  try {
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
    const res = await apiFetch('/api/interview/tts', {
      method: 'POST',
      body: JSON.stringify({ text }),
      signal: controller.signal,
      background: true,
    })
    if (!res.ok || !res.body) throw new Error(`tts ${res.status}`)

    const reader = res.body.getReader()
    let carry: Uint8Array | null = null
    let pending: Float32Array[] = []
    let pendingSeconds = 0

    const schedule = (samples: Float32Array) => {
      const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE)
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      nextTime = Math.max(nextTime, ctx.currentTime + 0.03)
      source.onended = () => {
        sources.delete(source)
        maybeFinish()
      }
      sources.add(source)
      source.start(nextTime)
      nextTime += buffer.duration
    }

    const flushPending = () => {
      for (const samples of pending) schedule(samples)
      pending = []
      pendingSeconds = 0
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (cancelled) return started
      if (done) break
      if (!value || value.length === 0) continue
      let bytes = value
      if (carry) {
        const joined = new Uint8Array(carry.length + bytes.length)
        joined.set(carry, 0)
        joined.set(bytes, carry.length)
        bytes = joined
        carry = null
      }
      if (bytes.length % 2 === 1) {
        carry = bytes.slice(bytes.length - 1)
        bytes = bytes.slice(0, bytes.length - 1)
      }
      if (!bytes.length) continue
      const samples = pcm16ToFloat32(bytes)

      if (!started) {
        pending.push(samples)
        pendingSeconds += samples.length / SAMPLE_RATE
        if (pendingSeconds >= PREROLL_SECONDS) {
          started = true
          window.clearTimeout(firstAudioTimer)
          flushPending()
          callbacks.onStart?.()
        }
      } else {
        schedule(samples)
      }
    }

    streamDone = true
    if (!started) {
      // A short sentence can end before the pre-roll fills: play what arrived.
      if (pending.length) {
        started = true
        flushPending()
        callbacks.onStart?.()
      } else {
        throw new Error('tts empty')
      }
    }
    maybeFinish()
    return true
  } catch {
    window.clearTimeout(firstAudioTimer)
    if (cancelled) return started
    if (!started) {
      restUntil = Date.now() + REST_AFTER_FAILURE_MS
      if (active === handle) active = null
      handle.cancel()
      return false
    }
    // The connection dropped after speech began: let what was queued finish, then report the end.
    streamDone = true
    maybeFinish()
    return true
  } finally {
    window.clearTimeout(firstAudioTimer)
  }
}
