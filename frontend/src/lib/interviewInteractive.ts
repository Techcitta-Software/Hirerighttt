import flowJson from '../data/interviewInteractiveFlow.json'
import { firstName } from './store'

export type InteractiveFlowStepId = 'day_check' | 'confirm_begin' | 'questions'

export type InteractiveCommandAction =
  | 'advance'
  | 'affirmative'
  | 'end_interview'
  | 'speak'
  | 'listen'
  | 'goto'
  | 'start_questions'
  | 'wait'
  | 'replay'
  | 'repeat_question'
  | 'speak_slower'

export type InterviewInteractiveResponse = {
  action: InteractiveCommandAction
  spoken?: string
  nextPhase: InteractiveFlowStepId
  startQuestions?: boolean
  interactive?: boolean
  replay?: boolean
  adjustSpeechRate?: number
}

type FlowStep = {
  id: string
  label?: string
  action: string
  spokenTemplate?: string
  notReadyTemplate?: string
  hint?: string
  minResponseChars?: number
  advanceMode?: 'response_or_next' | 'affirmative_or_next' | 'auto_after_speak'
  nextStep?: string
  onAdvanceAction?: string
}

const flow = flowJson as {
  steps: FlowStep[]
  commands: { id: string; patterns: string[]; action: string }[]
  voice?: { rate?: number }
}

const WARMUP_STEP_IDS = flow.steps.map((s) => s.id) as InteractiveFlowStepId[]

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function matchesAnyPattern(text: string, patterns: string[]): boolean {
  const n = normalize(text)
  if (!n) return false
  return patterns.some((p) => {
    const pat = normalize(p)
    return n === pat || n.includes(pat)
  })
}

export function commandPatterns(commandId: string): string[] {
  return flow.commands.find((c) => c.id === commandId)?.patterns ?? []
}

export function isNextQuestionCommand(text: string): boolean {
  return matchesAnyPattern(text, commandPatterns('next_question'))
}

export function isAffirmativeResponse(text: string): boolean {
  return matchesAnyPattern(text, commandPatterns('affirmative'))
}

export function isRepeatLastCommand(text: string): boolean {
  return matchesAnyPattern(text, commandPatterns('repeat_last'))
}

export function isRepeatQuestionCommand(text: string): boolean {
  return matchesAnyPattern(text, commandPatterns('repeat_question'))
}

export function isSpeakSlowerCommand(text: string): boolean {
  return matchesAnyPattern(text, commandPatterns('speak_slower'))
}

export function isTakeMomentCommand(text: string): boolean {
  return matchesAnyPattern(text, commandPatterns('take_moment'))
}

export function flowStep(id: InteractiveFlowStepId): FlowStep | undefined {
  if (id === 'questions') return undefined
  return flow.steps.find((s) => s.id === id)
}

export function warmupStepIds(): InteractiveFlowStepId[] {
  return WARMUP_STEP_IDS
}

export function warmupProgress(stepId: InteractiveFlowStepId): number {
  if (stepId === 'questions') return 100
  const idx = WARMUP_STEP_IDS.indexOf(stepId)
  if (idx < 0) return 10
  return Math.round(((idx + 1) / (WARMUP_STEP_IDS.length + 1)) * 100)
}

export function stepHint(stepId: InteractiveFlowStepId): string {
  const step = flowStep(stepId)
  return step?.hint || 'Reply when ready, or say "next question".'
}

export function stepLabel(stepId: InteractiveFlowStepId): string {
  const step = flowStep(stepId)
  return step?.label || 'Warm-up'
}

export function interviewTimeOfDayLabel(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 12)
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

export function fillTemplate(template: string, role: string, profileFirst?: string): string {
  const fn = profileFirst || firstName()
  return template
    .replace(/\{firstName\}/g, fn)
    .replace(/\{role\}/g, role)
    .replace(/\{timeOfDay\}/g, interviewTimeOfDayLabel())
}

export function isAutoAdvanceAfterSpeakStep(stepId: InteractiveFlowStepId): boolean {
  const step = flowStep(stepId)
  return step?.advanceMode === 'auto_after_speak'
}

export function nextFlowStepId(stepId: InteractiveFlowStepId): InteractiveFlowStepId | null {
  const step = flowStep(stepId)
  if (!step?.nextStep) return null
  return step.nextStep as InteractiveFlowStepId
}

export function spokenForStep(stepId: InteractiveFlowStepId, role: string): string {
  const step = flowStep(stepId)
  if (!step?.spokenTemplate) return ''
  return fillTemplate(step.spokenTemplate, role)
}

function canAdvanceStep(
  step: FlowStep,
  text: string,
): { advance: boolean; softWait: boolean } {
  const minChars = step.minResponseChars ?? 2
  const wantsNext = isNextQuestionCommand(text)
  const wantsYes = isAffirmativeResponse(text)
  const hasResponse = text.length >= minChars
  const mode = step.advanceMode || 'response_or_next'

  if (wantsNext) return { advance: true, softWait: false }

  if (mode === 'auto_after_speak') {
    if (text.length >= (step.minResponseChars ?? 1)) {
      return { advance: true, softWait: false }
    }
    return { advance: false, softWait: false }
  }

  if (mode === 'affirmative_or_next') {
    if (wantsYes) return { advance: true, softWait: false }
    if (hasResponse) return { advance: false, softWait: true }
    return { advance: false, softWait: false }
  }

  if (hasResponse) return { advance: true, softWait: false }
  return { advance: false, softWait: false }
}

function nextStepSpoken(nextId: string, role: string, fn: string): string {
  if (nextId === 'questions') {
    return `Great — let's get started, ${fn}. Here's your first question.`
  }
  const next = flow.steps.find((s) => s.id === nextId)
  return next?.spokenTemplate ? fillTemplate(next.spokenTemplate, role, fn) : ''
}

/** Client-side interactive state machine (mirrors backend JSON contract). */
export function resolveInteractiveTurn(input: {
  phase: InteractiveFlowStepId
  userText: string
  role: string
  firstName?: string
}): InterviewInteractiveResponse | null {
  if (input.phase === 'questions') return null

  const text = input.userText.trim()
  const fn = input.firstName || firstName()
  const step = flowStep(input.phase)
  if (!step) return null

  if (isRepeatLastCommand(text)) {
    return {
      action: 'replay',
      nextPhase: input.phase,
      spoken: fillTemplate(step.spokenTemplate || '', input.role, fn),
      replay: true,
      interactive: true,
    }
  }

  if (isSpeakSlowerCommand(text)) {
    return {
      action: 'speak_slower',
      nextPhase: input.phase,
      spoken: `Sure ${fn}, I'll speak a little slower. ${fillTemplate(step.spokenTemplate || '', input.role, fn)}`,
      adjustSpeechRate: 0.82,
      replay: true,
      interactive: true,
    }
  }

  if (isTakeMomentCommand(text)) {
    return {
      action: 'wait',
      nextPhase: input.phase,
      spoken: `Of course, ${fn}. Take your time. Say yes when you're ready.`,
      interactive: true,
    }
  }

  const { advance, softWait } = canAdvanceStep(step, text)

  if (advance && step.nextStep) {
    const startQuestions = step.onAdvanceAction === 'start_questions'
    return {
      action: startQuestions ? 'start_questions' : 'goto',
      nextPhase: (startQuestions ? 'questions' : step.nextStep) as InteractiveFlowStepId,
      spoken: nextStepSpoken(step.nextStep, input.role, fn),
      startQuestions,
      interactive: true,
    }
  }

  if (softWait && step.notReadyTemplate) {
    return {
      action: 'wait',
      nextPhase: input.phase,
      spoken: fillTemplate(step.notReadyTemplate, input.role, fn),
      interactive: true,
    }
  }

  return {
    action: 'listen',
    nextPhase: input.phase,
    spoken: fillTemplate(step.spokenTemplate || '', input.role, fn),
    interactive: false,
  }
}

export function exportFlowJson(): typeof flowJson {
  return flowJson
}

export function defaultInterviewSpeechRate(): number {
  return flow.voice?.rate ?? 0.94
}
