import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { HomePage } from './pages/HomePage'
import { HowItWorksPage } from './pages/HowItWorksPage'
import { SolutionsPage } from './pages/SolutionsPage'
import { JobSeekersPage } from './pages/JobSeekersPage'
import { WhyPage } from './pages/WhyPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { PricingPage } from './pages/PricingPage'
import { AboutPage } from './pages/AboutPage'
import { LoginPage, LogoutPage, SettingsPage, SignupPage } from './pages/AuthPages'
import { DashboardPage, JobsPage, ProfilePage, ApplicationsPage } from './pages/AppPages'
import { AdminDashboard } from './pages/AdminDashboard'
import { InterviewPage } from './pages/InterviewPage'
import { EmployerDashboard } from './pages/EmployerDashboard'
import { CandidateApplyPage } from './pages/CandidateApplyPage'
import { ResumeDatabasePage } from './pages/ResumeDatabasePage'
import { AssessmentRecruiterPage } from './pages/AssessmentRecruiterPage'
import { AssessmentCandidatePage } from './pages/AssessmentCandidatePage'
import { ProfileWizard } from './pages/ProfileWizard'
import { NotFoundPage } from './pages/NotFoundPage'
import { ContactPage } from './pages/ContactPage'
import { RequireAuth } from './components/RequireAuth'
import { SignOutModal } from './components/SignOutModal'
import { pageTransition } from './motion/variants'

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        variants={pageTransition}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ minHeight: '100%' }}
      >
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/solutions" element={<SolutionsPage />} />
          <Route path="/job-seekers" element={<JobSeekersPage />} />
          <Route path="/why" element={<WhyPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/logout" element={<LogoutPage />} />
          <Route path="/apply/:code" element={<CandidateApplyPage />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth role="jobseeker">
                <ProfileWizard />
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
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
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
            path="/employer"
            element={
              <RequireAuth role="employer">
                <EmployerDashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/employer/assessments"
            element={
              <RequireAuth role="employer">
                <AssessmentRecruiterPage />
              </RequireAuth>
            }
          />
          <Route
            path="/assessment"
            element={
              <RequireAuth role="jobseeker">
                <AssessmentCandidatePage />
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
                <JobsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/applications"
            element={
              <RequireAuth role="jobseeker">
                <ApplicationsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth role="jobseeker">
                <ProfilePage />
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
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

function App() {

  return (
    <BrowserRouter>
      <AnimatedRoutes />
      <SignOutModal />
    </BrowserRouter>
  )
}

export default App
