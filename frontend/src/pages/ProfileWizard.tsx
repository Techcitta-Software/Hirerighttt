import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { OnboardingExtractModal } from '../components/OnboardingExtractModal'
import { OnboardingProfileStep } from '../components/OnboardingProfileStep'
import { AiInterviewStep } from '../components/AiInterviewStep'
import { CompleteStep } from '../components/CompleteStep'
import { Sidebar } from '../components/Sidebar'
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
import { consumeInviteReturn } from '../lib/inviteReturn'
import { easeOut, fadeUp, stepPanel } from '../motion/variants'
import styles from './ProfileWizard.module.css'

const STEP_TITLES: Record<WizardStep, { title: string; subtitle: string }> = {
  1: {
    title: 'Let’s build your profile',
    subtitle:
      'Upload your resume — we’ll extract your details so you can review and continue in one step.',
  },
  2: {
    title: 'Ready for your AI interview',
    subtitle:
      'Ava will ask about the role and skills you just added — then score you live on camera.',
  },
  3: {
    title: 'All set',
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
    if (sessionStorage.getItem('hireright.wizardStep') === '5') {
      sessionStorage.removeItem('hireright.wizardStep')
      setCompletedThrough((prev) => Math.max(prev, 2))
      goToStep(3, { replace: true })
      return
    }
    if (hasStepParam) {
      // The URL is the source of truth: refresh and the browser's Back/Forward land on the right step.
      setStep(parseOnboardingStepParam(stepParam))
    } else {
      if (saved) setCompletedThrough(uiCompletedThrough(saved.completedSteps ?? 0))
      goToStep(saved ? onboardingResumeStep(saved) : 1, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, stepParam])

  /** Moves to a wizard step and records it in the URL (?step=N) so refresh and browser Back keep the step. */
  function goToStep(next: WizardStep, opts: { replace?: boolean } = {}) {
    setStep(next)
    navigate({ search: `?step=${next}` }, { replace: Boolean(opts.replace) })
  }

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
      // The button shows "Saving…" itself: never raise the full-page loading veil for this.
      if (await apiHealth()) await apiSaveProfile(saved, { background: true })
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

    // Arrived from an emailed interview link: once the resume/profile is saved, go back to that interview
    // (its job and time slot) instead of starting a new, unrelated one from this wizard.
    if (step === 1) {
      const inviteBack = consumeInviteReturn()
      if (inviteBack) {
        navigate(inviteBack, { replace: true })
        return
      }
    }

    if (step === 2 && !isScheduled) {
      beginImmediateInterview(navigate)
      return
    }

    if (step < 3) {
      goToStep((step + 1) as WizardStep)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  const meta = STEP_TITLES[step]
  const showAutoSaveFooter = step >= 2
  const isScheduled = Boolean(data.interviewNotes?.startsWith('Scheduled:'))

  const arrowIcon = (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 10H16M16 10L11 5M16 10L11 15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
  const stepCount = (
    <span className={styles.stepCount}>
      Step {step} of {STEPS.length}
    </span>
  )

  return (
    <motion.div
      className={styles.layout}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: easeOut }}
    >
      <div className={styles.topbarSlot}>
        <TopBar userName={userName} />
      </div>

      <Sidebar
        step={step}
        completedThrough={completedThrough}
        onStepClick={(next) => goToStep(next)}
      />

      <main id="app-main" className={styles.main}>
        <motion.header
          className={styles.pageHeader}
          key={`header-${step}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: easeOut }}
        >
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </motion.header>

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
                onEditStep={(next) => goToStep(next === 4 ? 2 : 3)}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <footer className={styles.actions}>
          {showAutoSaveFooter ? (
            <>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => goToStep((step - 1) as WizardStep)}
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
              </button>

              <div className={styles.actionMeta}>
                {stepCount}
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
              </div>

              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleContinue}
                // Step 2: booking needs a chosen time ("Take interview immediately" above starts right away).
                disabled={saving || (step === 2 && !isScheduled)}
                aria-busy={saving || undefined}
              >
                {saving
                  ? 'Saving…'
                  : step === 2
                    ? isScheduled
                      ? 'Confirm slot'
                      : 'Pick a time to book'
                    : step === 3
                      ? 'Explore matched roles'
                      : 'Save and continue'}
                {arrowIcon}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={handleSaveExit}
                disabled={saving}
              >
                Save and exit
              </button>

              <div className={styles.actionMeta}>{stepCount}</div>

              <div className={styles.actionRight}>
                {step > 1 && (
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => goToStep((step - 1) as WizardStep)}
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleContinue}
                  disabled={saving}
                  aria-busy={saving || undefined}
                >
                  {saving ? 'Saving…' : step === 3 ? 'Finish' : 'Save and continue'}
                  {step < 3 && arrowIcon}
                </button>
              </div>
            </>
          )}
        </footer>
      </main>

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
