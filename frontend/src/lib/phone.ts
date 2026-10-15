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
