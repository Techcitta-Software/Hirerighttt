/** Normalize mobile for uniqueness checks (digits only, min 10). */
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return digits
}

export function isValidPhoneInput(raw) {
  return normalizePhone(raw) !== null
}

/** @param {{ phone?: string }[]} users */
export function findUserByPhone(users, rawPhone) {
  const norm = normalizePhone(rawPhone)
  if (!norm) return null
  return users.find((u) => normalizePhone(u.phone) === norm) || null
}
