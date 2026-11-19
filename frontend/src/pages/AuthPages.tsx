import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { HrIcon } from '../components/HrIcon'
import { PageLoader } from '../components/SignalLoader'
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE_TEXT, passwordRuleError } from '../lib/passwordRules'
import {
  clearProfileForEmail,
  findUserByEmail,
  getAccountPrefs,
  getProfile,
  getUser,
  login,
  logout,
  persistLoggedInUser,
  saveAccountPrefs,
  saveUser,
  updateUserEmail,
  updateUserPassword,
} from '../lib/store'
import {
  apiConnectionHint,
  apiHealth,
  apiLogin,
  apiLogout,
  apiSignup,
  getApiToken,
  setApiToken,
} from '../lib/api'
import { pullProfileFromApi, syncSessionFromApi } from '../lib/apiSync'
import { ensureNewJobseekerProfileOnServer } from '../lib/initCandidateProfile'
import { isValidPhone, normalizePhone } from '../lib/phone'
import { isAdminUser } from '../lib/adminAccess'
import { readInviteEmail } from '../lib/inviteReturn'
import { getDemoAccount, isDemoEmail } from '../lib/authDemo'
import { mirrorAccountToPostgres } from '../lib/accountMirror'
import { ensureApiSession } from '../lib/apiSession'
import { consumeSignupLoginHandoff, stashSignupLoginHandoff } from '../lib/authHandoff'
import {
  clearSessionValidationCache,
  reconcileAuthOnAuthPage,
  restoreOnboardingFromServer,
  resolveAuthenticatedDestination,
  setAuthInvalidMessage,
} from '../lib/authSession'
import { requireApiForAuth } from '../lib/authConfig'
import { isSupabaseEnabled } from '../lib/supabaseClient'
import { supabaseSignIn, supabaseSignOut, supabaseSignUp } from '../lib/supabaseAuth'
import { pullProfileFromSupabase } from '../lib/supabaseSync'
import { openSignOutModal } from '../lib/signOutModal'
import styles from './AuthPages.module.css'

type StoredUser = NonNullable<ReturnType<typeof getUser>>
type RoleType = 'jobseeker' | 'employer'

async function authenticateWithEmailPassword(
  targetEmail: string,
  password: string,
  expectedRole?: RoleType,
): Promise<{ user: StoredUser | null; error?: string }> {
  let authenticatedUser: StoredUser | null = null
  let supabaseRejected = false

  if (isSupabaseEnabled()) {
    const { error: sbErr } = await supabaseSignIn(targetEmail, password)
    if (!sbErr) {
      await pullProfileFromSupabase()
      authenticatedUser = getUser()
      if (await apiHealth()) {
        const profile = getProfile()
        const mirrorPhone =
          authenticatedUser?.phone ||
          (profile && 'phone' in profile ? String(profile.phone || '') : '') ||
          ''
        if (mirrorPhone) {
          try {
            await mirrorAccountToPostgres({
              name: authenticatedUser?.name || targetEmail.split('@')[0],
              email: targetEmail,
              password,
              role:
                authenticatedUser?.role ??
                expectedRole ??
                (targetEmail.includes('employer') ? 'employer' : 'jobseeker'),
              phone: mirrorPhone,
              companyName: authenticatedUser?.companyName,
            })
          } catch {
            // Postgres mirror optional when offline or already synced
          }
        }
      }
    } else {
      supabaseRejected = true
      const demo = getDemoAccount(targetEmail, password)
      if (!demo) {
        return { user: null, error: sbErr.message }
      }
    }
  }

  try {
    if (!authenticatedUser && (await apiHealth())) {
      try {
        const apiRes = await apiLogin(targetEmail, password, expectedRole)
        if (apiRes?.email) {
          const existing = findUserByEmail(targetEmail)
          const apiRole =
            apiRes.role === 'employer' || apiRes.role === 'jobseeker'
              ? apiRes.role
              : undefined
          authenticatedUser = persistLoggedInUser({
            id: apiRes.id || existing?.id || targetEmail,
            name: apiRes.name || existing?.name || targetEmail.split('@')[0],
            email: targetEmail,
            role:
              apiRole ??
              existing?.role ??
              expectedRole ??
              (targetEmail.includes('employer') || targetEmail.includes('admin')
                ? 'employer'
                : 'jobseeker'),
            companyName: apiRes.companyName || existing?.companyName,
            phone: apiRes.phone || existing?.phone,
            primaryOrganizationId:
              apiRes.primaryOrganizationId || existing?.primaryOrganizationId,
          })
          saveUser(
            {
              name: authenticatedUser.name,
              email: targetEmail,
              password,
              role: authenticatedUser.role,
              companyName: authenticatedUser.companyName,
              phone: authenticatedUser.phone,
            },
            true,
            false,
          )
          authenticatedUser = getUser()
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        if (message.toLowerCase().includes('role')) {
          return { user: null, error: message }
        }
      }
    }
  } catch {
    // Backend offline — local store below
  }

  // Browser-local accounts exist for offline development only; production always authenticates on the server.
  if (!authenticatedUser && !requireApiForAuth()) {
    authenticatedUser = login(targetEmail, password)
  }

  if (!authenticatedUser) {
    const demo = getDemoAccount(targetEmail, password)
    if (demo) {
      authenticatedUser = saveUser(
        {
          name: demo.name,
          email: demo.email,
          password: demo.password,
          role: demo.role,
          companyName: 'companyName' in demo ? demo.companyName : undefined,
        },
        true,
      )
    }
  }

  if (!authenticatedUser) {
    if (supabaseRejected && isDemoEmail(targetEmail)) {
      return {
        user: null,
        error: 'Demo sign-in failed. Start the API (npm run dev:all) or use Candidate quick login.',
      }
    }
    return {
      user: null,
      error: findUserByEmail(targetEmail)
        ? 'Email or password is incorrect.'
        : 'No account found for that email. Create one first.',
    }
  }

  await ensureApiSession()
  if (await apiHealth()) {
    await syncSessionFromApi()
    await pullProfileFromApi()
    if (authenticatedUser?.role !== 'employer') {
      await ensureNewJobseekerProfileOnServer()
    }
    authenticatedUser = getUser()
  }
  return { user: authenticatedUser }
}

type AuthMode = 'login' | 'signup'

/** Candidate / job seeker sign-up. Organization sign-up lives at /organizations/signup. */
/** Checklist tick for the dark auth panel (drawn icon instead of a text glyph). */
function CheckIcon() {
  return (
    <span className={styles.checkIcon} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function SignupPage() {
  const { search } = useLocation()
  const role = new URLSearchParams(search).get('role')
  if (role === 'employer' || role === 'recruiter' || role === 'vendor') {
    return <Navigate to="/organizations/signup" replace />
  }
  return <LoginPage initialMode="signup" fixedRole="jobseeker" />
}

/** Vendor / employer / recruiter organization sign-up. */
export function OrganizationSignupPage() {
  return <LoginPage initialMode="signup" fixedRole="employer" />
}

export function LoginPage({
  initialMode,
  fixedRole,
}: { initialMode?: AuthMode; fixedRole?: RoleType } = {}) {
  const navigate = useNavigate()
  const location = useLocation()

  const searchParamMode = new URLSearchParams(location.search).get('mode') as AuthMode | null
  const defaultMode: AuthMode =
    initialMode || searchParamMode || (location.pathname === '/signup' ? 'signup' : 'login')
  const [authMode, setAuthMode] = useState<AuthMode>(defaultMode)

  useEffect(() => {
    if (initialMode) {
      setAuthMode(initialMode)
    } else if (location.pathname === '/signup' || location.pathname === '/organizations/signup') {
      setAuthMode('signup')
    } else if (location.pathname === '/login') {
      setAuthMode('login')
    }
  }, [initialMode, location.pathname])

  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [loginEmail, setLoginEmail] = useState(
    () => new URLSearchParams(window.location.search).get('email') || readInviteEmail(),
  )
  const [loginPassword, setLoginPassword] = useState('')

  const explicitLogin = Boolean(
    (location.state as { explicitLogin?: boolean } | null)?.explicitLogin,
  )
  const onSignupPath =
    location.pathname === '/signup' || location.pathname === '/organizations/signup'
  const explicitSignup =
    onSignupPath ||
    Boolean((location.state as { explicitSignup?: boolean } | null)?.explicitSignup)

  // Already signed in: login can resume into workspace, but Get started /signup must always show
  // the signup form (never jump back to the last unfinished onboarding step).
  const [resumingSession, setResumingSession] = useState(
    () => !explicitLogin && !explicitSignup && Boolean(getUser() && getApiToken()),
  )

  // Prefill login after signup or navigation state
  useEffect(() => {
    const handoff = consumeSignupLoginHandoff()
    if (handoff) {
      setAuthMode('login')
      setLoginEmail(handoff.email)
      setLoginPassword(handoff.password)
      if (handoff.message) setSuccessMessage(handoff.message)
      return
    }
    const navState = location.state as {
      successMsg?: string
      prefillEmail?: string
      prefillPassword?: string
    } | null
    if (navState?.successMsg) setSuccessMessage(navState.successMsg)
    if (navState?.prefillEmail) setLoginEmail(navState.prefillEmail)
    if (navState?.prefillPassword) setLoginPassword(navState.prefillPassword)
  }, [location.state])

  // Signup state
  const searchRole = new URLSearchParams(location.search).get('role')
  const initialRole: RoleType =
    fixedRole ??
    (searchRole === 'employer' || searchRole === 'recruiter' || searchRole === 'vendor'
      ? 'employer'
      : 'jobseeker')
  const orgType = new URLSearchParams(location.search).get('type')
  const orgTypeCopy =
    orgType === 'college'
      ? { label: 'College / institution name', placeholder: 'Sunrise Institute of Technology' }
      : orgType === 'staffing'
        ? { label: 'Staffing company name', placeholder: 'Acme Staffing Partners' }
        : { label: 'Organization / company name', placeholder: 'Acme Talent Solutions' }
  const [signupRole, setSignupRole] = useState<RoleType>(initialRole)
  const [signupName, setSignupName] = useState('')
  const [signupPhone, setSignupPhone] = useState('')
  const [signupCompanyName, setSignupCompanyName] = useState('')
  const [signupEmail, setSignupEmail] = useState(
    () => new URLSearchParams(window.location.search).get('email') || readInviteEmail(),
  )
  const [signupPassword, setSignupPassword] = useState('')

  const [termsAgreed, setTermsAgreed] = useState(false)

  // Sync signup role if query parameters change
  useEffect(() => {
    if (fixedRole) {
      setSignupRole(fixedRole)
      return
    }
    const role = new URLSearchParams(location.search).get('role')
    if (role === 'employer' || role === 'recruiter' || role === 'vendor') {
      setSignupRole('employer')
    } else if (role === 'jobseeker' || role === 'candidate') {
      setSignupRole('jobseeker')
    }
  }, [location.search, fixedRole])

  function switchMode(newMode: AuthMode) {
    setAuthMode(newMode)
    setError('')
    if (newMode === 'signup') {
      setSuccessMessage('')
    }
    if (newMode === 'signup' && location.pathname === '/login') {
      window.history.replaceState(null, '', '/login?mode=signup')
    } else if (newMode === 'login' && location.pathname !== '/login') {
      window.history.replaceState(null, '', '/login')
    }
  }

  async function navigateAfterLogin(authenticatedUser: StoredUser, forcedPath?: string) {
    await restoreOnboardingFromServer()
    const from = (location.state as { from?: string })?.from
    navigate(resolveAuthenticatedDestination(authenticatedUser, from, forcedPath), {
      replace: true,
    })
  }

  function finishSignupAndShowLogin(email: string, password: string) {
    clearProfileForEmail(email)
    setApiToken(null)
    logout()
    clearSessionValidationCache()
    const message = 'Account created successfully. Sign in with your email and password to continue.'
    stashSignupLoginHandoff({ email, password, message })
    setAuthMode('login')
    setLoginEmail(email)
    setLoginPassword(password)
    setSuccessMessage(message)
    setError('')
    navigate('/login', { replace: true, state: { explicitLogin: true } })
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await reconcileAuthOnAuthPage({ explicitLogin, explicitSignup })
      if (cancelled) return
      if (result.action === 'redirect') {
        navigate(result.path, { replace: true })
        return
      }
      setResumingSession(false)
      if (result.action === 'invalid') {
        setAuthInvalidMessage(result.message)
        setError(result.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [location.pathname, navigate, explicitLogin, explicitSignup])

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault()
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setError('Enter your email and password to continue.')
      return
    }
    setError('')
    setLoading(true)
    const targetEmail = loginEmail.trim().toLowerCase()

    try {
      const roleParam = new URLSearchParams(location.search).get('role')
      const loginExpectedRole: RoleType | undefined =
        (roleParam === 'employer' || roleParam === 'recruiter' || roleParam === 'vendor'
          ? 'employer'
          : roleParam === 'jobseeker' || roleParam === 'candidate'
            ? 'jobseeker'
            : undefined)
      const { user, error: authError } = await authenticateWithEmailPassword(
        targetEmail,
        loginPassword,
        loginExpectedRole,
      )
      if (!user) {
        setError(authError ?? 'Sign-in failed.')
        return
      }
      navigateAfterLogin(user, isAdminUser() ? '/admin' : undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Check your details and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignupSubmit(event: FormEvent) {
    event.preventDefault()
    if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim()) {
      setError('Fill in all required fields to create your account.')
      return
    }
    if (signupRole === 'employer' && !signupCompanyName.trim()) {
      setError('Enter your vendor or company name.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail.trim())) {
      setError('Enter a valid email address.')
      return
    }
    const passwordError = passwordRuleError(signupPassword)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (!isValidPhone(signupPhone)) {
      setError('Enter a valid mobile number (10–15 digits, with country code if needed).')
      return
    }
    if (!termsAgreed) {
      setError('Please agree to the Terms of Use and Privacy Policy.')
      return
    }
    setError('')
    setLoading(true)

    try {
      if (isSupabaseEnabled()) {
        const { error: sbErr } = await supabaseSignUp({
          name: signupName.trim(),
          email: signupEmail.trim().toLowerCase(),
          password: signupPassword,
          role: signupRole,
          companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
          phone: signupPhone.trim() || undefined,
        })
        if (sbErr) {
          setError(sbErr.message)
          return
        }
        const phoneNorm = normalizePhone(signupPhone) || signupPhone.trim()
        try {
          await mirrorAccountToPostgres({
            name: signupName.trim(),
            email: signupEmail.trim().toLowerCase(),
            password: signupPassword,
            role: signupRole,
            phone: phoneNorm,
            companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
          })
        } catch (mirrorErr) {
          setError(
            mirrorErr instanceof Error
              ? mirrorErr.message
              : 'Your sign-in was created, but we could not finish setting up your profile. Please try signing in again.',
          )
          return
        }
        await supabaseSignOut()
        const phoneNormSb = normalizePhone(signupPhone) || signupPhone.trim()
        const createdEmailSb = signupEmail.trim().toLowerCase()
        saveUser(
          {
            name: signupName.trim(),
            email: createdEmailSb,
            password: signupPassword,
            role: signupRole,
            companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
            phone: phoneNormSb,
          },
          true,
          false,
        )
        finishSignupAndShowLogin(createdEmailSb, signupPassword)
        return
      } else if (await apiHealth()) {
        const phoneNorm = normalizePhone(signupPhone) || signupPhone.trim()
        const createdEmail = signupEmail.trim().toLowerCase()
        try {
          await apiSignup(signupName.trim(), createdEmail, signupPassword, {
            role: signupRole,
            companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
            phone: phoneNorm,
            storeSessionToken: false,
          })
        } catch (apiErr) {
          setError(
            apiErr instanceof Error
              ? apiErr.message
              : 'Could not create your account on the server.',
          )
          return
        }
        saveUser(
          {
            name: signupName.trim(),
            email: createdEmail,
            password: signupPassword,
            role: signupRole,
            companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
            phone: phoneNorm,
          },
          true,
          false,
        )
        finishSignupAndShowLogin(createdEmail, signupPassword)
        return
      } else if (requireApiForAuth()) {
        setError(apiConnectionHint())
        return
      }
      const createdEmailLocal = signupEmail.trim().toLowerCase()
      saveUser(
        {
          name: signupName.trim(),
          email: createdEmailLocal,
          password: signupPassword,
          role: signupRole,
          companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
          phone: normalizePhone(signupPhone) || signupPhone.trim(),
        },
        true,
        false,
      )
      finishSignupAndShowLogin(createdEmailLocal, signupPassword)
      return
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.')
    } finally {
      setLoading(false)
    }
  }

  if (resumingSession) {
    return <PageLoader label="Opening your workspace…" />
  }

  return (
    <div className={styles.splitPage}>
      {/* LEFT COLUMN: PDF Page 1 Branding */}
      <aside className={styles.splitLeft}>
        <div className={styles.splitLeftInner}>
          <BrandLogo to="/" size="lg" dark className={styles.brandLink} />

          <div className={styles.splitLeftCopy}>
            {authMode === 'signup' && signupRole === 'employer' ? (
              <>
                <p className={styles.leftHeadline}>
                  Hire with proof,
                  <br />
                  not guesswork.
                </p>
                <ul className={styles.leftChecklist}>
                  <li>
                    <CheckIcon />
                    <span>Screen every applicant with structured AI interviews</span>
                  </li>
                  <li>
                    <CheckIcon />
                    <span>Compare candidates on clear, bias-aware scorecards</span>
                  </li>
                  <li>
                    <CheckIcon />
                    <span>Share job links and manage your whole pipeline in one place</span>
                  </li>
                </ul>
              </>
            ) : authMode === 'signup' ? (
              <>
                <p className={styles.leftHeadline}>
                  Your future starts with
                  <br />
                  understanding you.
                </p>
                <ul className={styles.leftChecklist}>
                  <li>
                    <CheckIcon />
                    <span>Save your 360° Career View and come back anytime</span>
                  </li>
                  <li>
                    <CheckIcon />
                    <span>Follow your 30, 60 and 90 day action roadmap</span>
                  </li>
                  <li>
                    <CheckIcon />
                    <span>Track your progress as your insights improve</span>
                  </li>
                </ul>
              </>
            ) : (
              <>
                <p className={styles.leftHeadline}>
                  Pick up where your
                  <br />
                  career conversation
                  <br />
                  left off.
                </p>
                <p className={styles.leftSubtitle}>
                  Sign in to see your 360° Career View, your next steps and your progress.
                </p>
              </>
            )}
          </div>

          <p className={styles.leftFooter}>
            {authMode === 'signup'
              ? signupRole === 'employer'
                ? 'Built for hiring teams, agencies and vendors'
                : 'No resume required to get started'
              : 'Your personal AI career companion'}
          </p>
        </div>
      </aside>

      {/* RIGHT COLUMN: PDF Page 1 Form + Image 2 Quick Demo Access */}
      <main className={styles.splitRight}>
        <div className={styles.splitFormWrap}>
          {authMode === 'login' ? (
            /* LOGIN VIEW */
            <div className={styles.authContainer}>
              <header className={styles.formHeader}>
                <h1 className={styles.welcomeTitle}>Welcome</h1>
                <p className={styles.welcomeSub}>Sign in to continue your career journey.</p>
              </header>

              <form className={styles.loginForm} onSubmit={handleLoginSubmit}>
                {successMessage ? (
                  <div className={styles.successBanner} role="status">
                    <HrIcon name="check" size={16} />
                    <span>{successMessage}</span>
                  </div>
                ) : sessionStorage.getItem('hireright.intent') === 'upload_resume' ? (
                  <div className={styles.successBanner} role="status">
                    <HrIcon name="document" size={16} />
                    <span>Resume saved. Sign in to attach it to your profile automatically.</span>
                  </div>
                ) : null}

                {error && (
                  <div className={styles.errorBanner} role="alert">
                    {error}
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="login-email" className={styles.formLabel}>
                    Email address
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    spellCheck={false}
                    value={loginEmail}
                    placeholder="you@example.com"
                    onChange={(event) => setLoginEmail(event.target.value)}
                    autoComplete="email"
                    required
                    className={styles.formInput}
                  />
                </div>

                <div className={styles.formGroup}>
                  <div className={styles.labelRow}>
                    <label htmlFor="login-password" className={styles.formLabel}>
                      Password
                    </label>
                    <Link to="/forgot-password" className={styles.forgotLink}>
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    id="login-password"
                    type="password"
                    value={loginPassword}
                    placeholder="Enter your password"
                    onChange={(event) => setLoginPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    className={styles.formInput}
                  />
                </div>

                <button
                  type="submit"
                  className={styles.loginPillBtn}
                  disabled={loading}
                  aria-busy={loading || undefined}
                >
                  {loading ? (
                    <>
                      <span className="ds-spinner" aria-hidden="true" /> Signing in…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>

                <div className={styles.authLinksBelow}>
                  <p className={styles.subLinkLine}>
                    New to HireRighttt?{' '}
                    <button
                      type="button"
                      className={styles.switchModeLink}
                      onClick={() => switchMode('signup')}
                    >
                      Create an account
                    </button>
                  </p>
                  <p className={styles.subLinkLine}>
                    Hiring?{' '}
                    <Link to="/organizations/signup" className={styles.switchModeLink}>
                      Create an organization account
                    </Link>
                  </p>
                  <p className={styles.subLinkLine}>
                    Just exploring?{' '}
                    <Link to="/career-view" className={styles.discoveryLink}>
                      Start my career discovery
                    </Link>{' '}
                    <span className={styles.noResumeText}>— no resume required.</span>
                  </p>
                </div>
              </form>
            </div>
          ) : (
            /* SIGNUP VIEW */
            <div className={styles.authContainer}>
              <header className={styles.formHeader}>
                <h1 className={styles.welcomeTitle}>
                  {signupRole === 'employer' ? 'Create your organization account' : 'Create your account'}
                </h1>
                <p className={styles.welcomeSub}>
                  {signupRole === 'employer'
                    ? 'Set up your hiring workspace in under a minute.'
                    : 'It takes under a minute. You can begin your career discovery right after.'}
                </p>
              </header>

              <form className={styles.loginForm} onSubmit={handleSignupSubmit}>
                {sessionStorage.getItem('hireright.intent') === 'upload_resume' && (
                  <div className={styles.successBanner} role="status">
                    <HrIcon name="document" size={16} />
                    <span>Resume selected. Create your account to analyze your profile automatically.</span>
                  </div>
                )}

                {error && (
                  <div className={styles.errorBanner} role="alert">
                    {error}
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="signup-name" className={styles.formLabel}>
                    Full name
                  </label>
                  <input
                    id="signup-name"
                    type="text"
                    value={signupName}
                    placeholder="Your name"
                    onChange={(event) => setSignupName(event.target.value)}
                    autoComplete="name"
                    required
                    className={styles.formInput}
                  />
                </div>

                {signupRole === 'employer' && (
                  <div className={styles.formGroup}>
                    <label htmlFor="signup-company" className={styles.formLabel}>
                      {orgTypeCopy.label}
                    </label>
                    <input
                      id="signup-company"
                      type="text"
                      value={signupCompanyName}
                      placeholder={orgTypeCopy.placeholder}
                      onChange={(event) => setSignupCompanyName(event.target.value)}
                      required
                      className={styles.formInput}
                    />
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="signup-email" className={styles.formLabel}>
                    Email address
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    spellCheck={false}
                    value={signupEmail}
                    placeholder="you@example.com"
                    onChange={(event) => setSignupEmail(event.target.value)}
                    autoComplete="email"
                    required
                    className={styles.formInput}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="signup-phone" className={styles.formLabel}>
                    Mobile number <span className={styles.requiredMark}>(required)</span>
                  </label>
                  <input
                    id="signup-phone"
                    type="tel"
                    value={signupPhone}
                    placeholder="+91 98765 43210"
                    onChange={(event) => setSignupPhone(event.target.value)}
                    autoComplete="tel"
                    required
                    className={styles.formInput}
                  />
                  <p className={styles.fieldHint}>
                    {signupRole === 'employer'
                      ? 'Used for account security and hiring notifications.'
                      : 'Used for interview reminders and job applications.'}
                  </p>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="signup-pwd" className={styles.formLabel}>
                    Password
                  </label>
                  <input
                    id="signup-pwd"
                    type="password"
                    value={signupPassword}
                    placeholder={PASSWORD_RULE_TEXT}
                    onChange={(event) => setSignupPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    required
                    className={styles.formInput}
                  />
                </div>

                <label className={styles.termsRow}>
                  <input
                    type="checkbox"
                    checked={termsAgreed}
                    onChange={(e) => setTermsAgreed(e.target.checked)}
                    required
                  />
                  <span>
                    I agree to the{' '}
                    <Link to="/terms" className={styles.termsLink}>
                      Terms &amp; Conditions
                    </Link>{' '}
                    and have read the{' '}
                    <Link to="/privacy" className={styles.termsLink}>
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>

                <button
                  type="submit"
                  className={styles.loginPillBtn}
                  disabled={loading}
                  aria-busy={loading || undefined}
                >
                  {loading ? (
                    <>
                      <span className="ds-spinner" aria-hidden="true" /> Creating account…
                    </>
                  ) : (
                    'Create account'
                  )}
                </button>

                <div className={styles.authLinksBelow}>
                  <p className={styles.subLinkLine}>
                    Already have an account?{' '}
                    <button
                      type="button"
                      className={styles.switchModeLink}
                      onClick={() => switchMode('login')}
                    >
                      Sign in
                    </button>
                  </p>
                  <p className={styles.subLinkLine}>
                    {signupRole === 'employer' ? (
                      <>
                        Looking for a job?{' '}
                        <Link to="/signup" className={styles.switchModeLink}>
                          Candidate sign up
                        </Link>
                      </>
                    ) : (
                      <>
                        Hiring?{' '}
                        <Link to="/organizations/signup" className={styles.switchModeLink}>
                          Organization sign up
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}


export function SettingsPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(() => getUser())
  const [panel, setPanel] = useState<
    'menu' | 'security' | 'notifications' | 'privacy'
  >('menu')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Email & password
  const [email, setEmail] = useState(user?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Prefs
  const [prefs, setPrefs] = useState(() => getAccountPrefs())

  useEffect(() => {
    setUser(getUser())
    setPrefs(getAccountPrefs())
  }, [])

  function flash(ok: string) {
    setError('')
    setMessage(ok)
    window.setTimeout(() => setMessage(''), 2800)
  }

  function saveSecurity(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (!currentPassword) {
      setError('Enter your current password to make changes.')
      return
    }

    if (email.trim().toLowerCase() !== (user?.email ?? '')) {
      const result = updateUserEmail(email, currentPassword)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setUser(getUser())
    }

    if (newPassword || confirmPassword) {
      if (newPassword !== confirmPassword) {
        setError('New password and confirmation do not match.')
        return
      }
      const passwordError = passwordRuleError(newPassword)
      if (passwordError) {
        setError(passwordError)
        return
      }
      const result = updateUserPassword(currentPassword, newPassword)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNewPassword('')
      setConfirmPassword('')
    }

    setCurrentPassword('')
    flash('Account security updated.')
  }

  function saveNotifications(event: FormEvent) {
    event.preventDefault()
    const next = saveAccountPrefs(prefs)
    setPrefs(next)
    flash('Notification preferences saved.')
  }

  function savePrivacy(event: FormEvent) {
    event.preventDefault()
    const next = saveAccountPrefs(prefs)
    setPrefs(next)
    flash('Privacy settings saved.')
  }

  return (
    <div className={styles.settingsAppWrap}>
      <div className={styles.settingsBody}>
        <header className={styles.settingsHeader}>
          <h1 className={styles.settingsTitle}>Account settings</h1>
          <p className={styles.settingsSub}>
            Signed in as <strong>{user?.email ?? 'guest'}</strong>
            {user?.name ? ` · ${user.name}` : ''}
          </p>
        </header>

        {message && (
          <p className={styles.success} role="status">
            {message}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {panel === 'menu' && (
          <>
            <div className={styles.settingsCard}>
              <div className={styles.settingsList}>
                <button type="button" className={styles.settingsRow} onClick={() => setPanel('security')}>
                  <span className={styles.settingsRowText}>
                    <span className={styles.settingsRowTitle}>Email &amp; password</span>
                    <span className={styles.settingsRowMeta}>Change your sign-in email or password</span>
                  </span>
                  <HrIcon name="arrow-right" size={16} />
                </button>
                <button type="button" className={styles.settingsRow} onClick={() => setPanel('notifications')}>
                  <span className={styles.settingsRowText}>
                    <span className={styles.settingsRowTitle}>Notification preferences</span>
                    <span className={styles.settingsRowMeta}>Choose which emails we send you</span>
                  </span>
                  <HrIcon name="arrow-right" size={16} />
                </button>
                <button type="button" className={styles.settingsRow} onClick={() => setPanel('privacy')}>
                  <span className={styles.settingsRowText}>
                    <span className={styles.settingsRowTitle}>Privacy &amp; visibility</span>
                    <span className={styles.settingsRowMeta}>Control what employers and recruiters can see</span>
                  </span>
                  <HrIcon name="arrow-right" size={16} />
                </button>
              </div>
            </div>
            <div className={styles.settingsActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => navigate('/profile')}>
                View profile
              </button>
              <button type="button" className={styles.btnSecondary} onClick={openSignOutModal}>
                Sign out
              </button>
            </div>
          </>
        )}

        {panel === 'security' && (
          <section className={styles.settingsCard} aria-labelledby="settings-security-title">
            <header className={styles.settingsCardHeader}>
              <h2 id="settings-security-title" className={styles.settingsCardTitle}>
                Email &amp; password
              </h2>
              <p className={styles.settingsCardSub}>Enter your current password to save any change.</p>
            </header>
            <form onSubmit={saveSecurity}>
              <div className={styles.settingsFields}>
                <label>
                  Email
                  <input
                    type="email"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </label>
                <label>
                  Current password
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Leave blank to keep current"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <div className={styles.settingsFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => {
                    setPanel('menu')
                    setError('')
                  }}
                >
                  Back
                </button>
                <button type="submit" className={styles.btnPrimary}>
                  Save changes
                </button>
              </div>
            </form>
          </section>
        )}

        {panel === 'notifications' && (
          <section className={styles.settingsCard} aria-labelledby="settings-notifications-title">
            <header className={styles.settingsCardHeader}>
              <h2 id="settings-notifications-title" className={styles.settingsCardTitle}>
                Notification preferences
              </h2>
              <p className={styles.settingsCardSub}>Choose which emails we send you.</p>
            </header>
            <form onSubmit={saveNotifications}>
              <div className={styles.settingsFields}>
                {(
                  [
                    ['emailMatchAlerts', 'Email me about new role matches'],
                    ['interviewReminders', 'Remind me to finish or retake interviews'],
                    ['productTips', 'Send product tips and updates'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={prefs[key]}
                      onChange={(e) =>
                        setPrefs((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className={styles.settingsFooter}>
                <button type="button" className={styles.btnSecondary} onClick={() => setPanel('menu')}>
                  Back
                </button>
                <button type="submit" className={styles.btnPrimary}>
                  Save changes
                </button>
              </div>
            </form>
          </section>
        )}

        {panel === 'privacy' && (
          <section className={styles.settingsCard} aria-labelledby="settings-privacy-title">
            <header className={styles.settingsCardHeader}>
              <h2 id="settings-privacy-title" className={styles.settingsCardTitle}>
                Privacy &amp; visibility
              </h2>
              <p className={styles.settingsCardSub}>Control what employers and recruiters can see.</p>
            </header>
            <form onSubmit={savePrivacy}>
              <div className={styles.settingsFields}>
                {(
                  [
                    ['profileVisibleToEmployers', 'Make my profile visible to employers'],
                    ['shareScoreOnApplications', 'Share AI interview score on applications'],
                    ['showOnlineStatus', 'Show online status to recruiters'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={prefs[key]}
                      onChange={(e) =>
                        setPrefs((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className={styles.settingsFooter}>
                <button type="button" className={styles.btnSecondary} onClick={() => setPanel('menu')}>
                  Back
                </button>
                <button type="submit" className={styles.btnPrimary}>
                  Save changes
                </button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  )
}


export function LogoutPage() {
  const navigate = useNavigate()

  useEffect(() => {
    void (async () => {
      await supabaseSignOut()
      await apiLogout()
      logout()
      navigate('/', { replace: true })
    })()
  }, [navigate])

  return null
}
