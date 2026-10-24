import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { initSupabaseAuthSync } from './lib/supabaseSync'
import { AnimatePresence, motion } from 'framer-motion'
import { HomePage } from './pages/HomePage'
import { HowItWorksPage } from './pages/HowItWorksPage'
import { SolutionsPage } from './pages/SolutionsPage'
import { WhoItsForPage } from './pages/WhoItsForPage'
import { WhyPage } from './pages/WhyPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { PricingPage } from './pages/PricingPage'
import { InterviewRetakePricingPage } from './pages/InterviewRetakePricingPage'
import { FaqPage } from './pages/FaqPage'
import { CareerViewPage } from './pages/CareerViewPage'
import { LoginPage, LogoutPage, SettingsPage, SignupPage } from './pages/AuthPages'
import {
  DashboardPage,
  InterviewReportPage,
  JobsPage,
  ProfilePage,
  ApplicationsPage,
} from './pages/AppPages'
import { AdminDashboard } from './pages/AdminDashboard'
import { InterviewPage } from './pages/InterviewPage'
import { InterviewNowPage } from './pages/InterviewNowPage'
import { EmployerDashboard } from './pages/EmployerDashboard'
import { CandidateApplyPage } from './pages/CandidateApplyPage'
import { JobInviteEntryPage } from './pages/JobInviteEntryPage'
import { InterviewInvitePage } from './pages/InterviewInvitePage'
import { ResumeDatabasePage } from './pages/ResumeDatabasePage'
import { ProfileWizard } from './pages/ProfileWizard'
import { NotFoundPage } from './pages/NotFoundPage'
import { ContactPage } from './pages/ContactPage'
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

function AnimatedRoutes() {
  const location = useLocation()

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
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/solutions" element={<SolutionsPage />} />
          <Route path="/job-seekers" element={<WhoItsForPage />} />
          <Route path="/who-its-for" element={<WhoItsForPage />} />
          <Route path="/career-view" element={<CareerViewPage />} />
          <Route path="/360-career-view" element={<CareerViewPage />} />
          <Route path="/career" element={<CareerViewPage />} />
          <Route path="/why" element={<WhyPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/about" element={<FaqPage />} />
          <Route path="/faqs" element={<FaqPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/terms-of-use" element={<TermsPage />} />
          <Route path="/cookies" element={<CookiePolicyPage />} />
          <Route path="/cookie-policy" element={<CookiePolicyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/logout" element={<LogoutPage />} />
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
                  <EmployerDashboard />
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
                  <AdminDashboard />
                </RequireAuth>
              }
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
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
        <CookieConsentBanner />
        <SignOutModal />
        <AuthInvalidModal />
      </BrowserRouter>
    </div>
  )
}

export default App
