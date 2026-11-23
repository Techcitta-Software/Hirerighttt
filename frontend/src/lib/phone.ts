export function normalizePhone(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return digits
}

export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw) !== null
}

export function findUserByPhone<T extends { phone?: string }>(users: T[], raw: string): T | undefined {
  const norm = normalizePhone(raw)
  if (!norm) return undefined
  return users.find((u) => normalizePhone(u.phone || '') === norm)
}

/** Read-only display: "919845012345" → "+91 98450 12345", "9845012345" → "98450 12345"; anything else as typed. */
export function formatPhoneForDisplay(raw: string): string {
  const value = String(raw || '').trim()
  const digits = value.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`
  return value
}
