/** Only hard STT failures should switch the session to browser speech permanently. */
export function shouldStickToWebSpeechFallback(reason: string): boolean {
  const r = reason.trim().toLowerCase()
  if (!r) return false
  if (r.includes('no speech detected')) return false
  if (r.includes('that segment')) return false
  return true
}
