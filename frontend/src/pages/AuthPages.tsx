import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { HrIcon } from '../components/HrIcon'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { BrandLogo } from '../components/BrandLogo'
import { LoginGlobe } from '../components/LoginGlobe'

import { MotionButton } from '../motion/MotionButton'
import { easeOut, fadeUp } from '../motion/variants'
import {
  findUserByEmail,
  getAccountPrefs,
  getProfile,
  getUser,
  login,
  logout,
  saveAccountPrefs,
  saveUser,
  updateUserEmail,
  updateUserPassword,
} from '../lib/store'
import { apiHealth, apiLogin, apiLogout, apiSignup } from '../lib/api'
import {
  DEMO_ADMIN,
  DEMO_CANDIDATE,
  DEMO_EMPLOYER,
  getDemoAccount,
  isDemoEmail,
} from '../lib/authDemo'
import { ensureApiSession } from '../lib/apiSession'
import { pullProfileFromApi } from '../lib/apiSync'
import { openSignOutModal } from '../lib/signOutModal'
import { isValidPhone } from '../lib/phone'
import styles from './AuthPages.module.css'

type StoredUser = NonNullable<ReturnType<typeof getUser>>

async function authenticateWithEmailPassword(
  targetEmail: string,
  password: string,
): Promise<{ user: StoredUser | null; error?: string }> {
  let authenticatedUser: StoredUser | null = null

  try {
    if (await apiHealth()) {
      const apiRes = await apiLogin(targetEmail, password)
      if (apiRes) {
        const existing = findUserByEmail(targetEmail)
        const apiRole =
          apiRes.role === 'employer' || apiRes.role === 'jobseeker'
            ? apiRes.role
            : undefined
        authenticatedUser = saveUser(
          {
            name: apiRes.name || existing?.name || targetEmail.split('@')[0],
            email: targetEmail,
            password,
            role:
              apiRole ??
              existing?.role ??
              (targetEmail.includes('employer') || targetEmail.includes('admin')
                ? 'employer'
                : 'jobseeker'),
            companyName: apiRes.companyName || existing?.companyName,
          },
          true,
        )
        await pullProfileFromApi()
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
    if (isDemoEmail(targetEmail)) {
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
type RoleType = 'jobseeker' | 'employer'

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
    }
  }, [initialMode, location.pathname])

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Login state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [remember, setRemember] = useState(true)

  // Signup state
  const [signupRole, setSignupRole] = useState<RoleType>('jobseeker')
  const [signupName, setSignupName] = useState('')
  const [signupPhone, setSignupPhone] = useState('')
  const [signupCompanyName, setSignupCompanyName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupConfirm, setSignupConfirm] = useState('')

  function switchMode(newMode: AuthMode) {
    setAuthMode(newMode)
    setError('')
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
    setSignupConfirm('password123')
    setError('')
  }

  function fillSignupVendor() {
    setSignupRole('employer')
    setSignupName('Sarah Jenkins')
    setSignupCompanyName('TechCitta Solutions')
    setSignupPhone('+91 98765 12345')
    setSignupEmail('vendor@hireright.com')
    setSignupPassword('password123')
    setSignupConfirm('password123')
    setError('')
  }

  function navigateAfterLogin(authenticatedUser: StoredUser, forcedPath?: string) {
    if (forcedPath) {
      navigate(forcedPath, { replace: true })
      return
    }
    const from = (location.state as { from?: string })?.from
    if (from && from !== '/login' && from !== '/signup') {
      navigate(from, { replace: true })
      return
    }
    if (authenticatedUser.role === 'employer') {
      navigate('/employer/dashboard')
      return
    }
    const profile = getProfile()
    if (!profile || (profile.completedSteps ?? 0) < 3) {
      navigate('/onboarding')
      return
    }
    navigate('/dashboard')
  }

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
      const { user, error: authError } = await authenticateWithEmailPassword(
        targetEmail,
        loginPassword,
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
    if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim() || !signupPhone.trim()) {
      setError('Fill in all required fields including mobile number.')
      return
    }
    if (!isValidPhone(signupPhone.trim())) {
      setError('Enter a valid mobile number (10–15 digits; include country code if needed).')
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
    if (signupPassword !== signupConfirm) {
      setError('Passwords do not match.')
      return
    }
    setError('')
    setLoading(true)

    try {
      if (await apiHealth()) {
        try {
          await apiSignup(
            signupName.trim(),
            signupEmail.trim().toLowerCase(),
            signupPassword,
            {
              role: signupRole,
              companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
              phone: signupPhone.trim() || undefined,
            },
          )
          await pullProfileFromApi()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not create account on server.')
          return
        }
      }
      saveUser(
        {
          name: signupName.trim(),
          email: signupEmail.trim().toLowerCase(),
          password: signupPassword,
          role: signupRole,
          companyName: signupRole === 'employer' ? signupCompanyName.trim() : undefined,
          phone: signupPhone.trim() || undefined,
        },
        true,
      )
      if (signupRole === 'employer') {
        navigate('/employer/dashboard')
      } else {
        navigate('/onboarding')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.splitPage}>
      <aside className={styles.splitLeft}>
        <LoginGlobe />
        <div className={styles.splitLeftInner}>
          <div style={{ marginBottom: '1.5rem' }}>
            <BrandLogo dark size="lg" />
          </div>
          <div className={styles.splitLeftCopy}>
            <p className={styles.splitWelcome}>
              {authMode === 'signup' ? 'Get started with' : 'Welcome to'}
            </p>
            <h2 className={styles.splitCommunity}>HireRight Community</h2>
            <p className={styles.splitTagline}>
              {authMode === 'signup'
                ? 'Join thousands of job seekers, recruiters, and vendors hiring with certified AI assessments.'
                : 'Home to job seekers, recruiters, and teams hiring fairly worldwide.'}
            </p>
            <Link to="/about" className={styles.splitKnowMore}>
              Know more
            </Link>
          </div>
        </div>
      </aside>

      <motion.main
        className={styles.splitRight}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: easeOut }}
      >
        <div className={styles.splitFormWrap}>
          {/* Segmented Mode Switcher */}
          <div className={styles.authModeToggle}>
            <button
              type="button"
              className={`${styles.modeTab} ${authMode === 'login' ? styles.modeTabActive : ''}`}
              onClick={() => switchMode('login')}
            >
              Log In
            </button>
            <button
              type="button"
              className={`${styles.modeTab} ${authMode === 'signup' ? styles.modeTabActive : ''}`}
              onClick={() => switchMode('signup')}
            >
              Sign Up
            </button>
          </div>

          <header className={styles.splitFormHead}>
            <p className={styles.splitHello}>
              {authMode === 'signup' ? 'Create new account' : 'Welcome back!'}
            </p>
            <h1 className={styles.splitTitle}>
              {authMode === 'signup'
                ? 'Sign up to get started'
                : 'Login to your account'}
            </h1>
            <p className={styles.splitSubtitle}>
              {authMode === 'signup'
                ? 'Experience automated, bias-free AI video evaluations and career matching.'
                : "It's nice to see you again. Ready for your next interview?"}
            </p>
          </header>

          {authMode === 'login' ? (
            /* LOGIN FORM */
            <form className={styles.splitForm} onSubmit={handleLoginSubmit}>
              <label className={styles.splitLabel}>
                <span className={styles.fieldH4}>Your username or email</span>
                <input
                  type="email"
                  value={loginEmail}
                  placeholder="Your username or email"
                  onChange={(event) => setLoginEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label className={styles.splitLabel}>
                <span className={styles.fieldH4}>Your password</span>
                <input
                  type="password"
                  value={loginPassword}
                  placeholder="Your password"
                  onChange={(event) => setLoginPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}

              <div className={styles.splitOptions}>
                <label className={styles.rememberRow}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Remember me
                </label>
                <Link to="/contact" className={styles.forgotLink}>
                  Forgot password?
                </Link>
              </div>

              <MotionButton type="submit" className={styles.splitSubmit} disabled={loading} lift>
                {loading ? 'Signing in...' : 'Log in'}
              </MotionButton>

              <div className={styles.splitOr}>
                <span>or</span>
              </div>

              <div className={styles.demoSection}>
                <p className={styles.demoLabel}>Quick demo access</p>
                <div className={styles.demoGrid}>
                  <button
                    type="button"
                    className={styles.socialBtn}
                    onClick={() => void runQuickLogin(DEMO_CANDIDATE, '/interview')}
                    disabled={loading}
                  >
                    Candidate · Interview demo
                  </button>
                  <div className={styles.demoHalfRow}>
                    <button
                      type="button"
                      className={styles.socialBtnHalf}
                      onClick={() => void runQuickLogin(DEMO_EMPLOYER, '/employer/dashboard')}
                      disabled={loading}
                    >
                      Vendor / Employer
                    </button>
                    <button
                      type="button"
                      className={styles.socialBtnHalf}
                      onClick={() => void runQuickLogin(DEMO_ADMIN, '/admin')}
                      disabled={loading}
                    >
                      Admin
                    </button>
                  </div>
                </div>
                <div className={styles.demoFillRow}>
                  <button type="button" className={styles.demoLinkBtn} onClick={fillLoginCandidate}>
                    Fill candidate
                  </button>
                  <button type="button" className={styles.demoLinkBtn} onClick={fillLoginEmployer}>
                    Fill vendor
                  </button>
                  <button type="button" className={styles.demoLinkBtn} onClick={fillLoginAdmin}>
                    Fill admin
                  </button>
                </div>
              </div>
            </form>
          ) : (
            /* SIGNUP FORM */
            <form className={styles.splitForm} onSubmit={handleSignupSubmit}>
              {/* Role Switcher */}
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

              {/* Full Name */}
              <label className={styles.splitLabel}>
                <span className={styles.fieldH4}>Full Name</span>
                <input
                  type="text"
                  value={signupName}
                  placeholder={signupRole === 'employer' ? 'Sarah Jenkins' : 'Arjun Sharma'}
                  onChange={(event) => setSignupName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </label>

              {/* Phone Number */}
              <label className={styles.splitLabel}>
                <span className={styles.fieldH4}>Mobile Number (required, one account per number)</span>
                <input
                  type="tel"
                  value={signupPhone}
                  placeholder="+91 98765 43210"
                  onChange={(event) => setSignupPhone(event.target.value)}
                  autoComplete="tel"
                  required
                />
              </label>

              {/* Company / Vendor Name (if Vendor / Recruiter) */}
              {signupRole === 'employer' && (
                <label className={styles.splitLabel}>
                  <span className={styles.fieldH4}>Vendor / Company Name</span>
                  <input
                    type="text"
                    value={signupCompanyName}
                    placeholder="TechCitta Solutions"
                    onChange={(event) => setSignupCompanyName(event.target.value)}
                    required
                  />
                </label>
              )}

              {/* Email Address */}
              <label className={styles.splitLabel}>
                <span className={styles.fieldH4}>Work Email Address</span>
                <input
                  type="email"
                  value={signupEmail}
                  placeholder="you@example.com"
                  onChange={(event) => setSignupEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              {/* Password and Confirm in 2 columns */}
              <div className={styles.splitRow2}>
                <label className={styles.splitLabel}>
                  <span className={styles.fieldH4}>Password</span>
                  <input
                    type="password"
                    value={signupPassword}
                    placeholder="••••••••"
                    onChange={(event) => setSignupPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label className={styles.splitLabel}>
                  <span className={styles.fieldH4}>Confirm Password</span>
                  <input
                    type="password"
                    value={signupConfirm}
                    placeholder="••••••••"
                    onChange={(event) => setSignupConfirm(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>
              </div>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}

              <MotionButton type="submit" className={styles.splitSubmit} disabled={loading} lift>
                {loading
                  ? 'Creating account...'
                  : signupRole === 'employer'
                    ? 'Create Vendor Account →'
                    : 'Create Job Seeker Account →'}
              </MotionButton>

              <div className={styles.splitOr}>
                <span>or</span>
              </div>

              <div className={styles.demoFillRow} style={{ marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className={styles.demoLinkBtn}
                  onClick={fillSignupCandidate}
                >
                  Fill Candidate Demo
                </button>
                <button
                  type="button"
                  className={styles.demoLinkBtn}
                  onClick={fillSignupVendor}
                >
                  Fill Vendor Demo
                </button>
              </div>
            </form>
          )}

          <p className={styles.splitSignup}>
            {authMode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  className={styles.inlineSwitchBtn}
                  onClick={() => switchMode('signup')}
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className={styles.inlineSwitchBtn}
                  onClick={() => switchMode('login')}
                >
                  Log in
                </button>
              </>
            )}
          </p>
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
    void apiLogout()
    logout()
    navigate('/', { replace: true })
  }, [navigate])

  return null
}

