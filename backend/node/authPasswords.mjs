import { scrypt as scryptCallback, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCallback)

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64)
  return `scrypt$${salt}$${key.toString('hex')}`
}
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string' || password.length > 1024) return false
  let actual
  let expected
  if (stored.startsWith('scrypt$')) {
    const [, salt, digest] = stored.split('$')
    if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(digest || '')) return false
    actual = await scrypt(password, salt, 64)
    expected = Buffer.from(digest, 'hex')
  } else {
    // Existing accounts are upgraded after a successful login.
    const [salt, digest] = stored.split('$')
    if (!salt || !/^[a-f0-9]{64}$/.test(digest || '')) return false
    actual = createHash('sha256').update(`${salt}:${password}`).digest()
    expected = Buffer.from(digest, 'hex')
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
