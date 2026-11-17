import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { initSupabaseAuthSync } from './lib/supabaseSync'
import { AnimatePresence, motion } from 'framer-motion'
import { HomePage } from './pages/HomePage'
import { SolutionsPage } from './pages/SolutionsPage'
import { WhyPage } from './pages/WhyPage'
import { RecruiterPage } from './pages/RecruiterPage'
import { PricingPage } from './pages/PricingPage'
import { InterviewRetakePricingPage } from './pages/InterviewRetakePricingPage'
const CareerViewPage = lazy(() => import('./pages/CareerViewPage').then((m) => ({ default: m.CareerViewPage })))
import { LoginPage, LogoutPage, SettingsPage, SignupPage } from './pages/AuthPages'
import { OrganizationSignupPage } from './pages/OrganizationSignupPage'
const DashboardPage = lazy(() => import('./pages/AppPages').then((m) => ({ default: m.DashboardPage })))
const InterviewReportPage = lazy(() => import('./pages/AppPages').then((m) => ({ default: m.InterviewReportPage })))
const JobsPage = lazy(() => import('./pages/AppPages').then((m) => ({ default: m.JobsPage })))
const ProfilePage = lazy(() => import('./pages/AppPages').then((m) => ({ default: m.ProfilePage })))
const ApplicationsPage = lazy(() => import('./pages/AppPages').then((m) => ({ default: m.ApplicationsPage })))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard').then((m) => ({ default: m.AdminDashboard })))
const InterviewPage = lazy(() => import('./pages/InterviewPage').then((m) => ({ default: m.InterviewPage })))
const InterviewNowPage = lazy(() => import('./pages/InterviewNowPage').then((m) => ({ default: m.InterviewNowPage })))
import { InterviewCompletePage } from './pages/InterviewCompletePage'
import { RequireAdmin } from './components/RequireAdmin'
const EmployerDashboard = lazy(() => import('./pages/EmployerDashboard').then((m) => ({ default: m.EmployerDashboard })))
const VendorDashboardPage = lazy(() => import('./pages/VendorDashboardPage').then((m) => ({ default: m.VendorDashboardPage })))
import { CandidateApplyPage } from './pages/CandidateApplyPage'
import { JobInviteEntryPage } from './pages/JobInviteEntryPage'
import { InterviewInvitePage } from './pages/InterviewInvitePage'
const ResumeDatabasePage = lazy(() => import('./pages/ResumeDatabasePage').then((m) => ({ default: m.ResumeDatabasePage })))
const ProfileWizard = lazy(() => import('./pages/ProfileWizard').then((m) => ({ default: m.ProfileWizard })))
import { NotFoundPage } from './pages/NotFoundPage'
import { ContactPage } from './pages/ContactPage'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordResetPages'
import { CookiePolicyPage, PrivacyPolicyPage, TermsPage } from './pages/LegalPages'
import { CookieConsentBanner } from './components/CookieConsentBanner'
import { AuthInvalidModal } from './components/AuthInvalidModal'
import { RequireAuth } from './components/RequireAuth'
import { RequireOnboardingAccess } from './components/RequireOnboardingAccess'
import { RequireCandidateOnboardingComplete } from './components/RequireCandidateOnboardingComplete'
import { SignOutModal } from './components/SignOutModal'
import { pageTransition } from './motion/variants'
import { applyClientStorageMigration } from './lib/store'
import { AppShell } from './components/AppShell'
import { GlobalLoadingIndicator } from './components/GlobalLoadingIndicator'

const ROUTE_TITLES: Record<string, string> = {
  '/': 'HireRighttt — AI interviews that prove skills',
  '/why': 'Why HireRighttt?',
  '/pricing': 'Pricing',
  '/career-view': '360° Report',
  '/solutions': 'For organizations',
  '/contact': 'Contact us',
  '/signup': 'Get started',
  '/organizations/signup': 'Organization sign up',
  '/login': 'Log in',
  '/employer/dashboard': 'Dashboard',
  '/employer/jobs': 'Jobs',
  '/forgot-password': 'Reset your password',
  '/reset-password': 'Choose a new password',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms & Conditions',
  '/cookies': 'Cookie Policy',
}

/** The Organisations nav link lands on the recruiter page; its buttons open the sign-up form on the same URL. */
function OrganizationsEntry() {
  const location = useLocation()
  const wantsForm = Boolean((location.state as { orgForm?: boolean } | null)?.orgForm)
  return wantsForm ? <OrganizationSignupPage /> : <RecruiterPage />
}

function AnimatedRoutes() {
  const location = useLocation()

  useEffect(() => {
    const title = ROUTE_TITLES[location.pathname]
    document.title = title
      ? title.startsWith('HireRighttt')
        ? title
        : `${title} · HireRighttt`
      : 'HireRighttt'
  }, [location.pathname])

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        variants={pageTransition}
        initial={false}
        animate="animate"
        exit="exit"
        style={{ minHeight: '100%' }}
      >
        <Suspense fallback={null}>
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
          <Route path="/solutions" element={<RecruiterPage />} />
          <Route path="/organizations" element={<RecruiterPage />} />
          <Route path="/for-recruiters" element={<RecruiterPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/terms-of-use" element={<TermsPage />} />
          <Route path="/cookies" element={<CookiePolicyPage />} />
          <Route path="/cookie-policy" element={<CookiePolicyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/organizations/signup" element={<OrganizationsEntry />} />
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
                <RequireAuth role="jobseeker">
                  <RequireCandidateOnboardingComplete>
                    <DashboardPage />
                  </RequireCandidateOnboardingComplete>
                </RequireAuth>
              }
            />
            <Route
              path="/pricing/retake"
              element={
                <RequireAuth role="jobseeker">
                  <RequireCandidateOnboardingComplete>
                    <InterviewRetakePricingPage />
                  </RequireCandidateOnboardingComplete>
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard/report"
              element={
                <RequireAuth role="jobseeker">
                  <RequireCandidateOnboardingComplete>
                    <InterviewReportPage />
                  </RequireCandidateOnboardingComplete>
                </RequireAuth>
              }
            />
            <Route
              path="/employer/dashboard"
              element={
                <RequireAuth role="employer">
                  <VendorDashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/employer/jobs"
              element={
                <RequireAuth role="employer">
                  <EmployerDashboard />
                </RequireAuth>
              }
            />
            <Route
              path="/employer/candidates"
              element={
                <RequireAuth role="employer">
                  <EmployerDashboard view="candidates" />
                </RequireAuth>
              }
            />
            <Route
              path="/candidates"
              element={
                <RequireAuth role="employer">
                  <EmployerDashboard view="candidates" />
                </RequireAuth>
              }
            />
            <Route
              path="/employer"
              element={
                <RequireAuth role="employer">
                  <VendorDashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/resumes"
              element={
                <RequireAuth>
                  <ResumeDatabasePage />
                </RequireAuth>
              }
            />
            <Route
              path="/talent-vault"
              element={
                <RequireAuth>
                  <ResumeDatabasePage />
                </RequireAuth>
              }
            />
            <Route
              path="/jobs"
              element={
                <RequireAuth role="jobseeker">
                  <RequireCandidateOnboardingComplete>
                    <JobsPage />
                  </RequireCandidateOnboardingComplete>
                </RequireAuth>
              }
            />
            <Route
              path="/applications"
              element={
                <RequireAuth role="jobseeker">
                  <RequireCandidateOnboardingComplete>
                    <ApplicationsPage />
                  </RequireCandidateOnboardingComplete>
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth role="jobseeker">
                  <RequireCandidateOnboardingComplete>
                    <ProfilePage />
                  </RequireCandidateOnboardingComplete>
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <SettingsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth role="employer">
                  <RequireAdmin>
                    <AdminDashboard />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
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
        <AnimatedRoutes />
        <GlobalLoadingIndicator />
        <CookieConsentBanner />
        <SignOutModal />
        <AuthInvalidModal />
      </BrowserRouter>
    </div>
  )
}

export default App
