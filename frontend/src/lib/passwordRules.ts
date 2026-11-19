/** The one password rule for every form that sets a password (sign-up, organisation sign-up, reset, settings). */
export const MIN_PASSWORD_LENGTH = 8

export const PASSWORD_RULE_TEXT = `At least ${MIN_PASSWORD_LENGTH} characters`

/** Returns an error message, or null when the password is long enough. */
export function passwordRuleError(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` : null
}
