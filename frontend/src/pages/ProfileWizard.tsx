import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { OnboardingExtractModal } from '../components/OnboardingExtractModal'
import { OnboardingProfileStep } from '../components/OnboardingProfileStep'
import { AiInterviewStep } from '../components/AiInterviewStep'
import { CompleteStep } from '../components/CompleteStep'
import { Sidebar } from '../components/Sidebar'
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
  legacyCompletedAfterUiStep,
  onboardingResumeStep,
  ONBOARDING_STEP_COUNT,
  parseOnboardingStepParam,
  uiCompletedThrough,
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
      'Upload your resume — we’ll extract your details so you can review and continue in one step.',
  },
  2: {
    title: 'Ready for your AI interview',
    subtitle:
      'Ava will ask about the role and skills you just added — then score you live on camera.',
  },
  3: {
    title: 'All Set!',
    subtitle: 'Your profile and talent score are ready. Explore matched roles next.',
  },
}

export function ProfileWizard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const stepParam = Number(searchParams.get('step'))
  const parsedStep = parseOnboardingStepParam(stepParam)
  const initialStep = parsedStep
  const [step, setStep] = useState<WizardStep>(initialStep)
  const [completedThrough, setCompletedThrough] = useState(() =>
    uiCompletedThrough(getProfile()?.completedSteps),
  )
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
      noPriorWorkExperience: saved.noPriorWorkExperience ?? false,
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
  const [extractModalOpen, setExtractModalOpen] = useState(false)
  const [extractModalName, setExtractModalName] = useState<string | undefined>()

  useEffect(() => {
    const saved = getProfile()
    if (isOnboardingComplete(saved)) {
      navigate('/dashboard', { replace: true })
      return
    }
    if (saved?.completedSteps) {
      setCompletedThrough(uiCompletedThrough(saved.completedSteps))
    }
    const hasStepParam = Number.isFinite(stepParam) && stepParam > 0
    if (!hasStepParam && saved) {
      const resume = onboardingResumeStep(saved)
      setStep(resume)
      setCompletedThrough(uiCompletedThrough(saved.completedSteps ?? 0))
    }
    if (sessionStorage.getItem('hireright.wizardStep') === '5') {
      sessionStorage.removeItem('hireright.wizardStep')
      setStep(3)
      setCompletedThrough((prev) => Math.max(prev, 2))
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
    if (step === 2 && isScheduled) {
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
      step === 3
        ? ONBOARDING_STEP_COUNT
        : Math.max(completedThrough, legacyCompletedAfterUiStep(step))
    await persist(
      step === 3
        ? 'Onboarding complete — you can update your profile anytime from the dashboard.'
        : step === 2
          ? isScheduled
            ? 'Interview scheduled! Moving to matched roles…'
            : 'Profile saved. Opening AI interview…'
          : `Step ${step} saved. Moving forward…`,
      nextCompleted,
    )
    setCompletedThrough(uiCompletedThrough(nextCompleted))

    if (step === 2 && !isScheduled) {
      beginImmediateInterview(navigate)
      return
    }

    if (step < 3) {
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
              <OnboardingProfileStep
                data={data}
                onChange={updateField}
                onPatch={patchFields}
                onExtracted={({ firstName: extractedName, fieldCount }) => {
                  if (extractedName) setUserName(extractedName)
                  if (fieldCount > 0) {
                    setExtractModalName(extractedName)
                    setExtractModalOpen(true)
                  }
                }}
              />
            )}
            {step === 2 && (
              <AiInterviewStep data={data} onChange={updateField} />
            )}
            {step === 3 && (
              <CompleteStep
                data={data}
                onEditStep={(next) => setStep(next === 4 ? 2 : 3)}
              />
            )}
          </motion.div>
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
                  : step === 2
                    ? isScheduled
                      ? 'Save & Submit'
                      : 'Save & Start AI Interview'
                    : step === 3
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
                  {saving ? 'Saving…' : step === 3 ? 'Finish' : 'Save & Continue'}
                  {step < 3 && (
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

      <OnboardingExtractModal
        open={extractModalOpen}
        firstName={extractModalName}
        onClose={() => setExtractModalOpen(false)}
      />

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
