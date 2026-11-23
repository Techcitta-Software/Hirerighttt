import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  apiFetch: vi.fn(async () =>
    new Response(
      JSON.stringify({
        error: 'You have used your free interview. A retake costs ₹89.',
        code: 'RETAKE_PAYMENT_REQUIRED',
        priceInr: 89,
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } },
    ),
  ),
}))
vi.mock('./apiSession', () => ({ ensureApiSession: vi.fn(async () => true) }))
vi.mock('./interviewInviteGate', () => ({ readStoredInterviewInvite: () => null }))

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('interview start after the free interview is used', () => {
  it('surfaces the server payment message instead of the developer "GEMINI_API_KEY" error', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    const { startInterviewSession, RETAKE_PAYMENT_REQUIRED_ERROR } = await import('./interviewAgentClient')
    const err = await startInterviewSession('Frontend Developer', 'Mid', null).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe(RETAKE_PAYMENT_REQUIRED_ERROR)
    expect((err as Error).message).toContain('A retake costs ₹89')
    expect((err as Error).message).not.toContain('GEMINI_API_KEY')
  })
})
