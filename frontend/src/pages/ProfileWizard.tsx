import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AboutYouStep } from '../components/AboutYouStep'
import { AiInterviewStep } from '../components/AiInterviewStep'
import { CompleteStep } from '../components/CompleteStep'
import { PerformanceStep } from '../components/PerformanceStep'
import { PrivacyBanner } from '../components/PrivacyBanner'
import { Sidebar } from '../components/Sidebar'
import { SkillsStep } from '../components/SkillsStep'
import { Stepper } from '../components/Stepper'
import { TopBar } from '../components/TopBar'
import {
  initialFormData,
  normalizeMetrics,
  STEPS,
  type ProfileFormData,
  type WizardStep,
} from '../data/wizard'
import {
  isOnboardingComplete,
  onboardingResumeStep,
  ONBOARDING_STEP_COUNT,
} from '../lib/onboardingProgress'
import { firstName, getProfile, saveProfile } from '../lib/store'
import { apiHealth, apiSaveProfile } from '../lib/api'
import { sendOnboardingConfirmationEmail } from '../lib/scheduleInterviewConfirmation'
import { beginImmediateInterview } from '../lib/interviewTestMode'
import { MotionButton } from '../motion/MotionButton'
import { easeOut, fadeUp, stepPanel } from '../motion/variants'
import styles from './ProfileWizard.module.css'

const STEP_TITLES: Record<WizardStep, { title: string; subtitle: string }> = {
  1: {
    title: "Let's Build Your Profile",
    subtitle:
      'Start with the essentials — upload your resume and tell us a bit about yourself.',
  },
  2: {
    title: "Let's Add Your Skills & Experience",
    subtitle:
      'This helps us understand your expertise and match you with the best opportunities.',
  },
  3: {
    title: "Let's Highlight Your Performance",
    subtitle:
      'Share your achievements and contributions that demonstrate your impact.',
  },
  4: {
    title: 'Ready for your AI interview',
    subtitle:
      'Ava will ask about the role and skills you just added — then score you live on camera.',
  },
  5: {
    title: 'All Set!',
    subtitle: 'Your profile and talent score are ready. Explore matched roles next.',
  },
}

export function ProfileWizard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const stepParam = Number(searchParams.get('step'))
  const initialStep = (stepParam >= 1 && stepParam <= 5 ? stepParam : 1) as WizardStep
  const [step, setStep] = useState<WizardStep>(initialStep)
  const [completedThrough, setCompletedThrough] = useState(() => (stepParam >= 1 && stepParam <= 5 ? stepParam - 1 : 0))
  const [userName, setUserName] = useState(() => firstName())
  const [data, setData] = useState<ProfileFormData>(() => {
    const saved = getProfile()
    if (!saved) return initialFormData
    return {
      ...initialFormData,
      ...saved,
      skills: saved.skills?.length ? saved.skills : initialFormData.skills,
      workExperiences: (saved.workExperiences ?? initialFormData.workExperiences).filter((w) => {
        if (w.company?.toLowerCase().includes('techcitta') && !(saved.resumeText || '').toLowerCase().includes('techcitta')) {
          return false
        }
        return true
      }),
      achievements: saved.achievements ?? initialFormData.achievements,
      metrics: normalizeMetrics(saved.metrics),
      awards: saved.awards ?? initialFormData.awards,
      certifications: saved.certifications ?? initialFormData.certifications,
      preferredRoles: saved.preferredRoles ?? initialFormData.preferredRoles,
      preferredLocations: saved.preferredLocations ?? initialFormData.preferredLocations,
      resumeText: saved.resumeText || '',
      resumeName: saved.resumeName || null,
      resumeFile: null,
    }
  })
  const [toast, setToast] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const saved = getProfile()
    if (isOnboardingComplete(saved)) {
      navigate('/dashboard', { replace: true })
      return
    }
    if (saved?.completedSteps) {
      setCompletedThrough(saved.completedSteps)
    }
    const hasStepParam = stepParam >= 1 && stepParam <= ONBOARDING_STEP_COUNT
    if (!hasStepParam && saved) {
      const resume = onboardingResumeStep(saved) as WizardStep
      setStep(resume)
      setCompletedThrough(saved.completedSteps ?? 0)
    }
    // After AI interview, land on All Set (step 5).
    if (sessionStorage.getItem('hireright.wizardStep') === '5') {
      sessionStorage.removeItem('hireright.wizardStep')
      setStep(5)
      setCompletedThrough((prev) => Math.max(prev, 4))
    }
  }, [navigate, stepParam])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  function updateField<K extends keyof ProfileFormData>(
    key: K,
    value: ProfileFormData[K],
  ) {
    setData((prev) => ({ ...prev, [key]: value }))
  }

  function patchFields(patch: Partial<ProfileFormData>) {
    setData((prev) => ({ ...prev, ...patch }))
  }

  function showToast(message: string) {
    setToast(message)
  }

  async function persist(message: string, nextCompleted?: number) {
    setSaving(true)
    const saved = saveProfile(data, nextCompleted ?? completedThrough)
    try {
      if (await apiHealth()) await apiSaveProfile(saved)
    } catch {
      // local save is enough when API is offline
    }
    setSaving(false)
    showToast(message)
  }

  async function handleSaveExit() {
    await persist('Progress saved. You can come back anytime.')
  }

  async function handleContinue() {
    const isScheduled = data.interviewNotes?.startsWith('Scheduled:')
    if (step === 4 && isScheduled) {
      setSaving(true)
      try {
        const emailRes = await sendOnboardingConfirmationEmail(data)
        if (emailRes.skipped) {
          showToast('Interview slot saved — confirmation was already emailed.')
        } else if (emailRes.emailSent) {
          showToast('Confirmation email sent for your interview slot.')
        } else {
          showToast(
            emailRes.emailError
              ? `Slot saved, but email failed: ${emailRes.emailError}`
              : 'Slot saved. Email could not be sent — use the invite link on step 4.',
          )
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not send confirmation email.')
        setSaving(false)
        return
      }
      setSaving(false)
    }

    const nextCompleted =
      step === ONBOARDING_STEP_COUNT
        ? ONBOARDING_STEP_COUNT
        : Math.max(completedThrough, step)
    await persist(
      step === ONBOARDING_STEP_COUNT
        ? 'Onboarding complete — you can update your profile anytime from the dashboard.'
        : step === 4
          ? isScheduled
            ? 'Interview scheduled! Moving to matched roles…'
            : 'Profile saved. Opening AI interview…'
          : `Step ${step} saved. Moving forward…`,
      nextCompleted,
    )
    setCompletedThrough(nextCompleted)

    // If starting now on step 4, navigate to live AI interview; if scheduled for later, proceed to Step 5 (matched roles)
    if (step === 4 && !isScheduled) {
      beginImmediateInterview(navigate)
      return
    }

    if (step < ONBOARDING_STEP_COUNT) {
      setStep((prev) => (prev + 1) as WizardStep)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  const meta = STEP_TITLES[step]
  const showAutoSaveFooter = step >= 2
  const isScheduled = Boolean(data.interviewNotes?.startsWith('Scheduled:'))

  return (
    <motion.div
      className={styles.layout}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: easeOut }}
    >
      <Sidebar step={step} />

      <div className={styles.main}>
        <TopBar userName={userName} />

        <motion.header
          className={styles.pageHeader}
          key={`header-${step}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: easeOut }}
        >
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </motion.header>

        <Stepper
          current={step}
          completedThrough={completedThrough}
          onStepClick={(next) => setStep(next)}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            className={styles.panel}
            variants={stepPanel}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {step === 1 && (
              <AboutYouStep
                data={data}
                onChange={updateField}
                onPatch={patchFields}
                onExtracted={({ firstName: extractedName, fieldCount }) => {
                  if (extractedName) setUserName(extractedName)
                  if (fieldCount > 0) {
                    showToast(
                      extractedName
                        ? `Welcome, ${extractedName} — profile pre-filled from your resume.`
                        : 'Profile pre-filled from your resume.',
                    )
                  }
                }}
              />
            )}
            {step === 2 && <SkillsStep data={data} onChange={updateField} />}
            {step === 3 && (
              <PerformanceStep data={data} onChange={updateField} />
            )}
            {step === 4 && (
              <AiInterviewStep data={data} onChange={updateField} />
            )}
            {step === 5 && (
              <CompleteStep
                data={data}
                onEditStep={(next) => setStep(next)}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {step === 1 && (
            <motion.div
              key="privacy"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
            >
              <PrivacyBanner />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.footer
          className={`${styles.actions} ${showAutoSaveFooter ? styles.actionsSplit : ''}`}
          layout
          transition={{ duration: 0.25, ease: easeOut }}
        >
          {showAutoSaveFooter ? (
            <>
              <MotionButton
                type="button"
                className={styles.backBtn}
                onClick={() => setStep((prev) => (prev - 1) as WizardStep)}
                lift
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M16 10H4M4 10L9 5M4 10L9 15"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Back
              </MotionButton>

              <p className={styles.autoSave}>
                <span className={styles.autoSaveDot} aria-hidden="true">
                  <svg viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3.5 8.5L6.5 11.5L12.5 4.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                All changes are saved automatically
              </p>

              <MotionButton
                type="button"
                className={styles.primaryBtn}
                onClick={handleContinue}
                disabled={saving}
                lift
              >
                {saving
                  ? 'Saving…'
                  : step === 4
                    ? isScheduled
                      ? 'Save & Submit'
                      : 'Save & Start AI Interview'
                    : step === 5
                      ? 'Explore matched roles'
                      : 'Save & Continue'}
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M4 10H16M16 10L11 5M16 10L11 15"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </MotionButton>
            </>
          ) : (
            <>
              <MotionButton
                type="button"
                className={styles.secondaryBtn}
                onClick={handleSaveExit}
                disabled={saving}
                lift
              >
                Save & Exit
              </MotionButton>

              <div className={styles.actionRight}>
                {step > 1 && (
                  <MotionButton
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setStep((prev) => (prev - 1) as WizardStep)}
                  >
                    Back
                  </MotionButton>
                )}
                <MotionButton
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleContinue}
                  disabled={saving}
                  lift
                >
                  {saving ? 'Saving…' : step === 5 ? 'Finish' : 'Save & Continue'}
                  {step < 5 && (
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path
                        d="M4 10H16M16 10L11 5M16 10L11 15"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </MotionButton>
              </div>
            </>
          )}
        </motion.footer>

        <p className={styles.stepHint}>
          Step {step} of {STEPS.length}
        </p>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            className={styles.toast}
            role="status"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit="hidden"
          >
            <span className={styles.toastDot} aria-hidden="true" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
