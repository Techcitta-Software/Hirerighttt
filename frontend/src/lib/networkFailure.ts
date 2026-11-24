/** fetch() rejects with a TypeError when no response came, and with AbortError / TimeoutError when it was aborted. */
export function isNetworkFailure(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return err instanceof TypeError || name === 'AbortError' || name === 'TimeoutError'
}
