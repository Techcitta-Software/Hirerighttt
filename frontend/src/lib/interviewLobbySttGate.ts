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
  return null
}

export function lobbyEnterButtonLabel(params: { starting: boolean }): string {
  if (params.starting) return 'Joining interview room…'
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

  const vadOk = await options.waitVad(vadMaxMs)
  if (vadOk && isLobbyLocalSttReady(readSnapshot())) return { ok: true }

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
