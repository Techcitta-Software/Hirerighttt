import { useMemo } from 'react'
import styles from './InterviewCompletionPanel.module.css'

export type AnalysisStepId =
  | 'wrap_up'
  | 'save_integrity'
  | 'store_recording'
  | 'score_answers'
  | 'prepare_report'

export type AnalysisStepStatus = 'pending' | 'active' | 'done' | 'skipped'

export type AnalysisStep = {
  id: AnalysisStepId
  label: string
  detail?: string
  status: AnalysisStepStatus
}

export type InterviewCompletionSummary = {
  candidateName: string
  role: string
  level: string
  answeredCount: number
  totalQuestions: number
  durationLabel: string
  integrityEnded: boolean
  recordingUrl: string | null
  recordingNote: string
}

const STEP_COPY: Record<AnalysisStepId, { label: string; detail: string }> = {
  wrap_up: {
    label: 'Session closed',
    detail: 'Your answers are locked for review.',
  },
  save_integrity: {
    label: 'Integrity log saved',
    detail: 'Focus and camera events attached to this session.',
  },
  store_recording: {
    label: 'Recording stored',
    detail: 'Video is being written to secure storage when available.',
  },
  score_answers: {
    label: 'Answers scored',
    detail: 'Communication, depth, and role fit are evaluated per response.',
  },
  prepare_report: {
    label: 'Report prepared',
    detail: 'Opening your scorecard next.',
  },
}

export function defaultAnalysisSteps(): AnalysisStep[] {
  return (Object.keys(STEP_COPY) as AnalysisStepId[]).map((id, index) => ({
    id,
    label: STEP_COPY[id].label,
    detail: STEP_COPY[id].detail,
    status: index === 0 ? 'active' : 'pending',
  }))
}

export function setAnalysisStep(
  steps: AnalysisStep[],
  id: AnalysisStepId,
  status: AnalysisStepStatus,
): AnalysisStep[] {
  const idx = steps.findIndex((s) => s.id === id)
  if (idx < 0) return steps
  return steps.map((step, i) => {
    if (i < idx) {
      if (step.status === 'skipped' || step.status === 'done') return step
      return { ...step, status: 'done' }
    }
    if (i === idx) return { ...step, status }
    return step
  })
}

type Props = {
  summary: InterviewCompletionSummary
  steps: AnalysisStep[]
}

function firstName(full: string): string {
  const trimmed = full.trim()
  if (!trimmed || trimmed === 'there' || trimmed === 'Candidate') return ''
  return trimmed.split(/\s+/)[0] || ''
}

export function InterviewCompletionPanel({ summary, steps }: Props) {
  const greet = firstName(summary.candidateName)
  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const activeIdx = steps.findIndex((s) => s.status === 'active')
  const progress = Math.min(
    100,
    Math.round(((doneCount + (activeIdx >= 0 ? 0.45 : 0)) / Math.max(steps.length, 1)) * 100),
  )

  const headline = useMemo(() => {
    if (summary.integrityEnded) {
      return greet ? `Thanks, ${greet} — this session is closed` : 'This session is closed'
    }
    return greet ? `Congratulations, ${greet}!` : 'Congratulations!'
  }, [greet, summary.integrityEnded])

  const subcopy = summary.integrityEnded
    ? 'This interview was ended early. The answers you already gave are still being reviewed for your record.'
    : 'You completed your interview — well done. Thank you for the time and thought you put into your answers. We are preparing your personalised scorecard now.'

  return (
    <section className={styles.root} aria-live="polite" aria-busy={progress < 100}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.kicker}>Interview complete</p>
          <h1 className={styles.title}>{headline}</h1>
          <p className={styles.lede}>{subcopy}</p>
        </header>

        <div className={styles.meta}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Role</span>
            <strong>{summary.role}</strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Level</span>
            <strong>{summary.level}</strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Answered</span>
            <strong>
              {summary.answeredCount}
              {summary.totalQuestions > 0 ? ` of ${summary.totalQuestions}` : ''}
            </strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Duration</span>
            <strong>{summary.durationLabel}</strong>
          </div>
        </div>

        <div className={styles.progressBlock}>
          <div className={styles.progressHead}>
            <span>Preparing your report</span>
            <span className={styles.progressPct}>{progress}%</span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
        </div>

        <p className={styles.footerNote}>
          Please keep this page open — your scorecard will appear automatically in a moment.
        </p>
      </div>
    </section>
  )
}
