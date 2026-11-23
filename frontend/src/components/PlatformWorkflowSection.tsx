import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { HrIcon, type HrIconName } from './HrIcon'
import styles from './PlatformWorkflowSection.module.css'

export type WorkflowRoleMode = 'candidate' | 'employer'

export type WorkflowStep = {
  step: string
  title: string
  desc: string
  icon: HrIconName
  highlight: string
}

export const CANDIDATE_WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: '01',
    title: 'Smart Ingestion & Resume Parsing',
    desc: 'Drop your resume (PDF or Word). Our intelligent parser extracts your technical skills, seniority level, past roles, and achievements in under 10 seconds.',
    icon: 'document',
    highlight: 'Instant skill graph generation',
  },
  {
    step: '02',
    title: "Ava's AI Video Interview Studio",
    desc: 'Enter the interactive video room. Ava asks targeted technical and architectural questions tailored directly to your resume and target role. Speak your answers naturally.',
    icon: 'mic',
    highlight: 'Speech-to-text & anti-cheat proctoring',
  },
  {
    step: '03',
    title: 'Multi-Dimensional Scorecard',
    desc: 'Ava generates an instant breakdown across Technical Depth, Communication Clarity, Problem Solving, and System Design with detailed strengths and growth recommendations.',
    icon: 'chart',
    highlight: 'Certified 0–100 Talent Score',
  },
  {
    step: '04',
    title: 'Ranked Matches & Direct Offers',
    desc: "Your certified score unlocks matching company openings. Apply with a single click and land directly at the top of hiring managers' candidate shortlists.",
    icon: 'rocket',
    highlight: '4x faster time-to-offer',
  },
]

export const EMPLOYER_WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: '01',
    title: 'Create Private Job Openings',
    desc: 'Define role tracks, seniority benchmarks, required skill tags, and custom Job Descriptions (JDs) in under 2 minutes.',
    icon: 'building',
    highlight: 'Customizable interview rubrics',
  },
  {
    step: '02',
    title: 'Generate Shareable Apply Links',
    desc: "Share private invite links (/apply/{code}) with applicants. Candidates take Ava's tailored video screen without needing prior account setup.",
    icon: 'link',
    highlight: 'Self-service candidate screening',
  },
  {
    step: '03',
    title: 'Inspect Anti-Cheat & Video Replays',
    desc: 'Review applicants with interactive video timelines, red proctoring violation markers, and automated STAR answer breakdowns.',
    icon: 'shield-check',
    highlight: 'Comprehensive proctor integrity timeline',
  },
  {
    step: '04',
    title: 'Automate ATS Pipeline & Offers',
    desc: 'Manage your recruitment pipeline via Kanban stages (Screening, Shortlisted, Technical, Offer) and export candidate dossiers with one click.',
    icon: 'zap',
    highlight: 'OpenATS & pipeline sync',
  },
]

type PlatformWorkflowSectionProps = {
  showRoleToggle?: boolean
  roleMode?: WorkflowRoleMode
  onRoleModeChange?: (mode: WorkflowRoleMode) => void
  className?: string
}

export function PlatformWorkflowSection({
  showRoleToggle = true,
  roleMode: controlledMode,
  onRoleModeChange,
  className,
}: PlatformWorkflowSectionProps) {
  const [internalMode, setInternalMode] = useState<WorkflowRoleMode>('candidate')
  const roleMode = controlledMode ?? internalMode

  function setRoleMode(next: WorkflowRoleMode) {
    if (controlledMode === undefined) setInternalMode(next)
    onRoleModeChange?.(next)
  }

  const steps = roleMode === 'candidate' ? CANDIDATE_WORKFLOW_STEPS : EMPLOYER_WORKFLOW_STEPS

  return (
    <div className={['hr-marketing-band', className].filter(Boolean).join(' ')}>
    <section
      className="hr-marketing-section"
      aria-labelledby="platform-workflow-heading"
    >
      <p className="hr-marketing-kicker">How it works</p>
      <h2 className="hr-marketing-title" id="platform-workflow-heading">
        From resume to ranked matches
      </h2>
      <p className="hr-marketing-lead">
        Same journey for candidates and employers — pick your path, then follow the four steps below.
      </p>

      {showRoleToggle && (
        <div className={styles.toggleRow}>
          <button
            type="button"
            className={`${styles.pillBtn} ${roleMode === 'candidate' ? styles.pillBtnActive : ''}`}
            onClick={() => setRoleMode('candidate')}
          >
            <HrIcon name="user" size={18} />
            Candidate Journey
          </button>
          <button
            type="button"
            className={`${styles.pillBtn} ${roleMode === 'employer' ? styles.pillBtnActive : ''}`}
            onClick={() => setRoleMode('employer')}
          >
            <HrIcon name="building" size={18} />
            Employer & Recruiter Journey
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={roleMode}
          className={styles.stepsGrid}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3 }}
        >
          {steps.map((s) => (
            <article key={s.step} className="hr-surface-card">
              <div className={styles.stepHead}>
                <span className={styles.stepNum}>{s.step}</span>
                <span className="hr-icon-tile hr-icon-tile-sm" aria-hidden>
                  <HrIcon name={s.icon} size={18} />
                </span>
              </div>
              <h3 className="hr-card-title">{s.title}</h3>
              <p className="hr-card-body">{s.desc}</p>
              <div className="hr-accent-line">
                <HrIcon name="check" size={14} strokeWidth={2.5} />
                {s.highlight}
              </div>
            </article>
          ))}
        </motion.div>
      </AnimatePresence>

      <div className="hr-surface-card" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
        <span className={`hr-marketing-kicker ${styles.ctaKickerTeal}`}>
          {roleMode === 'candidate' ? 'TRY AVA NOW' : 'HIRE SMARTER'}
        </span>
        <h2 className={styles.ctaTitle}>
          {roleMode === 'candidate'
            ? 'Ready to Experience Your AI Video Interview?'
            : 'Launch Your First AI Job Opening Today'}
        </h2>
        <p className={styles.ctaBody}>
          {roleMode === 'candidate'
            ? 'It takes less than 12 minutes to receive your certified score and unlock ranked top match jobs.'
            : 'Join fast-growing companies using HireRighttt to screen hundreds of candidates with zero manual recruiter burnout.'}
        </p>
        <div className={styles.ctaActions}>
          <Link
            to={roleMode === 'candidate' ? '/interview' : '/employer/dashboard'}
            className={styles.primaryCta}
          >
            {roleMode === 'candidate' ? 'Launch Interview Studio' : 'Open Employer Studio'}
            <HrIcon name="arrow-right" size={18} />
          </Link>
          <Link to="/signup" className={styles.secondaryCta}>
            Sign Up Free
          </Link>
        </div>
      </div>
    </section>
    </div>
  )
}
