import type { Question, QuestionGenerationMeta } from './interviewEngine'
import type { SavedProfile } from './store'
import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import {
  claimedSkillQuestion,
  isRoleTrackExplicit,
  pickResumeInterviewTopic,
  questionAnchorMode,
  roleTrackQuestion,
} from './interviewFocus'
import { candidateFullName, firstName } from './store'

export const MIN_ANSWERS_BEFORE_END = 2
export const MAX_ADAPTIVE_QUESTIONS = 15

const END_INTERVIEW_RE =
  /\b(end (the )?interview|stop (the )?interview|finish (the )?interview|i'?m done|that'?s all|no more questions)\b/i

export function isEndInterviewCommand(text: string): boolean {
  return END_INTERVIEW_RE.test(text.trim())
}

const TECH =
  /\b(java|python|javascript|typescript|react|node\.?js|angular|vue|spring|kotlin|go|rust|sql|mongodb|aws|docker|kubernetes|graphql|microservices|c\+\+|c#)\b/gi

const STACK_TRACK =
  /\b(full[\s-]?stack(?:\s+development|\s+engineering)?|front[\s-]?end(?:\s+development)?|back[\s-]?end(?:\s+development)?|mern|mean|devops|ui\/ux|mobile\s+development)\b/gi

const SUBJECT =
  /\b(math|mathematics|statistics|calculus|algebra|geometry|physics|chemistry|biology|nursing|finance|accounting|marketing|sales|leadership|communication|writing|design|cad|mechanical|electrical|civil|structural|pipelines?|safety|hse|oil\s*&?\s*gas|healthcare|patient\s*care)\b/gi

function titleCaseSkill(s: string): string {
  const t = s.trim()
  if (!t) return t
  if (t.length <= 3) return t.toUpperCase()
  return t
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export function extractClaimedSkills(text: string): string[] {
  const found: string[] = []
  const lower = text.toLowerCase()

  let m: RegExpExecArray | null
  const stackRe = new RegExp(STACK_TRACK.source, 'gi')
  while ((m = stackRe.exec(text))) found.push(m[1])

  const goodAt = lower.match(
    /(?:good at|great at|strong in|strong at|experienced in|expert in|skilled in|proficient in|specializ(?:e|ing) in)\s+([a-z0-9+#./\s-]{2,56})/i,
  )
  if (goodAt?.[1]) {
    goodAt[1]
      .split(/,|\band\b/)
      .map((s) => s.trim().replace(/\.$/, ''))
      .filter(Boolean)
      .forEach((s) => found.push(s))
  }
  const techRe = new RegExp(TECH.source, 'gi')
  while ((m = techRe.exec(text))) found.push(m[1])
  const subjRe = new RegExp(SUBJECT.source, 'gi')
  while ((m = subjRe.exec(text))) found.push(m[1])
  return [...new Set(found.map(titleCaseSkill))]
}

/** Client fallback when API offline — still follows claimed skills (e.g. Java). */
export function generateLocalAdaptiveQuestion(
  role: string,
  level: string,
  profile: SavedProfile | null,
  history: { question: Question; answer: string }[],
  lastAnswer: string,
  options?: { explicitRoleTrack?: boolean; jobDescription?: string },
): Question {
  const name = firstName()
  const claimed = extractClaimedSkills(lastAnswer)
  const skill = claimed[0]
  const roleExplicit = isRoleTrackExplicit(
    Boolean(options?.explicitRoleTrack),
    false,
    options?.jobDescription || '',
  )
  const anchor = questionAnchorMode(roleExplicit)

  if (history.length === 0) {
    if (anchor === 'role_track') {
      return {
        text: profile?.resumeText
          ? `${name}, I'm interviewing you for the ${role} track (${level}). I've read your resume — in 90 seconds, connect your background to this role and what you're strongest in.`
          : `${name}, welcome to the ${role} interview (${level}). Introduce yourself and the skills that fit this role best.`,
        category: 'Communication',
        keywords: ['experience', 'skill', 'project', role.toLowerCase()],
        hint: 'Mention skills that match the role you selected.',
        topic: 'Introduction',
      }
    }
    return {
      text: profile?.resumeText
        ? `${name}, I've reviewed your resume in detail. In 90 seconds, walk me through your background — roles, projects, and tools that stand out on your CV.`
        : `${name}, welcome. Introduce yourself from your experience and share what you're best at.`,
      category: 'Communication',
      keywords: ['experience', 'skill', 'project', 'resume'],
      hint: 'Reference real employers, projects, or tools from your resume.',
      topic: 'Introduction',
    }
  }

  if (skill) {
    return claimedSkillQuestion(name, skill, roleExplicit ? role : '')
  }

  if (anchor === 'role_track') {
    const rq = roleTrackQuestion(role, level, name, history.length)
    if (rq) return rq
  }

  const resumeTopic = pickResumeInterviewTopic(profile, history)
  if (resumeTopic) {
    return {
      text: `${name}, on your resume I see ${resumeTopic.label}. Walk me through that work — your responsibility, a hard decision, and the outcome.`,
      category: 'Experience',
      keywords: [resumeTopic.topic.toLowerCase(), 'project', 'team', 'result'],
      hint: 'Use details that match your CV, not a generic story.',
      topic: resumeTopic.topic,
      resumeAnchor: resumeTopic.label,
    }
  }

  const skills = profile?.skills?.length ? profile.skills : [role]
  const pick = skills[history.length % skills.length]
  return {
    text: `${name}, let's go deeper on ${pick} from your background. Walk me through a real challenge and how you verified the fix or result.`,
    category: history.length % 2 === 0 ? 'Problem Solving' : 'Technical',
    keywords: [pick.toLowerCase(), 'debug', 'solution', 'result'],
    hint: 'Use STAR: situation, action, measurable result.',
    topic: pick,
  }
}

export async function fetchNextAdaptiveQuestion(options: {
  sessionId: string | null
  role: string
  level: string
  profile: SavedProfile | null
  jobDescription?: string
  explicitRoleTrack?: boolean
  history: { question: Question; answer: string }[]
  lastQuestion: Question
  lastAnswer: string
}): Promise<{ question: Question; meta: QuestionGenerationMeta }> {
  await ensureApiSession()
  try {
    const res = await apiFetch('/api/interview/next', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: options.sessionId,
        role: options.role,
        level: options.level,
        profile: options.profile,
        jobDescription: options.jobDescription,
        explicitRoleTrack: options.explicitRoleTrack,
        history: options.history.slice(0, -1),
        lastQuestion: options.lastQuestion,
        lastAnswer: options.lastAnswer,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.question?.text) {
        const source: 'llm' | 'template' =
          data.questionSource === 'llm' ||
          data.question?.generationSource === 'llm' ||
          data.question?.focus === 'adaptive-llm'
            ? 'llm'
            : 'template'
        return {
          question: data.question as Question,
          meta: {
            questionSource: source,
            llmLatencyMs: data.llmLatencyMs ?? data.question?.llmLatencyMs ?? null,
            llmFailureReason: data.llmFailureReason ?? data.question?.llmFailureReason ?? null,
            llmModel: data.llmModel ?? data.question?.llmModel ?? null,
          },
        }
      }
    } else if (res.status === 404) {
      console.warn('[Interview] Session not found on server — using local backup question.')
    } else {
      console.warn('[Interview] /api/interview/next failed:', res.status)
    }
  } catch (err) {
    console.warn('[Interview] /api/interview/next error:', err)
  }

  const question = generateLocalAdaptiveQuestion(
    options.role,
    options.level,
    options.profile,
    options.history,
    options.lastAnswer,
    {
      explicitRoleTrack: options.explicitRoleTrack,
      jobDescription: options.jobDescription,
    },
  )
  return {
    question,
    meta: {
      questionSource: 'template',
      llmFailureReason: 'api_offline_or_session',
    },
  }
}

export function enrichProfileName(profile: SavedProfile | null): SavedProfile | null {
  if (!profile) return null
  const display = candidateFullName()
  if (!display || display === 'Candidate') return profile
  return { ...profile, fullName: display, name: display }
}
