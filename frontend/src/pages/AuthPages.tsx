import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { HrIcon } from '../components/HrIcon'
import { PageLoader } from '../components/SignalLoader'
import { PasswordInput } from '../components/PasswordInput'
import {
  emailFieldError,
  firstInvalidField,
  validateLoginFields,
  validateSignupFields,
  type FieldErrors,
  type LoginField,
  type SignupField,
} from '../lib/authFormValidation'
import { getPendingJob } from '../lib/pendingJobApply'
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE_TEXT, passwordRuleError } from '../lib/passwordRules'
import {
  accountDisplayName,
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
  setLocalOfflinePassword,
} from '../lib/store'
import {
  apiConnectionHint,
  apiHealth,
  apiLogin,
  apiChangePassword,
  apiLogout,
  apiSignup,
  getApiToken,
  setApiToken,
} from '../lib/api'
import { pullProfileFromApi, syncSessionFromApi } from '../lib/apiSync'
import { ensureNewJobseekerProfileOnServer } from '../lib/initCandidateProfile'
import { normalizePhone } from '../lib/phone'
import { isAdminUser } from '../lib/adminAccess'
import { peekInviteReturn, readInviteEmail } from '../lib/inviteReturn'
import { getDemoAccount, isDemoEmail } from '../lib/authDemo'
import { mirrorAccountToPostgres } from '../lib/accountMirror'
import { ensureApiSession } from '../lib/apiSession'
import { isVisibleToEmployers, saveProfileVisibility } from '../lib/candidatePrivacy'
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
  const normalizedEmail = targetEmail.trim().toLowerCase()
  const active = getUser()
  if (active && active.email.trim().toLowerCase() !== normalizedEmail) {
    // Drop stale session so role checks cannot send the new login to the wrong dashboard.
    logout()
    setApiToken(null)
    clearSessionValidationCache()
  }

  let authenticatedUser: StoredUser | null = null
  let supabaseRejected = false
  // The server's own rejection message ("Email or password is incorrect."), shown instead of a guess from the
  // browser's local account list, which wrongly said "No account found" for real accounts with a wrong password.
  let serverRejection = ''

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
        serverRejection = message
      }
    }
  } catch {
    // Backend offline — local store below
  }

  // Browser-local accounts exist for offline development only; production always authenticates on the server.
  if (!authenticatedUser && !requireApiForAuth()) {
    authenticatedUser = await login(targetEmail, password)
  }

  if (!authenticatedUser) {
    const demo = getDemoAccount(targetEmail, password)
    if (demo) {
      authenticatedUser = saveUser(
        {
          name: demo.name,
          email: demo.email,
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
      error: serverRejection || loginFailureMessage(targetEmail),
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

/** Fallback message when no server answered (offline / local accounts only). */
function loginFailureMessage(targetEmail: string) {
  return findUserByEmail(targetEmail)
    ? 'Email or password is incorrect.'
    : 'No account found for that email. Create one first.'
}

type AuthMode = 'login' | 'signup'

const SIGNUP_FIELD_ORDER = ['name', 'company', 'email', 'phone', 'password', 'terms'] as const
const SIGNUP_FIELD_IDS: Record<SignupField, string> = {
  name: 'signup-name',
  company: 'signup-company',
  email: 'signup-email',
  phone: 'signup-phone',
  password: 'signup-pwd',
  terms: 'signup-terms',
}

/** Inline message under a field; the id is wired to the field's aria-describedby. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className={styles.fieldError}>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.75v3.75M8 10.9v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {message}
    </p>
  )
}

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
  const [loginErrors, setLoginErrors] = useState<FieldErrors<LoginField>>({})
  const [signupErrors, setSignupErrors] = useState<FieldErrors<SignupField>>({})
  const formRef = useRef<HTMLFormElement | null>(null)
  // Synchronous guard: `loading` state is not updated yet when Enter is pressed twice in the same tick.
  const submittingRef = useRef(false)
  // Where the visitor came from (a recruiter's job link or an emailed interview invite): shown above the form so
  // signing in clearly continues that journey. Read once; the stores themselves are untouched here.
  const [arrivalContext] = useState(() => {
    const job = getPendingJob()
    if (job && fixedRole !== 'employer') return { kind: 'job' as const, title: job.title, company: job.company }
    if (peekInviteReturn()) return { kind: 'invite' as const }
    return null
  })

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
      if (handoff.password) setLoginPassword(handoff.password)
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
    setLoginErrors({})
    setSignupErrors({})
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
    if (loading || submittingRef.current) return
    const fieldErrors = validateLoginFields(loginEmail, loginPassword)
    const firstInvalid = firstInvalidField(fieldErrors, ['email', 'password'] as const)
    if (firstInvalid) {
      setLoginErrors(fieldErrors)
      setError('')
      focusField(firstInvalid === 'email' ? 'login-email' : 'login-password')
      return
    }
    setLoginErrors({})
    setError('')
    submittingRef.current = true
    setLoading(true)
    const targetEmail = loginEmail.trim().toLowerCase()

    try {
      const roleParam = new URLSearchParams(location.search).get('role')
      const loginExpectedRole: RoleType | undefined =
        (roleParam === 'employer' || roleParam === 'recruiter' || roleParam === 'vendor'
          ? 'employer'
          : roleParam === 'jobseeker' || roleParam === 'candidate'
            ? 'jobseeker'
            : targetEmail.includes('employer') || targetEmail.includes('admin')
              ? 'employer'
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
      submittingRef.current = false
      setLoading(false)
    }
  }

  async function handleSignupSubmit(event: FormEvent) {
    event.preventDefault()
    if (loading || submittingRef.current) return
    const fieldErrors = validateSignupFields({
      name: signupName,
      email: signupEmail,
      phone: signupPhone,
      password: signupPassword,
      companyName: signupCompanyName,
      needsCompany: signupRole === 'employer',
      termsAgreed,
    })
    const firstInvalid = firstInvalidField(fieldErrors, SIGNUP_FIELD_ORDER)
    if (firstInvalid) {
      setSignupErrors(fieldErrors)
      setError('')
      focusField(SIGNUP_FIELD_IDS[firstInvalid])
      return
    }
    setSignupErrors({})
    setError('')
    submittingRef.current = true
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
          role: signupRole,
          companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
          phone: normalizePhone(signupPhone) || signupPhone.trim(),
        },
        true,
        false,
      )
      // Offline-only account: keep a salted digest (never the password) so it can sign in again in this browser.
      await setLocalOfflinePassword(createdEmailLocal, signupPassword)
      finishSignupAndShowLogin(createdEmailLocal, signupPassword)
      return
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  function clearSignupError(field: SignupField) {
    if (signupErrors[field]) setSignupErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  /** aria + class wiring for a plain signup <input> (password uses PasswordInput's own props). */
  function invalidProps(field: SignupField, hintId?: string) {
    const message = signupErrors[field]
    return {
      'aria-invalid': message ? true : undefined,
      'aria-describedby': message ? `${SIGNUP_FIELD_IDS[field]}-error` : hintId,
      className: `${styles.formInput} ${message ? styles.formInputInvalid : ''}`,
    }
  }

  function focusField(id: string) {
    window.requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>(`#${id}`) ?? document.getElementById(id)
      el?.focus()
    })
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
                <h1 className={styles.welcomeTitle}>Sign in to HireRighttt</h1>
                <p className={styles.welcomeSub}>One sign-in for candidates and hiring teams.</p>
              </header>

              {arrivalContext ? (
                <div className={styles.contextBanner} role="note">
                  <HrIcon name={arrivalContext.kind === 'job' ? 'briefcase' : 'calendar'} size={18} />
                  <p>
                    {arrivalContext.kind === 'job' ? (
                      <>
                        You’re applying for <strong>{arrivalContext.title}</strong>
                        {arrivalContext.company ? (
                          <>
                            {' '}at <strong>{arrivalContext.company}</strong>
                          </>
                        ) : null}
                        . Sign in to continue your application.
                      </>
                    ) : (
                      <>Sign in to open your interview invitation. You’ll go straight back to it.</>
                    )}
                  </p>
                </div>
              ) : null}

              <form
                ref={formRef}
                className={styles.loginForm}
                onSubmit={handleLoginSubmit}
                noValidate
                aria-busy={loading || undefined}
              >
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
                  <div className={styles.errorBanner} role="alert" id="login-error">
                    <HrIcon name="alert" size={16} />
                    <span>{error}</span>
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="login-email" className={styles.formLabel}>
                    Email address
                  </label>
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={loginEmail}
                    placeholder="you@example.com"
                    onChange={(event) => {
                      setLoginEmail(event.target.value)
                      if (loginErrors.email) setLoginErrors((prev) => ({ ...prev, email: undefined }))
                    }}
                    onBlur={() => {
                      // Only flag a malformed address once something was typed; empty is checked on submit.
                      if (loginEmail.trim()) {
                        setLoginErrors((prev) => ({ ...prev, email: emailFieldError(loginEmail) }))
                      }
                    }}
                    autoComplete="email"
                    required
                    aria-invalid={loginErrors.email ? true : undefined}
                    aria-describedby={loginErrors.email ? 'login-email-error' : undefined}
                    className={`${styles.formInput} ${loginErrors.email ? styles.formInputInvalid : ''}`}
                  />
                  <FieldError id="login-email-error" message={loginErrors.email} />
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
                  <PasswordInput
                    id="login-password"
                    name="password"
                    value={loginPassword}
                    placeholder="Enter your password"
                    onChange={(event) => {
                      setLoginPassword(event.target.value)
                      if (loginErrors.password) setLoginErrors((prev) => ({ ...prev, password: undefined }))
                    }}
                    autoComplete="current-password"
                    required
                    aria-invalid={loginErrors.password || error ? true : undefined}
                    aria-describedby={
                      loginErrors.password ? 'login-password-error' : error ? 'login-error' : undefined
                    }
                    inputClassName={`${styles.formInput} ${loginErrors.password ? styles.formInputInvalid : ''}`}
                  />
                  <FieldError id="login-password-error" message={loginErrors.password} />
                </div>

                <button type="submit" className={styles.loginPillBtn} disabled={loading}>
                  {loading ? (
                    <>
                      <span className="ds-spinner" aria-hidden="true" /> Signing in…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>
                <span className="ds-sr-only" role="status" aria-live="polite">
                  {loading ? 'Signing you in' : ''}
                </span>
              </form>

              <div className={styles.authLinksBelow}>
                <p className={styles.subLinkLine}>
                  New to HireRighttt?{' '}
                  <button
                    type="button"
                    className={styles.switchModeLink}
                    onClick={() => switchMode('signup')}
                  >
                    Create a free account
                  </button>
                </p>
                <p className={styles.subLinkLine}>
                  Just exploring?{' '}
                  <Link to="/career-view" className={styles.discoveryLink}>
                    See the 360° Career View
                  </Link>
                </p>
              </div>

              <div className={styles.orgCallout}>
                <p className={styles.orgCalloutText}>
                  <strong>Hiring?</strong> Set up a workspace for your team.
                </p>
                <Link to="/organizations/signup" className={styles.orgCalloutLink}>
                  Create an organization account
                  <HrIcon name="arrow-right" size={16} />
                </Link>
              </div>
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

              {arrivalContext && signupRole !== 'employer' ? (
                <div className={styles.contextBanner} role="note">
                  <HrIcon name={arrivalContext.kind === 'job' ? 'briefcase' : 'calendar'} size={18} />
                  <p>
                    {arrivalContext.kind === 'job' ? (
                      <>
                        You’re applying for <strong>{arrivalContext.title}</strong>
                        {arrivalContext.company ? (
                          <>
                            {' '}at <strong>{arrivalContext.company}</strong>
                          </>
                        ) : null}
                        . Create your account to continue your application.
                      </>
                    ) : (
                      <>Create your account to open your interview invitation.</>
                    )}
                  </p>
                </div>
              ) : null}

              <form
                ref={formRef}
                className={styles.loginForm}
                onSubmit={handleSignupSubmit}
                noValidate
                aria-busy={loading || undefined}
              >
                {sessionStorage.getItem('hireright.intent') === 'upload_resume' && (
                  <div className={styles.successBanner} role="status">
                    <HrIcon name="document" size={16} />
                    <span>Resume selected. Create your account to analyze your profile automatically.</span>
                  </div>
                )}

                {error && (
                  <div className={styles.errorBanner} role="alert">
                    <HrIcon name="alert" size={16} />
                    <span>{error}</span>
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="signup-name" className={styles.formLabel}>
                    Full name
                  </label>
                  <input
                    id="signup-name"
                    name="name"
                    type="text"
                    value={signupName}
                    placeholder="Your name"
                    onChange={(event) => {
                      setSignupName(event.target.value)
                      clearSignupError('name')
                    }}
                    autoComplete="name"
                    required
                    {...invalidProps('name')}
                  />
                  <FieldError id="signup-name-error" message={signupErrors.name} />
                </div>

                {signupRole === 'employer' && (
                  <div className={styles.formGroup}>
                    <label htmlFor="signup-company" className={styles.formLabel}>
                      {orgTypeCopy.label}
                    </label>
                    <input
                      id="signup-company"
                      name="organization"
                      type="text"
                      value={signupCompanyName}
                      placeholder={orgTypeCopy.placeholder}
                      onChange={(event) => {
                        setSignupCompanyName(event.target.value)
                        clearSignupError('company')
                      }}
                      autoComplete="organization"
                      required
                      {...invalidProps('company')}
                    />
                    <FieldError id="signup-company-error" message={signupErrors.company} />
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="signup-email" className={styles.formLabel}>
                    Email address
                  </label>
                  <input
                    id="signup-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={signupEmail}
                    placeholder="you@example.com"
                    onChange={(event) => {
                      setSignupEmail(event.target.value)
                      clearSignupError('email')
                    }}
                    onBlur={() => {
                      if (signupEmail.trim()) {
                        setSignupErrors((prev) => ({ ...prev, email: emailFieldError(signupEmail) }))
                      }
                    }}
                    autoComplete="email"
                    required
                    {...invalidProps('email')}
                  />
                  <FieldError id="signup-email-error" message={signupErrors.email} />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="signup-phone" className={styles.formLabel}>
                    Mobile number
                  </label>
                  <input
                    id="signup-phone"
                    name="tel"
                    type="tel"
                    inputMode="tel"
                    value={signupPhone}
                    placeholder="+91 98765 43210"
                    onChange={(event) => {
                      setSignupPhone(event.target.value)
                      clearSignupError('phone')
                    }}
                    autoComplete="tel"
                    required
                    {...invalidProps('phone', 'signup-phone-hint')}
                  />
                  {signupErrors.phone ? (
                    <FieldError id="signup-phone-error" message={signupErrors.phone} />
                  ) : (
                    <p className={styles.fieldHint} id="signup-phone-hint">
                      {signupRole === 'employer'
                        ? 'Used for account security and hiring notifications.'
                        : 'Used for interview reminders and job applications.'}
                    </p>
                  )}
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="signup-pwd" className={styles.formLabel}>
                    Password
                  </label>
                  <PasswordInput
                    id="signup-pwd"
                    name="new-password"
                    value={signupPassword}
                    placeholder="Create a password"
                    onChange={(event) => {
                      setSignupPassword(event.target.value)
                      clearSignupError('password')
                    }}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    required
                    aria-invalid={signupErrors.password ? true : undefined}
                    aria-describedby={signupErrors.password ? 'signup-pwd-error' : 'signup-pwd-hint'}
                    inputClassName={`${styles.formInput} ${signupErrors.password ? styles.formInputInvalid : ''}`}
                  />
                  {signupErrors.password ? (
                    <FieldError id="signup-pwd-error" message={signupErrors.password} />
                  ) : (
                    <p className={styles.fieldHint} id="signup-pwd-hint">
                      {PASSWORD_RULE_TEXT}.
                    </p>
                  )}
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.termsRow} htmlFor="signup-terms">
                    <input
                      id="signup-terms"
                      type="checkbox"
                      checked={termsAgreed}
                      onChange={(e) => {
                        setTermsAgreed(e.target.checked)
                        clearSignupError('terms')
                      }}
                      required
                      aria-invalid={signupErrors.terms ? true : undefined}
                      aria-describedby={signupErrors.terms ? 'signup-terms-error' : undefined}
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
                  <FieldError id="signup-terms-error" message={signupErrors.terms} />
                </div>

                <button type="submit" className={styles.loginPillBtn} disabled={loading}>
                  {loading ? (
                    <>
                      <span className="ds-spinner" aria-hidden="true" /> Creating account…
                    </>
                  ) : (
                    'Create account'
                  )}
                </button>
                <span className="ds-sr-only" role="status" aria-live="polite">
                  {loading ? 'Creating your account' : ''}
                </span>
              </form>

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
              </div>

              <div className={styles.orgCallout}>
                {signupRole === 'employer' ? (
                  <>
                    <p className={styles.orgCalloutText}>
                      <strong>Looking for a job?</strong> Candidates sign up here.
                    </p>
                    <Link to="/signup" className={styles.orgCalloutLink}>
                      Candidate sign up
                      <HrIcon name="arrow-right" size={16} />
                    </Link>
                  </>
                ) : (
                  <>
                    <p className={styles.orgCalloutText}>
                      <strong>Hiring?</strong> Set up a workspace for your team.
                    </p>
                    <Link to="/organizations/signup" className={styles.orgCalloutLink}>
                      Create an organization account
                      <HrIcon name="arrow-right" size={16} />
                    </Link>
                  </>
                )}
              </div>
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

  // Password (the sign-in email is shown read-only: changing it goes through support)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  // Prefs. "Visible to employers" is stored on the server profile (talent search honours it).
  const [prefs, setPrefs] = useState(() => ({
    ...getAccountPrefs(),
    profileVisibleToEmployers: isVisibleToEmployers(getProfile()),
  }))

  useEffect(() => {
    setUser(getUser())
    setPrefs({ ...getAccountPrefs(), profileVisibleToEmployers: isVisibleToEmployers(getProfile()) })
  }, [])

  function flash(ok: string) {
    setError('')
    setMessage(ok)
    window.setTimeout(() => setMessage(''), 2800)
  }

  async function saveSecurity(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setError('')
    setMessage('')

    if (!currentPassword) {
      setError('Enter your current password to make changes.')
      return
    }
    if (!newPassword) {
      setError('Enter a new password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    const passwordError = passwordRuleError(newPassword)
    if (passwordError) {
      setError(passwordError)
      return
    }
    setSaving(true)
    try {
      if (!(await ensureApiSession())) throw new Error('Your session expired. Sign in again to change your password.')
      const ok = await apiChangePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      flash(ok)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function saveNotifications(event: FormEvent) {
    event.preventDefault()
    const next = saveAccountPrefs(prefs)
    setPrefs(next)
    flash('Notification preferences saved.')
  }

  async function savePrivacy(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setError('')
    setSaving(true)
    try {
      if (user?.role === 'jobseeker') await saveProfileVisibility(prefs.profileVisibleToEmployers)
      const next = saveAccountPrefs(prefs)
      setPrefs(next)
      flash('Privacy settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your privacy settings. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.settingsAppWrap}>
      <div className={styles.settingsBody}>
        <header className={styles.settingsHeader}>
          <h1 className={styles.settingsTitle}>Account settings</h1>
          <p className={styles.settingsSub}>
            Signed in as <strong>{user?.email ?? 'guest'}</strong>
            {accountDisplayName(user) ? ` · ${accountDisplayName(user)}` : ''}
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
                    <span className={styles.settingsRowMeta}>See your sign-in email and change your password</span>
                  </span>
                  <HrIcon name="arrow-right" size={16} />
                </button>
                {/* Role matches, interview reminders and profile visibility are job-seeker settings (vendor QA). */}
                {user?.role === 'employer' ? null : (
                <>
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
                </>
                )}
              </div>
            </div>
            <div className={styles.settingsActions}>
              {/* Employers have no candidate profile: /profile only bounced them back to the dashboard. */}
              {user?.role === 'employer' ? null : (
                <button type="button" className={styles.btnSecondary} onClick={() => navigate('/profile')}>
                  View profile
                </button>
              )}
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
              <p className={styles.settingsCardSub}>
                Enter your current password, then a new one. {PASSWORD_RULE_TEXT}. Other devices are signed out.
              </p>
            </header>
            <form onSubmit={saveSecurity}>
              <div className={styles.settingsFields}>
                <label>
                  Email
                  <input
                    type="email"
                    spellCheck={false}
                    value={user?.email ?? ''}
                    readOnly
                    aria-describedby="settings-email-help"
                    autoComplete="username"
                  />
                  <span id="settings-email-help" className={styles.settingsRowMeta}>
                    To change your sign-in email, <Link to="/contact">contact support</Link>.
                  </span>
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
                    minLength={MIN_PASSWORD_LENGTH}
                    required
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
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
                <button type="submit" className={styles.btnPrimary} disabled={saving} aria-busy={saving || undefined}>
                  {saving ? 'Saving…' : 'Change password'}
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
                <button type="submit" className={styles.btnPrimary} disabled={saving} aria-busy={saving || undefined}>
                  {saving ? 'Saving…' : 'Save changes'}
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
