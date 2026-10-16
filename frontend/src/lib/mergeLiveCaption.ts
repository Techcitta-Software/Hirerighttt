/** Merge Groq phrase commits with fast browser interim lines for the live caption UI. */
export function mergeLiveCaption(
  groqCommitted: string,
  browserLive: string,
  groqPartial = '',
): string {
  const parts = [groqCommitted.trim(), groqPartial.trim(), browserLive.trim()].filter(Boolean)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Append new Groq text without duplicating overlapping prefixes (streaming chunks). */
export function appendGroqDelta(existing: string, incoming: string): string {
  const prev = existing.trim()
  const next = incoming.trim()
  if (!next) return prev
  if (!prev) return next
  if (next.startsWith(prev)) return next
  if (prev.endsWith(next)) return prev
  if (prev.includes(next)) return prev
  return `${prev} ${next}`.replace(/\s+/g, ' ').trim()
}
