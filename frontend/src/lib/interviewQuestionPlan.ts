/**
 * Structured 6-turn interview plan (mirrors backend/node/interviewQuestionPlan.mjs).
 */
import type { Question } from './interviewEngine'
import type { SavedProfile } from './store'

export type PlanContext = {
  skills?: string[]
  jobs?: string[]
  achievements?: string[]
  resumeSnippet?: string
  certs?: string[]
  role?: string
}

const INTERVIEW_TURN_COUNT = 6

function clean(s: unknown): string {
  return String(s ?? '').trim()
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))]
}

const ROLE_SKILL_LIBRARY: { test: RegExp; skills: string[] }[] = [
  {
    test: /\bfull[\s-]?stack|mern|mean\b/i,
    skills: ['React.js', 'Node.js', 'TypeScript', 'REST APIs', 'SQL', 'MongoDB', 'System Design', 'Git'],
  },
  {
    test: /\bfront[\s-]?end|frontend\b/i,
    skills: ['React.js', 'TypeScript', 'JavaScript', 'HTML5 & CSS3', 'TailwindCSS', 'Next.js', 'Redux', 'REST APIs'],
  },
  {
    test: /\bback[\s-]?end|backend\b/i,
    skills: ['Node.js', 'Python', 'Java', 'PostgreSQL', 'REST APIs', 'System Design', 'Docker', 'Redis'],
  },
  {
    test: /\bsoftware engineer|software developer\b/i,
    skills: ['JavaScript', 'Python', 'Git', 'SQL', 'REST APIs', 'System Design', 'Agile', 'Problem Solving'],
  },
  {
    test: /\bdata scientist|machine learning|ml engineer|ai engineer\b/i,
    skills: ['Python', 'AI / ML', 'SQL', 'Statistics', 'Data Structures', 'TensorFlow', 'Pandas', 'Communication'],
  },
  {
    test: /\bdevops|sre|platform engineer\b/i,
    skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD', 'Linux', 'Terraform', 'Monitoring', 'Git'],
  },
  {
    test: /\bmobile|android|ios|flutter\b/i,
    skills: ['Flutter', 'React Native', 'Kotlin', 'Swift', 'REST APIs', 'Git', 'UI/UX', 'Firebase'],
  },
  {
    test: /\bqa|quality assurance|test engineer\b/i,
    skills: ['Selenium', 'Test Automation', 'API Testing', 'Agile', 'Git', 'SQL', 'Communication', 'Problem Solving'],
  },
  {
    test: /\bproduct manager|product owner\b/i,
    skills: ['Agile', 'Communication', 'Leadership', 'Analytics', 'Roadmapping', 'Stakeholder Management', 'SQL', 'Problem Solving'],
  },
]

const DEFAULT_ROLE_SKILLS = [
  'Communication',
  'Problem Solving',
  'Git',
  'SQL',
  'REST APIs',
  'Agile',
  'Team Collaboration',
  'System Design',
]

export function resolveExactInterviewRole(profile: SavedProfile | null, roleOverride = ''): string {
  const fromProfile = clean(profile?.currentRole)
  const fromOverride = clean(roleOverride)
  const pick = fromProfile || fromOverride
  if (pick && pick.length > 2 && !/^software professional$/i.test(pick)) return pick

  const resume = clean(profile?.resumeText)
  if (resume) {
    for (const line of resume.split(/\r?\n/).slice(0, 25)) {
      const t = clean(line)
      for (const entry of ROLE_SKILL_LIBRARY) {
        if (entry.test.test(t) && t.length < 80) return t
      }
      if (/\b(engineer|developer|designer|analyst|manager|architect)\b/i.test(t) && t.length < 64) {
        return t
      }
    }
  }

  const firstJob = (profile?.workExperiences || []).find((w) => clean(w?.jobTitle))
  if (firstJob) return clean(firstJob.jobTitle)

  return fromOverride || fromProfile || 'Software Engineer'
}

export function recommendTopSkillsForRole(exactRole: string, ctx: PlanContext): string[] {
  const role = clean(exactRole)
  const profileSkills = unique((ctx.skills || []).map((s) => clean(s))).filter((s) => s.length > 1)
  const snippet = clean(ctx.resumeSnippet).toLowerCase()

  let roleDefaults = [...DEFAULT_ROLE_SKILLS]
  for (const entry of ROLE_SKILL_LIBRARY) {
    if (entry.test.test(role)) {
      roleDefaults = [...entry.skills]
      break
    }
  }

  const ranked: string[] = []
  for (const skill of profileSkills) {
    const key = skill.toLowerCase()
    const inRoleSet = roleDefaults.some((d) => d.toLowerCase() === key || key.includes(d.toLowerCase()))
    const inResume = snippet.includes(key)
    if (inRoleSet || inResume) ranked.push(skill)
  }
  for (const skill of profileSkills) {
    if (!ranked.some((r) => r.toLowerCase() === skill.toLowerCase())) ranked.push(skill)
  }
  for (const skill of roleDefaults) {
    if (!ranked.some((r) => r.toLowerCase() === skill.toLowerCase())) ranked.push(skill)
  }

  return ranked.slice(0, 8)
}

function spokenLead(first: string, clause: string): string {
  const body = clean(clause)
  if (!body) return ''
  if (!first || first === 'there') return body.charAt(0).toUpperCase() + body.slice(1)
  return `${first}, ${body}`
}

function questionMentions(history: { question?: Question }[], label: string): boolean {
  const key = clean(label).toLowerCase()
  if (key.length < 2) return false
  return history.some((h) => {
    const text = clean(h.question?.text).toLowerCase()
    const topic = clean(h.question?.topic).toLowerCase()
    return topic === key || text.includes(key)
  })
}

type StructuredRaw = Question & { focus?: string }

function buildSkillQuestion(first: string, skill: string, exactRole: string, turnNumber: number): StructuredRaw {
  const fullStackLike = /full[\s-]?stack|mern|mean/i.test(skill)
  const text =
    turnNumber === 1
      ? fullStackLike
        ? spokenLead(
            first,
            `for this ${exactRole} role, ${skill} is a core skill. Pick one real feature you shipped with ${skill} — architecture, your ownership, testing, and the measurable outcome.`,
          )
        : spokenLead(
            first,
            `as a ${exactRole}, we expect strong ${skill}. Describe a concrete situation where you used ${skill} — the problem, what you built or changed, and how you measured success.`,
          )
      : fullStackLike
        ? spokenLead(
            first,
            `next for ${exactRole}: walk me through another ${skill} delivery — scope, technical choices, and a metric that proved it worked.`,
          )
        : spokenLead(
            first,
            `second skill check for ${exactRole}: tell me about a different challenge where ${skill} was central — what broke, what you changed, and the outcome.`,
          )
  return {
    text,
    category: 'Technical',
    keywords: unique([skill.toLowerCase(), exactRole.toLowerCase(), 'outcome', 'example']),
    hint: `Ground your answer in a real ${skill} example from your résumé.`,
    topic: skill,
    resumeAnchor: skill,
    focus: `structured-skill-${turnNumber}`,
  }
}

function buildWorkExperienceQuestion(
  first: string,
  jobLine: string,
  exactRole: string,
  turnNumber: number,
  senior: boolean,
): StructuredRaw {
  const jobHead = clean(jobLine).split(':')[0]?.trim() || clean(jobLine)
  const text = senior
    ? spokenLead(
        first,
        `your résumé shows ${jobHead}. As a ${exactRole}, what did you own there — key decisions, trade-offs, and business or technical impact?`,
      )
    : spokenLead(
        first,
        `walk me through ${jobHead} from your work history. What were your day-to-day responsibilities as a ${exactRole}, and one result you're proud of?`,
      )
  return {
    text,
    category: 'Experience',
    keywords: unique([jobHead.toLowerCase().slice(0, 40), exactRole.toLowerCase(), 'impact', 'ownership']),
    hint: 'Use only employers and projects listed on your résumé.',
    topic: jobHead,
    resumeAnchor: jobHead,
    focus: `structured-work-${turnNumber}`,
  }
}

function pickProjectLabel(ctx: PlanContext, profile: SavedProfile | null) {
  const ach = (ctx.achievements || []).map(clean).filter(Boolean)[0]
  if (ach) return { kind: 'project' as const, label: ach.slice(0, 120) }
  const snippet = clean(ctx.resumeSnippet)
  const projectLine = snippet
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /\bproject\b/i.test(l) && l.length > 20)
  if (projectLine) return { kind: 'project' as const, label: projectLine.slice(0, 120) }
  const exp = (profile?.workExperiences || []).find((w) => clean(w.responsibilities))
  if (exp) {
    return {
      kind: 'project' as const,
      label: `${clean(exp.jobTitle) || 'Role'} project: ${clean(exp.responsibilities).slice(0, 80)}`,
    }
  }
  return null
}

function buildCertOrProjectQuestion(
  first: string,
  exactRole: string,
  ctx: PlanContext,
  profile: SavedProfile | null,
): StructuredRaw {
  const cert = (ctx.certs || []).map(clean).filter(Boolean)[0] || clean(profile?.certifications?.[0]?.name)
  if (cert) {
    return {
      text: spokenLead(
        first,
        `I see ${cert} on your profile. How does that certification support your work as a ${exactRole}, and where have you applied what you learned?`,
      ),
      category: 'Technical',
      keywords: unique([cert.toLowerCase().slice(0, 32), exactRole.toLowerCase(), 'certification']),
      hint: 'Tie the credential to a real task or project.',
      topic: cert,
      resumeAnchor: cert,
      focus: 'structured-cert',
    }
  }
  const project = pickProjectLabel(ctx, profile)
  if (project) {
    return {
      text: spokenLead(
        first,
        `your background mentions ${project.label}. As a ${exactRole}, what was your role in that project, which tools did you use, and what was the outcome?`,
      ),
      category: 'Problem Solving',
      keywords: unique(['project', exactRole.toLowerCase(), 'outcome', 'tools']),
      hint: 'Use details that appear on your résumé only.',
      topic: 'Project',
      resumeAnchor: project.label.slice(0, 80),
      focus: 'structured-project',
    }
  }
  return {
    text: spokenLead(
      first,
      `describe a project or certification relevant to ${exactRole} — what you built or learned, and how it shows you're ready for this role.`,
    ),
    category: 'Experience',
    keywords: unique(['project', exactRole.toLowerCase(), 'certification']),
    hint: 'Pick something from your résumé or profile.',
    topic: 'Project or certification',
    focus: 'structured-project-fallback',
  }
}

function buildClosingFallbackQuestion(first: string, exactRole: string, level: string): StructuredRaw {
  return {
    text: spokenLead(
      first,
      `last question: why is this ${exactRole} opportunity the right next step for you at ${level}, and what's one strength from your experience we should remember?`,
    ),
    category: 'Communication',
    keywords: unique(['motivation', exactRole.toLowerCase(), 'strength', 'closing']),
    hint: 'Be specific to this role — not a generic answer.',
    topic: 'Closing',
    focus: 'structured-closing',
  }
}

export function buildStructuredTurnQuestion(options: {
  turnNumber: number
  first: string
  level: string
  profile: SavedProfile | null
  ctx: PlanContext
  roleOverride?: string
  history: { question: Question; answer: string }[]
  senior?: boolean
}): StructuredRaw | null {
  const { turnNumber, first, level, profile, ctx, history } = options
  if (turnNumber < 1 || turnNumber > INTERVIEW_TURN_COUNT) return null

  const exactRole = resolveExactInterviewRole(profile, options.roleOverride || ctx.role || '')
  const topSkills = recommendTopSkillsForRole(exactRole, ctx)
  const jobs = (ctx.jobs || []).filter(Boolean)
  const senior = Boolean(options.senior)

  if (turnNumber === 1) {
    const skill = topSkills[0]
    if (!skill) return null
    return buildSkillQuestion(first, skill, exactRole, 1)
  }
  if (turnNumber === 2) {
    const skill =
      topSkills.find((s, i) => i > 0 && !questionMentions(history, s)) || topSkills[1] || topSkills[0]
    if (!skill) return null
    return buildSkillQuestion(first, skill, exactRole, 2)
  }
  if (turnNumber === 3) {
    const job = jobs[0]
    if (!job) return null
    return buildWorkExperienceQuestion(first, job, exactRole, 3, senior)
  }
  if (turnNumber === 4) {
    const job =
      jobs.find((j, i) => i > 0 && !questionMentions(history, j.split(':')[0] || j)) || jobs[1] || jobs[0]
    if (!job) return null
    if (jobs[0] && job === jobs[0] && questionMentions(history, job.split(':')[0] || job)) {
      return {
        text: spokenLead(
          first,
          `staying with ${job.split(':')[0]?.trim() || job}: tell me about a hard problem you solved there as a ${exactRole} — approach, collaboration, and result.`,
        ),
        category: 'Problem Solving',
        keywords: unique(['problem', exactRole.toLowerCase(), 'collaboration', 'result']),
        hint: 'One specific challenge from that role.',
        topic: `${job.split(':')[0]?.trim() || job} — deep dive`,
        resumeAnchor: job.split(':')[0]?.trim(),
        focus: 'structured-work-4',
      }
    }
    return buildWorkExperienceQuestion(first, job, exactRole, 4, senior)
  }
  if (turnNumber === 5) {
    return buildCertOrProjectQuestion(first, exactRole, ctx, profile)
  }
  if (turnNumber === 6) {
    return buildClosingFallbackQuestion(first, exactRole, level || 'your experience level')
  }
  return null
}

export function structuredPlanSummary(exactRole: string, ctx: PlanContext) {
  const skills = recommendTopSkillsForRole(exactRole, ctx).slice(0, 2)
  return {
    exactRole,
    recommendedSkills: skills,
    turnPlan: [
      `Q1 skill: ${skills[0] || 'TBD'}`,
      `Q2 skill: ${skills[1] || skills[0] || 'TBD'}`,
      'Q3–Q4: work experience from résumé',
      'Q5: certification or project',
      'Q6: closing fallback',
    ],
  }
}
