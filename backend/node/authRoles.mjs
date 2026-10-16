/** @param {'employer' | 'jobseeker'} role */
export function validateEmployerSignup(role, companyName) {
  if (role !== 'employer') return null
  const name = String(companyName || '').trim()
  if (name.length < 2) {
    return 'Company or vendor name is required for employer (vendor) accounts.'
  }
  return null
}

/**
 * @param {'employer' | 'jobseeker' | undefined} expected
 * @param {'employer' | 'jobseeker' | undefined} actual
 */
export function loginRoleMismatchMessage(expected, actual) {
  if (!expected || !actual || expected === actual) return null
  if (expected === 'employer') {
    return 'This email is registered as a candidate account. Use candidate sign-in, or create an employer account with a different email and phone.'
  }
  return 'This email is registered as an employer (vendor) account. Sign in from the employer login or use a different email for candidate access.'
}
