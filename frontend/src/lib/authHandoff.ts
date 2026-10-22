const SIGNUP_HANDOFF_KEY = 'hireright.signupLoginHandoff'

export type SignupLoginHandoff = {
  email: string
  password: string
  message?: string
}

export function stashSignupLoginHandoff(payload: SignupLoginHandoff): void {
  sessionStorage.setItem(SIGNUP_HANDOFF_KEY, JSON.stringify(payload))
}

export function consumeSignupLoginHandoff(): SignupLoginHandoff | null {
  try {
    const raw = sessionStorage.getItem(SIGNUP_HANDOFF_KEY)
    if (!raw) return null
    sessionStorage.removeItem(SIGNUP_HANDOFF_KEY)
    const parsed = JSON.parse(raw) as SignupLoginHandoff
    if (!parsed.email?.trim() || !parsed.password) return null
    return {
      email: parsed.email.trim().toLowerCase(),
      password: parsed.password,
      message: parsed.message,
    }
  } catch {
    sessionStorage.removeItem(SIGNUP_HANDOFF_KEY)
    return null
  }
}
