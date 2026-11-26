const SIGNUP_HANDOFF_KEY = 'hireright.signupLoginHandoff'

export type SignupLoginHandoff = {
  email: string
  /** Kept in memory only (never written to sessionStorage/localStorage), so it is gone after a reload. */
  password?: string
  message?: string
}

/** The password from the signup form lives only in this module's memory until the login page reads it. */
let pendingPassword: { email: string; password: string } | null = null

export function stashSignupLoginHandoff(payload: SignupLoginHandoff): void {
  const email = payload.email.trim().toLowerCase()
  pendingPassword = payload.password ? { email, password: payload.password } : null
  sessionStorage.setItem(SIGNUP_HANDOFF_KEY, JSON.stringify({ email, message: payload.message }))
}

export function consumeSignupLoginHandoff(): SignupLoginHandoff | null {
  const memory = pendingPassword
  pendingPassword = null
  try {
    const raw = sessionStorage.getItem(SIGNUP_HANDOFF_KEY)
    if (!raw) return null
    sessionStorage.removeItem(SIGNUP_HANDOFF_KEY)
    const parsed = JSON.parse(raw) as SignupLoginHandoff
    if (!parsed.email?.trim()) return null
    const email = parsed.email.trim().toLowerCase()
    return {
      email,
      password: memory && memory.email === email ? memory.password : undefined,
      message: parsed.message,
    }
  } catch {
    sessionStorage.removeItem(SIGNUP_HANDOFF_KEY)
    return null
  }
}
