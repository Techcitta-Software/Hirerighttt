import type { MoonshineStatus } from './moonshineStt'

export type LobbySttSnapshot = {
  moonshineStatus: MoonshineStatus
  vadReady: boolean
}

export function isLobbyLocalSttReady(snapshot: LobbySttSnapshot): boolean {
  return snapshot.moonshineStatus === 'ready' && snapshot.vadReady
}

export function lobbyLocalSttBlockedReason(snapshot: LobbySttSnapshot): string | null {
  if (snapshot.moonshineStatus === 'error') {
    return 'Local voice AI failed to load. Refresh the page and try again.'
  }
  if (isLobbyLocalSttReady(snapshot)) return null
  if (!snapshot.vadReady) {
    return 'Preparing Silero voice detection on your device…'
  }
  if (snapshot.moonshineStatus === 'downloading') {
    return 'Downloading voice AI on your browser — stay on this screen until it finishes.'
  }
  return 'Starting local voice AI download on your browser…'
}

export function lobbyEnterButtonLabel(params: {
  starting: boolean
  waitingForLocalStt: boolean
  sttPercent: number
}): string {
  if (params.waitingForLocalStt) {
    if (params.sttPercent > 0) {
      return `Downloading voice AI… ${params.sttPercent}%`
    }
    return 'Downloading voice AI…'
  }
  if (params.starting) return 'Ava is preparing questions…'
  return 'Enter interview room'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Wait until Moonshine + Silero VAD are ready in the lobby (candidate stays on setup stage).
 */
export async function waitForLobbyLocalStt(
  readSnapshot: () => LobbySttSnapshot,
  options: {
    waitMoonshine: (maxMs: number) => Promise<boolean>
    waitVad: (maxMs: number) => Promise<boolean>
    moonshineMaxMs?: number
    vadMaxMs?: number
    pollMs?: number
    onPoll?: (snapshot: LobbySttSnapshot) => void
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const moonshineMaxMs = options.moonshineMaxMs ?? 300_000
  const vadMaxMs = options.vadMaxMs ?? 90_000
  const pollMs = options.pollMs ?? 200

  const initial = readSnapshot()
  if (isLobbyLocalSttReady(initial)) return { ok: true }
  if (initial.moonshineStatus === 'error') {
    return { ok: false, reason: lobbyLocalSttBlockedReason(initial)! }
  }

  options.onPoll?.(initial)

  const moonshineOk = await options.waitMoonshine(moonshineMaxMs)
  if (!moonshineOk) {
    const snap = readSnapshot()
    if (snap.moonshineStatus === 'error') {
      return { ok: false, reason: lobbyLocalSttBlockedReason(snap)! }
    }
    return {
      ok: false,
      reason: 'Voice AI download timed out. Check your connection and try again.',
    }
  }

  const vadDeadline = Date.now() + vadMaxMs
  while (Date.now() < vadDeadline) {
    const snap = readSnapshot()
    options.onPoll?.(snap)
    if (isLobbyLocalSttReady(snap)) return { ok: true }
    if (snap.moonshineStatus === 'error') {
      return { ok: false, reason: lobbyLocalSttBlockedReason(snap)! }
    }
    if (snap.vadReady && snap.moonshineStatus === 'ready') return { ok: true }
    await sleep(pollMs)
  }

  const final = readSnapshot()
  if (isLobbyLocalSttReady(final)) return { ok: true }
  return {
    ok: false,
    reason:
      lobbyLocalSttBlockedReason(final) ||
      'Voice detection did not start. Allow microphone access and try again.',
  }
}
