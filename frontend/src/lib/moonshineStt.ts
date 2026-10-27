export type MoonshineStatus = 'idle' | 'downloading' | 'ready' | 'error'

export interface MoonshineState {
  status: MoonshineStatus
  percent: number
  stage: string
  lastLatencyMs?: number
}

class MoonshineSttService {
  private worker: Worker | null = null
  private state: MoonshineState = { status: 'idle', percent: 0, stage: 'Idle' }
  private listeners = new Set<(state: MoonshineState) => void>()
  private pending = new Map<
    string,
    {
      resolve: (res: { text: string; latencyMs: number }) => void
      reject: (err: Error) => void
    }
  >()
  private preloadTimer: number | null = null

  startGradualPreloadAfterLogin(delayMs = 3000) {
    if (typeof window === 'undefined') return
    if (this.state.status === 'ready' || this.state.status === 'downloading') return
    if (this.preloadTimer) return

    this.preloadTimer = window.setTimeout(() => {
      const idleRunner =
        (window as Window & { requestIdleCallback?: (cb: () => void) => number })
          .requestIdleCallback || ((cb: () => void) => window.setTimeout(cb, 500))
      idleRunner(() => {
        this.ensureWorker()
        this.updateState({ status: 'downloading', percent: 0, stage: 'Starting download…' })
        this.worker?.postMessage({ action: 'GRADUAL_PRELOAD' })
      })
    }, delayMs)
  }

  private ensureWorker() {
    if (this.worker) return

    this.worker = new Worker(new URL('./moonshineWorker.ts', import.meta.url), {
      type: 'module',
    })

    this.worker.onmessage = (e: MessageEvent) => {
      const { type, percent, stage, requestId, text, latencyMs, error } = e.data as {
        type?: string
        percent?: number
        stage?: string
        requestId?: string
        text?: string
        latencyMs?: number
        error?: string
      }

      if (type === 'PROGRESS') {
        this.updateState({
          status: 'downloading',
          percent: percent ?? 0,
          stage: stage || 'Downloading',
        })
      } else if (type === 'READY') {
        this.updateState({ status: 'ready', percent: 100, stage: 'Moonshine Tiny ready' })
      } else if (type === 'ERROR') {
        console.warn('[MoonshineSTT]', error)
        this.updateState({ status: 'error', percent: 0, stage: error || 'Error' })
      } else if (type === 'TRANSCRIPT_RESULT' && requestId) {
        this.updateState({ ...this.state, lastLatencyMs: latencyMs })
        const item = this.pending.get(requestId)
        if (item) {
          this.pending.delete(requestId)
          item.resolve({ text: text || '', latencyMs: latencyMs ?? 0 })
        }
      } else if (type === 'TRANSCRIPT_ERROR' && requestId) {
        const item = this.pending.get(requestId)
        if (item) {
          this.pending.delete(requestId)
          item.reject(new Error(error || 'Transcription failed'))
        }
      }
    }

    this.worker.onerror = (ev) => {
      console.warn('[MoonshineSTT] worker error', ev.message)
      this.updateState({ status: 'error', percent: 0, stage: ev.message || 'Worker error' })
    }
  }

  /** Wait until the worker model is ready (or failed / timed out). */
  waitUntilReady(maxMs = 120_000): Promise<boolean> {
    if (this.state.status === 'ready') return Promise.resolve(true)
    if (this.state.status === 'error') return Promise.resolve(false)

    this.ensureWorker()
    this.worker?.postMessage({ action: 'GRADUAL_PRELOAD' })

    return new Promise((resolve) => {
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        unsub()
        window.clearTimeout(timer)
        resolve(ok)
      }
      const unsub = this.subscribe((s) => {
        if (s.status === 'ready') finish(true)
        else if (s.status === 'error') finish(false)
      })
      const timer = window.setTimeout(() => finish(this.state.status === 'ready'), maxMs)
    })
  }

  async transcribeAudio(vadFloat32: Float32Array): Promise<{ text: string; latencyMs: number }> {
    this.ensureWorker()

    if (!vadFloat32 || vadFloat32.length < 4000) {
      return { text: '', latencyMs: 0 }
    }

    if (this.state.status !== 'ready') {
      const ok = await this.waitUntilReady(90_000)
      if (!ok) {
        throw new Error('Local speech model is still loading. Use the keyboard or wait a moment.')
      }
    }

    const requestId = `ms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const transferableCopy = new Float32Array(vadFloat32)

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.worker!.postMessage(
        { action: 'TRANSCRIBE', requestId, audioFloat32: transferableCopy },
        [transferableCopy.buffer],
      )
    })
  }

  getState(): MoonshineState {
    return this.state
  }

  subscribe(listener: (state: MoonshineState) => void) {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private updateState(next: MoonshineState) {
    this.state = next
    this.listeners.forEach((fn) => fn(this.state))
  }
}

export const moonshineStt = new MoonshineSttService()
