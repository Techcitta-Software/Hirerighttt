/** Six-turn plan shared in behavior with backend/node/interviewQuestionPlan.mjs. */
import type { Question } from './interviewEngine'
import type { SavedProfile } from './store'
import { ROLE_SKILL_LIBRARY } from './roleSkillLibrary'
export type PlanContext = { skills?: string[]; jobs?: string[]; achievements?: string[]; resumeSnippet?: string; certs?: string[]; role?: string }
const clean = (s: unknown): string => String(s ?? '').trim()
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))]
const spokenLead = (first: string, text: string) => first && first !== 'there' ? `${first}, ${text}` : text.charAt(0).toUpperCase() + text.slice(1)
type StructuredRaw = Question & { focus?: string }


export function resolveExactInterviewRole(profile: SavedProfile | null, roleOverride = ''): string {
  return clean(profile?.currentRole) || clean(profile?.workExperiences?.find(w => w.jobTitle)?.jobTitle) || clean(roleOverride) || 'Software Engineer'
}

export function isPlanFresher(profile: SavedProfile | null, ctx: PlanContext, level = ''): boolean {
  const experience = clean(profile?.totalExperience) || clean(level)
  if (/fresher|student|no (?:work )?experience|^0(?:\s*(?:years?|months?))?$|less than 1/i.test(experience)) return true
  if ((ctx.jobs || []).length || profile?.workExperiences?.some(w => w.company || w.jobTitle)) return false
  const years = Number.parseFloat(experience)
  return !Number.isFinite(years) || years === 0
}

export function recommendTopSkillsForRole(exactRole: string, ctx: PlanContext): string[] {
  const defaults = ROLE_SKILL_LIBRARY.find(entry => entry.test.test(exactRole))?.skills
  // Only role-relevant evidence can reorder core skills; unrelated résumé keywords cannot.
  if (!defaults) return [`${exactRole} fundamentals`, `${exactRole} quality and risk principles`]
  const canonical = (value: string) => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '')
  const evidence = (ctx.skills || []).map(canonical)
  const known = defaults.filter(skill => evidence.includes(canonical(skill)))
  return unique([...known, ...defaults]).slice(0, 8)
}

function codingLanguage(ctx: PlanContext): string {
  const languages = /^(?:python|java|javascript|typescript|c\+\+|c#|c|go|golang|ruby|kotlin|swift|php|dart|rust|scala|r)$/i
  const explicit = (ctx.skills || []).map(clean).find(s => languages.test(s))
  if (explicit) return explicit
  const match = clean(ctx.resumeSnippet).match(/\b(Python|JavaScript|TypeScript|Java|Kotlin|Swift|PHP|Dart|Rust|Scala)\b|C\+\+|C#/i)
  return match?.[0] || 'a programming language you know'
}

const THEORY_TOPICS: [RegExp, string, string][] = [
  [/^sql$|postgres|mysql/i, 'how INNER JOIN differs from LEFT JOIN, including what happens when there is no matching row', 'how transaction isolation prevents concurrency anomalies and what trade-offs higher isolation introduces'],
  [/react/i, 'how props and state differ and when a component re-renders', 'how reconciliation and stable keys affect component identity and state preservation'],
  [/node/i, 'how the event loop handles asynchronous I/O', 'how backpressure works in streams and why ignoring it can exhaust memory'],
  [/javascript|typescript/i, 'how lexical scope and closures work', 'how the event loop orders microtasks and tasks and why that order matters'],
  [/python/i, 'how mutable and immutable objects differ and what that means for function arguments', 'how generators manage lazy evaluation and how their memory behavior differs from lists'],
  [/^java$/i, 'how interfaces differ from abstract classes', 'how thread safety and the Java memory model affect shared mutable state'],
  [/^c\+\+$|^c#$/i, 'how value and reference semantics differ', 'how resource ownership and object lifetime affect memory safety'],
  [/docker/i, 'how an image differs from a container', 'how layered filesystems and multi-stage builds affect reproducibility and image size'],
  [/kubernetes/i, 'how a deployment differs from a service', 'how readiness and liveness probes affect rollout safety and availability'],
  [/statistics/i, 'how correlation differs from causation', 'how selection bias and confounding affect causal interpretation'],
  [/ai \/ ml/i, 'how overfitting differs from underfitting', 'how data leakage affects model validation and how to prevent it'],
  [/financial accounting/i, 'how accrual accounting differs from cash accounting', 'how revenue recognition and matching principles affect financial statements'],
  [/patient assessment/i, 'how subjective and objective assessment findings differ', 'how assessment priorities change when multiple clinical risks are present'],
  [/infection prevention/i, 'how standard precautions differ from transmission-based precautions', 'how the hierarchy of controls reduces infection transmission risk'],
  [/customer discovery/i, 'how an open question differs from a leading question when identifying customer needs', 'how confirmation bias affects qualification and how to reduce it'],
  [/negotiation/i, 'what BATNA means and why it matters', 'how reservation value and bargaining zones affect negotiation strategy'],
]

function buildSkillQuestion(first: string, skill: string, level: string, turn: number, fresher: boolean): StructuredRaw {
  const senior = !fresher && (/senior|lead|principal|architect/i.test(level) || Number.parseFloat(level) / (/month/i.test(level) ? 12 : 1) >= 5)
  const topics = THEORY_TOPICS.find(([pattern]) => pattern.test(skill))
  const concept = topics ? topics[senior ? 2 : 1] : senior ? `the key trade-offs and failure modes in ${skill}` : `a fundamental principle of ${skill} and why it matters`
  return {
    text: spokenLead(first, skill === 'a programming language you know'
      ? 'choose a programming language you know and explain how its variables and data types work.'
      : `in ${skill}, explain ${concept}.`),
    category: 'Technical', keywords: [skill.toLowerCase()], hint: 'Explain the concept directly. No résumé or past-work example is required.',
    topic: skill, focus: `structured-theory-${turn}`,
  }
}

function projectQuestion(first: string, ctx: PlanContext, turn: number): StructuredRaw {
  const label = (ctx.achievements || []).map(clean).find(Boolean)
  const intro = label ? `for the project or achievement “${label.slice(0, 120)}”` : 'choose an academic, personal or practice project'
  return { text: spokenLead(first, turn === 3 ? `${intro}: what problem did it address and what did you personally implement?` : 'thinking about that project, how did you test it and diagnose one problem you encountered?'),
    category: turn === 3 ? 'Experience' : 'Problem Solving', keywords: ['project', turn === 3 ? 'contribution' : 'testing'], hint: 'Use an academic, personal or practice project; employment is not required.', topic: turn === 3 ? 'Project contribution' : 'Project validation', focus: `structured-project-${turn}` }
}

export function buildStructuredTurnQuestion(options: {
  turnNumber: number; first: string; level: string; profile: SavedProfile | null; ctx: PlanContext;
  roleOverride?: string; history?: { question: Question; answer: string }[]; senior?: boolean
}): StructuredRaw | null {
  const { turnNumber: turn, first, level, profile, ctx } = options
  if (turn < 1 || turn > 6) return null
  const role = resolveExactInterviewRole(profile, options.roleOverride || ctx.role)
  const fresh = isPlanFresher(profile, ctx, level)
  const skills = fresh ? [codingLanguage(ctx), 'SQL'] : recommendTopSkillsForRole(role, ctx).slice(0, 2)
  if ((fresh && turn <= 2) || (!fresh && turn >= 3 && turn <= 4)) return buildSkillQuestion(first, skills[fresh ? turn - 1 : turn - 3], clean(profile?.totalExperience) || level, turn, fresh)
  if (turn <= 4) {
    if (fresh) return projectQuestion(first, ctx, turn)
    const job = clean(ctx.jobs?.[turn - 1] || ctx.jobs?.[0]).split(':')[0] || `your work as a ${role}`
    return { text: spokenLead(first, turn === 1 ? `in ${job}, what responsibilities did you own and what result best demonstrates your contribution?` : `for a different challenge in ${job}, describe a difficult problem you solved and explain the decisions and trade-offs behind your approach.`),
      category: 'Experience', keywords: ['responsibility', 'decision', 'result'], hint: 'Describe your actual work and personal contribution.', topic: turn === 1 ? 'Work responsibilities' : 'Work problem solving', resumeAnchor: job, focus: `structured-work-${turn}` }
  }
  if (turn === 5) {
    const cert = clean(ctx.certs?.[0] || profile?.certifications?.[0]?.name)
    return { text: spokenLead(first, cert ? `what is one important concept you learned in ${cert}, and how would you apply it to a task?` : fresh ? 'what would you improve in your project next, and why would that improvement matter?' : 'choose a project you contributed to: what was your contribution and how did you validate its outcome?'),
      category: 'Problem Solving', keywords: [cert || 'project', 'learning'], hint: 'Discuss a real project or certification; do not invent a credential.', topic: cert || 'Project reflection', focus: cert ? 'structured-cert' : 'structured-project' }
  }
  return { text: spokenLead(first, `last question: what interests you about working as a ${role}, and what would you like to learn next?`), category: 'Communication', keywords: ['motivation', 'learning'], hint: 'Share your motivation and learning goals.', topic: 'Closing', focus: 'structured-closing' }
}

export function structuredPlanSummary(exactRole: string, ctx: PlanContext, profile: SavedProfile | null = null, level = '') {
  const fresher = isPlanFresher(profile, ctx, level)
  const skills = fresher ? [codingLanguage(ctx), 'SQL'] : recommendTopSkillsForRole(exactRole, ctx).slice(0, 2)
  return { exactRole, fresher, recommendedSkills: skills, turnPlan: fresher ? [
    `Q1 theory: ${skills[0]} fundamentals; no past-work or résumé question`, 'Q2 theory: SQL fundamentals; no past-work or résumé question',
    'Q3: academic/personal project contribution; do not assume employment', 'Q4: project testing and problem solving; do not repeat Q3',
    'Q5: certification learning, or project improvement if no certification exists', 'Q6: general motivation or learning goals',
  ] : [
    'Q1: work responsibilities and personal contribution', 'Q2: a distinct work problem, decisions and outcome',
    `Q3 theory: ${skills[0]}; conceptual knowledge, not a résumé example`, `Q4 theory: ${skills[1]}; conceptual knowledge, not a résumé example`,
    'Q5: project contribution or certification learning', 'Q6: general motivation or learning goals',
  ] }
}

/** Reject obvious slot drift; caller retries the same model then uses the slot-specific fallback. */
export function questionMatchesPlan(question: { text?: string; topic?: string; resumeAnchor?: string }, plan: ReturnType<typeof structuredPlanSummary>, turn: number): boolean {
  const text = clean(question.text)
  const theory = plan.fresher ? turn <= 2 : turn === 3 || turn === 4
  if (theory) {
    const skill = plan.recommendedSkills[plan.fresher ? turn - 1 : turn - 3]
    if (question.resumeAnchor || /résumé|resume|your (?:project|experience|work|background)|you (?:used|built|implemented|worked|applied)|tell me about a time|describe a (?:time|situation|challenge)|you have|you've/i.test(text)) return false
    const normalized = (value: string) => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '')
    if (skill !== 'a programming language you know' && !normalized(text).includes(normalized(skill))) return false
    return /explain|what|how|why|compare|difference|define/i.test(text)
  }
  if (turn === 6) return /motivat|interest|learn|goal|strength|next step|why|aspir/i.test(text)
  if (plan.fresher && turn <= 4) return /project|academic|practice|coursework|assignment/i.test(text) && !/your (?:employer|company|job)|at work/i.test(text)
  if (turn === 5) return /project|certif|credential|course|learned|improv/i.test(text)
  return /work|responsibilit|role|contribut|problem|decision|challenge/i.test(text)
}
