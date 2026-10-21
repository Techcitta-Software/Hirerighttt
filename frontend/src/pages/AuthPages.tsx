import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { HrIcon } from '../components/HrIcon'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { MotionButton } from '../motion/MotionButton'
import { easeOut, fadeUp } from '../motion/variants'
import {
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
import { apiConnectionHint, apiHealth, apiLogin, apiLogout, apiSignup } from '../lib/api'
import { pullProfileFromApi, syncSessionFromApi } from '../lib/apiSync'
import { ensureNewJobseekerProfileOnServer } from '../lib/initCandidateProfile'
import { isValidPhone, normalizePhone } from '../lib/phone'
import {
  DEMO_ADMIN,
  DEMO_CANDIDATE,
  DEMO_EMPLOYER,
  getDemoAccount,
  isDemoEmail,
} from '../lib/authDemo'
import { mirrorAccountToPostgres } from '../lib/accountMirror'
import { ensureApiSession } from '../lib/apiSession'
import {
  reconcileAuthOnAuthPage,
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

  if (!authenticatedUser) {
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

function AuthMarketingAside() {
  return (
    <aside className={styles.loginAside}>
      <span className={styles.asidePill}>HIRERIGHT™ COMMUNITY</span>
      <h2 className={styles.asideTitle}>
        Your Dream Job Deserves the <span className={styles.asideAccent}>Right</span> Start
      </h2>
      <p className={styles.asideLead}>
        Background screening you can trust. Confidence you can carry into your future — for job
        seekers and hiring teams worldwide.
      </p>
      <ul className={styles.asideFeatures}>
        <li>
          <span className={styles.featureIcon} aria-hidden>
            <HrIcon name="shield-check" size={14} />
          </span>
          Fast, secure checks &amp; AI interviews
        </li>
        <li>
          <span className={styles.featureIcon} aria-hidden>
            <HrIcon name="star" size={14} />
          </span>
          Trusted by top employers globally
        </li>
        <li>
          <span className={styles.featureIcon} aria-hidden>
            <HrIcon name="lock" size={14} />
          </span>
          Your privacy, always protected
        </li>
      </ul>
      <div className={styles.asideSocial}>
        <div className={styles.avatarStack}>
          {[1, 2, 3, 4].map((i) => (
            <img key={i} src={`/avatars/avatar${i}.jpg`} alt="" />
          ))}
        </div>
        <p>
          <strong>Trusted by 1000+ employers</strong>
          <br />
          and millions of job seekers worldwide.
        </p>
      </div>
    </aside>
  )
}

function AuthPageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SiteNav />
        <div className={styles.authStage}>
          <div className={styles.loginLayout}>
            <AuthMarketingAside />
            {children}
          </div>
        </div>
      </div>
      <SiteFooter showWorkflow={false} />
    </div>
  )
}

type AuthMode = 'login' | 'signup'

export function SignupPage() {
  return <LoginPage initialMode="signup" />
}

export function LoginPage({ initialMode }: { initialMode?: AuthMode } = {}) {
  const navigate = useNavigate()
  const location = useLocation()

  const searchParamMode = new URLSearchParams(location.search).get('mode') as AuthMode | null
  const defaultMode: AuthMode =
    initialMode || searchParamMode || (location.pathname === '/signup' ? 'signup' : 'login')
  const [authMode, setAuthMode] = useState<AuthMode>(defaultMode)

  useEffect(() => {
    if (initialMode) {
      setAuthMode(initialMode)
    } else if (location.pathname === '/signup') {
      setAuthMode('signup')
    } else if (location.pathname === '/login') {
      setAuthMode('login')
    }
  }, [initialMode, location.pathname])

  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)

  // Sync state passed via navigation
  useEffect(() => {
    const navState = location.state as {
      successMsg?: string
      prefillEmail?: string
      prefillPassword?: string
    } | null

    if (navState?.successMsg) {
      setSuccessMessage(navState.successMsg)
    }
    if (navState?.prefillEmail) {
      setLoginEmail(navState.prefillEmail)
    }
    if (navState?.prefillPassword) {
      setLoginPassword(navState.prefillPassword)
    }
  }, [location.state])

  // Login state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Signup state
  const searchRole = new URLSearchParams(location.search).get('role')
  const initialRole: RoleType =
    searchRole === 'employer' || searchRole === 'recruiter' || searchRole === 'vendor'
      ? 'employer'
      : 'jobseeker'
  const [signupRole, setSignupRole] = useState<RoleType>(initialRole)
  const [signupName, setSignupName] = useState('')
  const [signupPhone, setSignupPhone] = useState('')
  const [signupCompanyName, setSignupCompanyName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [termsAgreed, setTermsAgreed] = useState(false)

  // Sync signup role if query parameters change
  useEffect(() => {
    const role = new URLSearchParams(location.search).get('role')
    if (role === 'employer' || role === 'recruiter' || role === 'vendor') {
      setSignupRole('employer')
    } else if (role === 'jobseeker' || role === 'candidate') {
      setSignupRole('jobseeker')
    }
  }, [location.search])

  function switchMode(newMode: AuthMode) {
    setAuthMode(newMode)
    setError('')
    if (newMode === 'signup') {
      setSuccessMessage('')
    }
    if (newMode === 'signup' && location.pathname !== '/signup') {
      window.history.replaceState(null, '', '/login?mode=signup')
    } else if (newMode === 'login' && location.pathname !== '/login') {
      window.history.replaceState(null, '', '/login')
    }
  }

  function fillLoginCandidate() {
    setLoginEmail(DEMO_CANDIDATE.email)
    setLoginPassword(DEMO_CANDIDATE.password)
    setError('')
  }

  function fillLoginEmployer() {
    setLoginEmail(DEMO_EMPLOYER.email)
    setLoginPassword(DEMO_EMPLOYER.password)
    setError('')
    const params = new URLSearchParams(location.search)
    if (
      params.get('role') === 'jobseeker' ||
      params.get('role') === 'candidate'
    ) {
      params.delete('role')
      const qs = params.toString()
      window.history.replaceState(
        null,
        '',
        qs ? `${location.pathname}?${qs}` : location.pathname,
      )
    }
  }

  function fillLoginAdmin() {
    setLoginEmail(DEMO_ADMIN.email)
    setLoginPassword(DEMO_ADMIN.password)
    setError('')
  }

  function fillSignupCandidate() {
    setSignupRole('jobseeker')
    setSignupName('Arjun Sharma')
    setSignupPhone('+91 98765 43210')
    setSignupEmail('candidate@hireright.com')
    setSignupPassword('password123')
    setTermsAgreed(true)
    setError('')
  }

  function fillSignupVendor() {
    setSignupRole('employer')
    setSignupName('Sarah Jenkins')
    setSignupCompanyName('TechCitta Solutions')
    setSignupPhone('+91 98765 12345')
    setSignupEmail('vendor@hireright.com')
    setSignupPassword('password123')
    setTermsAgreed(true)
    setError('')
  }

  function navigateAfterLogin(authenticatedUser: StoredUser, forcedPath?: string) {
    const from = (location.state as { from?: string })?.from
    navigate(resolveAuthenticatedDestination(authenticatedUser, from, forcedPath), {
      replace: true,
    })
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await reconcileAuthOnAuthPage()
      if (cancelled) return
      if (result.action === 'redirect') {
        navigate(result.path, { replace: true })
        return
      }
      if (result.action === 'invalid') {
        setAuthInvalidMessage(result.message)
        setError(result.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [location.pathname, navigate])

  async function runQuickLogin(
    demo: typeof DEMO_CANDIDATE | typeof DEMO_EMPLOYER | typeof DEMO_ADMIN,
    forcedPath?: string,
  ) {
    setError('')
    setLoading(true)
    setLoginEmail(demo.email)
    setLoginPassword(demo.password)
    try {
      const { user, error: authError } = await authenticateWithEmailPassword(
        demo.email,
        demo.password,
      )
      if (!user) {
        setError(authError ?? 'Demo sign-in failed.')
        return
      }
      navigateAfterLogin(user, forcedPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign-in failed.')
    } finally {
      setLoading(false)
    }
  }

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
      const demoForLogin = getDemoAccount(targetEmail, loginPassword)
      const loginExpectedRole: RoleType | undefined =
        demoForLogin?.role ??
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
        setError(authError ?? 'Login failed.')
        return
      }
      const adminDemo =
        targetEmail === DEMO_ADMIN.email && loginPassword === DEMO_ADMIN.password
      navigateAfterLogin(user, adminDemo ? '/admin' : undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check details.')
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
    if (signupPassword.length < 6) {
      setError('Password must be at least 6 characters.')
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
              : 'Account created in auth, but could not sync to the hiring database.',
          )
          return
        }
        await ensureApiSession()
        await pullProfileFromSupabase()
      } else if (await apiHealth()) {
        const phoneNorm = normalizePhone(signupPhone) || signupPhone.trim()
        const createdEmail = signupEmail.trim().toLowerCase()
        let apiUser: Awaited<ReturnType<typeof apiSignup>> | null = null
        try {
          apiUser = await apiSignup(
            signupName.trim(),
            createdEmail,
            signupPassword,
            {
              role: signupRole,
              companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
              phone: phoneNorm,
            },
          )
        } catch (apiErr) {
          setError(
            apiErr instanceof Error
              ? apiErr.message
              : 'Could not create your account on the server.',
          )
          return
        }
        const sessionUser = persistLoggedInUser({
          id: apiUser?.id || createdEmail,
          name: apiUser?.name || signupName.trim(),
          email: createdEmail,
          role: apiUser?.role === 'employer' ? 'employer' : signupRole,
          companyName: apiUser?.companyName || signupCompanyName.trim() || undefined,
          phone: apiUser?.phone || phoneNorm,
          primaryOrganizationId: apiUser?.primaryOrganizationId,
        })
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
          true,
        )
        await syncSessionFromApi()
        if (signupRole === 'jobseeker') {
          await ensureNewJobseekerProfileOnServer()
          await pullProfileFromApi()
        }
        const signedIn = getUser() ?? sessionUser
        navigateAfterLogin(signedIn)
        return
      } else if (requireApiForAuth()) {
        setError(apiConnectionHint())
        return
      }
      saveUser(
        {
          name: signupName.trim(),
          email: signupEmail.trim().toLowerCase(),
          password: signupPassword,
          role: signupRole,
          companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
          phone: normalizePhone(signupPhone) || signupPhone.trim(),
        },
        true,
        true,
      )
      const signedInUser = getUser()
      if (signedInUser) {
        if (signedInUser.role === 'jobseeker') {
          await ensureNewJobseekerProfileOnServer()
        }
        navigateAfterLogin(signedInUser)
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.splitPage}>
      {/* LEFT COLUMN: PDF Page 1 Branding */}
      <aside className={styles.splitLeft}>
        <div className={styles.splitLeftInner}>
          <Link to="/" className={styles.brandLink} title="Back to HireRighttt Home">
            <img
              src="/logos/hirerighttt-logo-dark.svg"
              alt="HireRighttt — Talent to Talent"
              className={styles.brandLogoImg}
            />
          </Link>

          <div className={styles.splitLeftCopy}>
            {authMode === 'signup' ? (
              <>
                <h1 className={styles.leftHeadline}>
                  Your future starts with
                  <br />
                  understanding you.
                </h1>
                <ul className={styles.leftChecklist}>
                  <li>
                    <span className={styles.checkIcon}>✓</span>
                    <span>Save your 360° Career View and come back anytime</span>
                  </li>
                  <li>
                    <span className={styles.checkIcon}>✓</span>
                    <span>Follow your 30, 60 and 90 day action roadmap</span>
                  </li>
                  <li>
                    <span className={styles.checkIcon}>✓</span>
                    <span>Track your progress as your insights improve</span>
                  </li>
                </ul>
              </>
            ) : (
              <>
                <h1 className={styles.leftHeadline}>
                  Pick up where your
                  <br />
                  career conversation
                  <br />
                  left off.
                </h1>
                <p className={styles.leftSubtitle}>
                  Log in to see your 360° Career View, your next steps and your progress.
                </p>
              </>
            )}
          </div>

          <p className={styles.leftFooter}>
            {authMode === 'signup'
              ? 'No resume required to get started'
              : 'Your Personal AI Career Companion'}
          </p>
        </div>
      </aside>

      {/* RIGHT COLUMN: PDF Page 1 Form + Image 2 Quick Demo Access */}
      <motion.main
        className={styles.splitRight}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: easeOut }}
      >
        <div className={styles.splitFormWrap}>
          {authMode === 'login' ? (
            /* LOGIN VIEW */
            <div className={styles.authContainer}>
              <header className={styles.formHeader}>
                <h1 className={styles.welcomeTitle}>Welcome back</h1>
                <p className={styles.welcomeSub}>Log in to continue your career journey.</p>
              </header>

              <form className={styles.loginForm} onSubmit={handleLoginSubmit}>
                {successMessage ? (
                  <div className={styles.successBanner} role="status">
                    <span>✓</span>
                    <span>{successMessage}</span>
                  </div>
                ) : sessionStorage.getItem('hireright.intent') === 'upload_resume' ? (
                  <div className={styles.successBanner} role="status">
                    <span>📄</span>
                    <span>Resume saved! Log in to automatically attach it to your profile.</span>
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
                    <Link to="/contact" className={styles.forgotLink}>
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

                <button type="submit" className={styles.loginPillBtn} disabled={loading}>
                  {loading ? 'LOGGING IN...' : 'LOG IN'}
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
                    Just exploring?{' '}
                    <Link to="/career-view" className={styles.discoveryLink}>
                      Start My Career Discovery
                    </Link>{' '}
                    <span className={styles.noResumeText}>— no resume required.</span>
                  </p>
                </div>

                {/* IMAGE 2: QUICK DEMO ACCESS */}
                <div className={styles.quickDemoAccessWrap}>
                  <p className={styles.quickDemoLabel}>QUICK DEMO ACCESS</p>

                  <button
                    type="button"
                    className={styles.demoCandidateBigBtn}
                    onClick={() => void runQuickLogin(DEMO_CANDIDATE, '/interview')}
                    disabled={loading}
                  >
                    Candidate · Interview demo
                  </button>

                  <div className={styles.demoTwoBtnRow}>
                    <button
                      type="button"
                      className={styles.demoRoleBtn}
                      onClick={() => void runQuickLogin(DEMO_EMPLOYER, '/employer/dashboard')}
                      disabled={loading}
                    >
                      Vendor / Employer
                    </button>
                    <button
                      type="button"
                      className={styles.demoRoleBtn}
                      onClick={() => void runQuickLogin(DEMO_ADMIN, '/admin')}
                      disabled={loading}
                    >
                      Admin
                    </button>
                  </div>

                  <div className={styles.demoThreeBtnRow}>
                    <button
                      type="button"
                      className={styles.demoFillUnderlineBtn}
                      onClick={fillLoginCandidate}
                    >
                      Fill candidate
                    </button>
                    <button
                      type="button"
                      className={styles.demoFillUnderlineBtn}
                      onClick={fillLoginEmployer}
                    >
                      Fill vendor
                    </button>
                    <button
                      type="button"
                      className={styles.demoFillUnderlineBtn}
                      onClick={fillLoginAdmin}
                    >
                      Fill admin
                    </button>
                  </div>

                  <p className={styles.demoBottomSignupText}>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      className={styles.demoBottomSignupLink}
                      onClick={() => switchMode('signup')}
                    >
                      Sign up
                    </button>
                  </p>
                </div>
              </form>
            </div>
          ) : (
            /* SIGNUP VIEW */
            <div className={styles.authContainer}>
              <header className={styles.formHeader}>
                <h1 className={styles.welcomeTitle}>Create your account</h1>
                <p className={styles.welcomeSub}>
                  It takes under a minute. You can begin your career discovery right after.
                </p>
              </header>

              <form className={styles.loginForm} onSubmit={handleSignupSubmit}>
                {/* Image 2: Role Switcher */}
                <div className={styles.splitRoleGrid}>
                  <button
                    type="button"
                    className={`${styles.splitRoleBtn} ${signupRole === 'jobseeker' ? styles.splitRoleBtnActive : ''}`}
                    onClick={() => setSignupRole('jobseeker')}
                  >
                    <HrIcon name="user" size={18} /> Job Seeker
                  </button>
                  <button
                    type="button"
                    className={`${styles.splitRoleBtn} ${signupRole === 'employer' ? styles.splitRoleBtnActive : ''}`}
                    onClick={() => setSignupRole('employer')}
                  >
                    <HrIcon name="building" size={18} /> Vendor / Recruiter
                  </button>
                </div>

                {sessionStorage.getItem('hireright.intent') === 'upload_resume' && (
                  <div className={styles.successBanner} role="status" style={{ marginBottom: 16 }}>
                    <span>📄</span>
                    <span>Resume selected! Create your account to automatically analyze your profile.</span>
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
                      Vendor / Company Name
                    </label>
                    <input
                      id="signup-company"
                      type="text"
                      value={signupCompanyName}
                      placeholder="TechCitta Solutions"
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
                  <p className={styles.fieldHint}>Used for interview reminders and job applications.</p>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="signup-pwd" className={styles.formLabel}>
                    Password
                  </label>
                  <input
                    id="signup-pwd"
                    type="password"
                    value={signupPassword}
                    placeholder="At least 8 characters"
                    onChange={(event) => setSignupPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                    className={styles.formInput}
                  />
                </div>

                {/* PDF Page 1 Terms Checkbox */}
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

                <button type="submit" className={styles.loginPillBtn} disabled={loading}>
                  {loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
                </button>

                <div className={styles.authLinksBelow}>
                  <p className={styles.subLinkLine}>
                    Already have an account?{' '}
                    <button
                      type="button"
                      className={styles.switchModeLink}
                      onClick={() => switchMode('login')}
                    >
                      Log in
                    </button>
                  </p>
                </div>

                {/* IMAGE 3: DEMO SELECTION BUTTONS */}
                <div className={styles.quickDemoAccessWrap}>
                  <div className={styles.demoTwoBtnRow}>
                    <button
                      type="button"
                      className={styles.demoFillUnderlineBtn}
                      onClick={fillSignupCandidate}
                    >
                      Fill Candidate Demo
                    </button>
                    <button
                      type="button"
                      className={styles.demoFillUnderlineBtn}
                      onClick={fillSignupVendor}
                    >
                      Fill Vendor Demo
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      </motion.main>
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
    <AuthPageFrame>
        <motion.div
          className={`${styles.card} ${styles.settingsCard}`}
          variants={fadeUp}
          initial="hidden"
          animate="show"
        >
          <span className={styles.kicker}>ACCOUNT</span>
          <h1>Account Settings</h1>
          <p>
            Signed in as <strong>{user?.email ?? 'guest'}</strong>
            {user?.name ? ` · ${user.name}` : ''}
          </p>

          {message && <p className={styles.success}>{message}</p>}
          {error && <p className={styles.error}>{error}</p>}

          {panel === 'menu' && (
            <div className={styles.settingsList}>
              <button type="button" onClick={() => setPanel('security')}>
                Email & password
              </button>
              <button type="button" onClick={() => setPanel('notifications')}>
                Notification preferences
              </button>
              <button type="button" onClick={() => setPanel('privacy')}>
                Privacy & visibility
              </button>
              <MotionButton
                type="button"
                className={styles.submit}
                onClick={() => navigate('/profile')}
                lift
              >
                View Profile
              </MotionButton>
              <MotionButton
                type="button"
                className={styles.ghost}
                onClick={openSignOutModal}
              >
                Sign out
              </MotionButton>
            </div>
          )}

          {panel === 'security' && (
            <form className={styles.form} onSubmit={saveSecurity}>
              <label>
                Email
                <input
                  type="email"
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
              <MotionButton type="submit" className={styles.submit} lift>
                Save changes
              </MotionButton>
              <MotionButton
                type="button"
                className={styles.ghost}
                onClick={() => {
                  setPanel('menu')
                  setError('')
                }}
              >
                Back
              </MotionButton>
            </form>
          )}

          {panel === 'notifications' && (
            <form className={styles.form} onSubmit={saveNotifications}>
              {(
                [
                  ['emailMatchAlerts', 'Email me about new role matches'],
                  ['interviewReminders', 'Remind me to retake / finish interviews'],
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
              <MotionButton type="submit" className={styles.submit} lift>
                Save preferences
              </MotionButton>
              <MotionButton
                type="button"
                className={styles.ghost}
                onClick={() => setPanel('menu')}
              >
                Back
              </MotionButton>
            </form>
          )}

          {panel === 'privacy' && (
            <form className={styles.form} onSubmit={savePrivacy}>
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
              <MotionButton type="submit" className={styles.submit} lift>
                Save privacy settings
              </MotionButton>
              <MotionButton
                type="button"
                className={styles.ghost}
                onClick={() => setPanel('menu')}
              >
                Back
              </MotionButton>
            </form>
          )}
        </motion.div>
    </AuthPageFrame>
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

