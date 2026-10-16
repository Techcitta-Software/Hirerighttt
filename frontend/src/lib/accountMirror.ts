import { apiHealth, apiLogin, apiSignup } from './api'
import { normalizePhone } from './phone'

/** Ensure this account exists in Neon/Postgres (employer roster reads from there). */
export async function mirrorAccountToPostgres(options: {
  name: string
  email: string
  password: string
  role: 'jobseeker' | 'employer'
  phone?: string
  companyName?: string
}): Promise<void> {
  if (!(await apiHealth())) return
  const email = options.email.trim().toLowerCase()
  const phone = options.phone ? normalizePhone(options.phone) || options.phone.trim() : ''
  try {
    await apiSignup(options.name.trim(), email, options.password, {
      role: options.role,
      companyName: options.role === 'employer' ? options.companyName?.trim() : undefined,
      phone: phone || undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/already exists/i.test(msg)) {
      throw err
    }
  }
  try {
    await apiLogin(email, options.password, options.role)
  } catch {
    // login may still work via existing session
  }
}
