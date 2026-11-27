import { Suspense, lazy, useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { initSupabaseAuthSync } from './lib/supabaseSync'
import { NotFoundPage } from './pages/NotFoundPage'
import { RequireAdmin } from './components/RequireAdmin'
import { CookieConsentBanner } from './components/CookieConsentBanner'
import { RequireAuth } from './components/RequireAuth'
import { RequireOnboardingAccess } from './components/RequireOnboardingAccess'
import { RequireCandidateOnboardingComplete } from './components/RequireCandidateOnboardingComplete'
import { PageLoader } from './components/SignalLoader'
import { applyClientStorageMigration } from './lib/store'
import { GlobalLoadingIndicator } from './components/GlobalLoadingIndicator'
import { lazyPage } from './routeImports'

const HomePage = lazyPage('home', (m) => m.HomePage)
const SolutionsPage = lazyPage('solutions', (m) => m.SolutionsPage)
const WhyPage = lazyPage('why', (m) => m.WhyPage)
const RecruiterPage = lazyPage('recruiter', (m) => m.RecruiterPage)
const PricingPage = lazyPage('pricing', (m) => m.PricingPage)
const InterviewRetakePricingPage = lazyPage('retakePricing', (m) => m.InterviewRetakePricingPage)
const CareerViewPage = lazyPage('careerView', (m) => m.CareerViewPage)
const LoginPage = lazyPage('auth', (m) => m.LoginPage)
const LogoutPage = lazyPage('auth', (m) => m.LogoutPage)
const SettingsPage = lazyPage('auth', (m) => m.SettingsPage)
const SignupPage = lazyPage('auth', (m) => m.SignupPage)
const OrganizationSignupPage = lazyPage('orgSignup', (m) => m.OrganizationSignupPage)
const DashboardPage = lazyPage('appPages', (m) => m.DashboardPage)
const InterviewReportPage = lazyPage('appPages', (m) => m.InterviewReportPage)
const JobsPage = lazyPage('appPages', (m) => m.JobsPage)
const ProfilePage = lazyPage('appPages', (m) => m.ProfilePage)
const ApplicationsPage = lazyPage('appPages', (m) => m.ApplicationsPage)
const ApplicationTrackPage = lazyPage('applicationTrack', (m) => m.ApplicationTrackPage)
const AdminDashboard = lazyPage('admin', (m) => m.AdminDashboard)
const InterviewPage = lazyPage('interview', (m) => m.InterviewPage)
const InterviewNowPage = lazyPage('interviewNow', (m) => m.InterviewNowPage)
const InterviewCompletePage = lazyPage('interviewComplete', (m) => m.InterviewCompletePage)
const EmployerDashboard = lazyPage('employer', (m) => m.EmployerDashboard)
const VendorDashboardPage = lazyPage('vendorDashboard', (m) => m.VendorDashboardPage)
const CandidateApplyPage = lazyPage('apply', (m) => m.CandidateApplyPage)
const JobInviteEntryPage = lazyPage('jobInvite', (m) => m.JobInviteEntryPage)
const InterviewInvitePage = lazyPage('interviewInvite', (m) => m.InterviewInvitePage)
const ResumeDatabasePage = lazyPage('resumes', (m) => m.ResumeDatabasePage)
const ProfileWizard = lazyPage('onboarding', (m) => m.ProfileWizard)
const ContactPage = lazyPage('contact', (m) => m.ContactPage)
const ForgotPasswordPage = lazyPage('passwordReset', (m) => m.ForgotPasswordPage)
const ResetPasswordPage = lazyPage('passwordReset', (m) => m.ResetPasswordPage)
const PrivacyPolicyPage = lazyPage('legal', (m) => m.PrivacyPolicyPage)
const TermsPage = lazyPage('legal', (m) => m.TermsPage)
const CookiePolicyPage = lazyPage('legal', (m) => m.CookiePolicyPage)
/** The signed-in layout (nav with notification bells, footer) only downloads for signed-in routes. */
const AppShell = lazyPage('appShell', (m) => m.AppShell)
/** Dialogs that only open on sign-out or an expired session; loaded once the first page is up. */
const SignOutModal = lazy(() => import('./components/SignOutModal').then((m) => ({ default: m.SignOutModal })))
const AuthInvalidModal = lazy(() => import('./components/AuthInvalidModal').then((m) => ({ default: m.AuthInvalidModal })))

/**
 * framer-motion ignores prefers-reduced-motion unless told otherwise. Instead of wrapping the app in
 * <MotionConfig> (which would put framer in the first download), switch its animations off globally for
 * people who ask for reduced motion. Pages that use framer load it themselves.
 */
function respectReducedMotionInFramer() {
  const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  if (!query) return
  const apply = () => {
    import('framer-motion')
      .then(({ MotionGlobalConfig }) => {
        MotionGlobalConfig.skipAnimations = query.matches
      })
      .catch(() => undefined)
  }
  if (query.matches) apply()
  query.addEventListener?.('change', apply)
}

if (typeof window !== 'undefined') respectReducedMotionInFramer()

/** Old applicant addresses now open Jobs. A ?jobId= still opens that job's applications. */
function RedirectToJobApplications() {
  const { search, hash } = useLocation()
  return <Navigate to={`/employer/jobs${search}${hash}`} replace />
}

/** /employer/candidates?jobId=… is an old applicants link: open that job's applications; otherwise the page. */
function JobLinkOr({ children }: { children: ReactNode }) {
  const { search } = useLocation()
  return new URLSearchParams(search).has('jobId') ? <RedirectToJobApplications /> : <>{children}</>
}

/** The Candidates page lives at /employer/candidates. Older addresses (/resumes, /talent-vault, /candidates) open it,
 *  except an old applicants link with ?jobId=, which still opens that job's applications. */
function RedirectToCandidates() {
  const { search, hash } = useLocation()
  if (new URLSearchParams(search).has('jobId')) return <Navigate to={`/employer/jobs${search}${hash}`} replace />
  return <Navigate to={`/employer/candidates${search}${hash}`} replace />
}

const ROUTE_TITLES: Record<string, string> = {
  '/': 'HireRighttt — AI interviews that prove skills',
  '/why': 'Why HireRighttt?',
  '/pricing': 'Pricing',
  '/career-view': '360° Report',
  '/solutions': 'Solutions',
  '/for-recruiters': 'For organisations',
  '/organizations': 'For organisations',
  '/contact': 'Contact us',
  '/signup': 'Get started',
  '/organizations/signup': 'Organisation sign up',
  '/login': 'Log in',
  '/employer/dashboard': 'Dashboard',
  '/employer': 'Dashboard',
  '/employer/jobs': 'Jobs',
  '/employer/applicants': 'Jobs',
  '/employer/candidates': 'Candidates',
  '/candidates': 'Candidates',
  '/resumes': 'Candidates',
  '/talent-vault': 'Candidates',
  '/dashboard': 'Dashboard',
  '/dashboard/report': 'Interview report',
  '/jobs': 'Jobs',
  '/applications': 'Applications',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/pricing/retake': 'Retake your interview',
  '/onboarding': 'Set up your profile',
  '/interview': 'AI interview',
  '/interview/now': 'AI interview',
  '/interview/complete': 'Interview complete',
  '/admin': 'Admin',
  '/logout': 'Signing out',
  '/forgot-password': 'Reset your password',
  '/reset-password': 'Choose a new password',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms & Conditions',
  '/cookies': 'Cookie Policy',
}

/** Titles for routes with parameters (job links, invites), so the tab never keeps the previous page's title. */
const ROUTE_TITLE_PREFIXES: [string, string][] = [
  ['/applications/', 'Application'],
  ['/apply/', 'Apply for a role'],
  ['/jobs/', 'Apply for a role'],
  ['/interview/invite/', 'Interview invitation'],
  ['/assessment/', 'Assessment'],
]

function routeTitle(pathname: string): string | null {
  const exact = ROUTE_TITLES[pathname] ?? ROUTE_TITLES[pathname.replace(/\/+$/, '') || '/']
  if (exact) return exact
  const prefixed = ROUTE_TITLE_PREFIXES.find(([prefix]) => pathname.startsWith(prefix))
  return prefixed ? prefixed[1] : null
}

/**
 * New page, new scroll position: start at the top on every push/replace navigation. Back/forward (POP) keeps
 * the browser's own restoration, and links to an anchor (#section) are left to scroll to their target.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const navigationType = useNavigationType()
  useLayoutEffect(() => {
    if (hash || navigationType === 'POP') return
    window.scrollTo(0, 0)
    // Only a change of page resets the scroll, not a change of query string or state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  return null
}

/** Mounts the rarely needed dialogs after the first page has painted, so their code is not on the critical path. */
function DeferredDialogs() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(() => setReady(true), 300)
    return () => window.clearTimeout(id)
  }, [])
  if (!ready) return null
  return (
    <Suspense fallback={<PageLoader label="Loading…" />}>
      <SignOutModal />
      <AuthInvalidModal />
    </Suspense>
  )
}

/**
 * Remounts a page when the path changes (so two routes that render the same component never share state) while
 * the surrounding layout — AppShell's nav and footer — stays mounted.
 */
function Page({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div key={pathname} className="hr-route-enter">
      {children}
    </div>
  )
}

function AnimatedRoutes() {
  const location = useLocation()

  useEffect(() => {
    const title = routeTitle(location.pathname)
    if (!title) return
    document.title = title.startsWith('HireRighttt') ? title : `${title} · HireRighttt`
  }, [location.pathname])

  return (
    <div style={{ minHeight: '100%' }}>
        <Suspense fallback={<PageLoader label="Loading page…" />}>
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/solutions" element={<SolutionsPage />} />
          {/* Product explainer content lives only on the home page. */}
          <Route path="/how-it-works" element={<Navigate to="/" replace />} />
          <Route path="/job-seekers" element={<Navigate to="/" replace />} />
          <Route path="/who-its-for" element={<Navigate to="/" replace />} />
          <Route path="/resources" element={<Navigate to="/" replace />} />
          <Route path="/about" element={<Navigate to="/why" replace />} />
          <Route path="/faqs" element={<Navigate to="/" replace />} />
          <Route path="/faq" element={<Navigate to="/" replace />} />
          <Route path="/career-view" element={<CareerViewPage />} />
          <Route path="/360-career-view" element={<CareerViewPage />} />
          <Route path="/career" element={<CareerViewPage />} />
          <Route path="/why" element={<WhyPage />} />
          <Route path="/organizations" element={<RecruiterPage />} />
          <Route path="/for-recruiters" element={<RecruiterPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/privacy-policy" element={<Navigate to="/privacy" replace />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/terms-of-use" element={<Navigate to="/terms" replace />} />
          <Route path="/cookies" element={<CookiePolicyPage />} />
          <Route path="/cookie-policy" element={<Navigate to="/cookies" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/organizations/signup" element={<OrganizationSignupPage />} />
          <Route path="/logout" element={<LogoutPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/apply/:companySlug/:code" element={<CandidateApplyPage />} />
          <Route path="/apply/:code" element={<CandidateApplyPage />} />
          <Route path="/jobs/:companySlug/:code" element={<JobInviteEntryPage />} />
          <Route path="/interview/invite/:token" element={<InterviewInvitePage />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth role="jobseeker">
                <RequireOnboardingAccess>
                  <ProfileWizard />
                </RequireOnboardingAccess>
              </RequireAuth>
            }
          />
          <Route
            path="/interview/complete"
            element={
              <RequireAuth role="jobseeker">
                <InterviewCompletePage />
              </RequireAuth>
            }
          />
          <Route
            path="/interview/now"
            element={
              <RequireAuth role="jobseeker">
                <InterviewNowPage />
              </RequireAuth>
            }
          />
          <Route
            path="/interview"
            element={
              <RequireAuth role="jobseeker">
                <InterviewPage />
              </RequireAuth>
            }
          />
          <Route element={<AppShell />}>
            <Route
              path="/dashboard"
              element={
                <Page>
                  <RequireAuth role="jobseeker">
                    <RequireCandidateOnboardingComplete>
                      <DashboardPage />
                    </RequireCandidateOnboardingComplete>
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/pricing/retake"
              element={
                <Page>
                  <RequireAuth role="jobseeker">
                    <InterviewRetakePricingPage />
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/dashboard/report"
              element={
                <Page>
                  <RequireAuth role="jobseeker">
                    <RequireCandidateOnboardingComplete>
                      <InterviewReportPage />
                    </RequireCandidateOnboardingComplete>
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/employer/dashboard"
              element={
                <Page>
                  <RequireAuth role="employer">
                    <VendorDashboardPage />
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/employer/jobs"
              element={
                <Page>
                  <RequireAuth role="employer">
                    <EmployerDashboard />
                  </RequireAuth>
                </Page>
              }
            />
            <Route path="/employer/applicants" element={<RedirectToJobApplications />} />
            <Route
              path="/employer/candidates"
              element={
                <JobLinkOr>
                  <Page>
                    <RequireAuth role="employer">
                      <ResumeDatabasePage />
                    </RequireAuth>
                  </Page>
                </JobLinkOr>
              }
            />
            <Route path="/candidates" element={<RedirectToCandidates />} />
            <Route
              path="/employer"
              element={
                <Page>
                  <RequireAuth role="employer">
                    <VendorDashboardPage />
                  </RequireAuth>
                </Page>
              }
            />
            <Route path="/resumes" element={<RedirectToCandidates />} />
            <Route path="/talent-vault" element={<RedirectToCandidates />} />
            <Route
              path="/jobs"
              element={
                <Page>
                  <RequireAuth role="jobseeker">
                    <RequireCandidateOnboardingComplete>
                      <JobsPage />
                    </RequireCandidateOnboardingComplete>
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/applications"
              element={
                <Page>
                  <RequireAuth role="jobseeker">
                    <RequireCandidateOnboardingComplete>
                      <ApplicationsPage />
                    </RequireCandidateOnboardingComplete>
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/applications/:id"
              element={
                <Page>
                  <RequireAuth role="jobseeker">
                    <RequireCandidateOnboardingComplete>
                      <ApplicationTrackPage />
                    </RequireCandidateOnboardingComplete>
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/profile"
              element={
                <Page>
                  <RequireAuth role="jobseeker">
                    <RequireCandidateOnboardingComplete>
                      <ProfilePage />
                    </RequireCandidateOnboardingComplete>
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/settings"
              element={
                <Page>
                  <RequireAuth>
                    <SettingsPage />
                  </RequireAuth>
                </Page>
              }
            />
            <Route
              path="/admin"
              element={
                <Page>
                  <RequireAuth role="employer">
                    <RequireAdmin>
                      <AdminDashboard />
                    </RequireAdmin>
                  </RequireAuth>
                </Page>
              }
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
    </div>
  )
}

function App() {
  useEffect(() => {
    applyClientStorageMigration()
    initSupabaseAuthSync()
  }, [])

  return (
    <div className="hr-ui">
        <BrowserRouter>
          <ScrollToTop />
          <AnimatedRoutes />
          <GlobalLoadingIndicator />
          <CookieConsentBanner />
          <DeferredDialogs />
        </BrowserRouter>
    </div>
  )
}

export default App
