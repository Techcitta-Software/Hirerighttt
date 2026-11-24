import { passwordRuleError } from './passwordRules'
import { isValidPhone } from './phone'

/** Per-field messages shown under each auth field (keys match the field order on screen). */
export type FieldErrors<K extends string> = Partial<Record<K, string>>

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emailFieldError(email: string): string | undefined {
  const value = email.trim()
  if (!value) return 'Enter your email address.'
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address, like name@example.com.'
  return undefined
}

export type LoginField = 'email' | 'password'

export function validateLoginFields(email: string, password: string): FieldErrors<LoginField> {
  const errors: FieldErrors<LoginField> = {}
  const emailError = emailFieldError(email)
  if (emailError) errors.email = emailError
  if (!password.trim()) errors.password = 'Enter your password.'
  return errors
}

export type SignupField = 'name' | 'company' | 'email' | 'phone' | 'password' | 'terms'

export function validateSignupFields(input: {
  name: string
  email: string
  phone: string
  password: string
  companyName: string
  needsCompany: boolean
  termsAgreed: boolean
}): FieldErrors<SignupField> {
  const errors: FieldErrors<SignupField> = {}
  if (!input.name.trim()) errors.name = 'Enter your full name.'
  if (input.needsCompany && !input.companyName.trim()) errors.company = 'Enter your organization name.'
  const emailError = emailFieldError(input.email)
  if (emailError) errors.email = emailError
  if (!input.phone.trim()) errors.phone = 'Enter your mobile number.'
  else if (!isValidPhone(input.phone)) errors.phone = 'Enter a valid mobile number (10–15 digits, with country code if needed).'
  if (!input.password.trim()) errors.password = 'Choose a password.'
  else {
    const rule = passwordRuleError(input.password)
    if (rule) errors.password = rule
  }
  if (!input.termsAgreed) errors.terms = 'Please agree to the Terms of Use and Privacy Policy.'
  return errors
}

/** First field (in on-screen order) that has an error, so focus can move there. */
export function firstInvalidField<K extends string>(errors: FieldErrors<K>, order: readonly K[]): K | undefined {
  return order.find((key) => Boolean(errors[key]))
}

/** True when the key event reports Caps Lock on (false when the browser cannot tell). */
export function capsLockOn(event: { getModifierState?: (key: 'CapsLock') => boolean }): boolean {
  try {
    return Boolean(event.getModifierState?.('CapsLock'))
  } catch {
    return false
  }
}
