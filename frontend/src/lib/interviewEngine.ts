import type { AnswerAnalysis, InterviewResult } from './store'

export type Question = {
  text: string
  category: 'Communication' | 'Technical' | 'Problem Solving' | 'Experience'
  keywords: string[]
  hint: string
  resumeAnchor?: string
  topic?: string
  focus?: string
}

export const ROLES = [
  'Frontend Developer',
  'Full Stack Engineer',
  'Backend Developer',
  'Data Analyst',
  'AI / ML Engineer',
  'Product Manager',
  'Civil Engineer',
  'Mechanical Engineer',
  'Chemical Engineer',
  'Electrical Engineer',
  'Oil & Gas / Energy',
  'Healthcare / Clinical',
  'Registered Nurse (RN)',
  'Medical Laboratory Tech',
  'Construction / Site Manager',
  'General Professional',
] as const

export const LEVELS = ['Fresher', '1–3 years', '3–6 years', '6+ years'] as const

const COMMON_QUESTIONS: Question[] = [
  {
    text: 'Tell me about yourself and what drew you to this field.',
    category: 'Communication',
    keywords: ['experience', 'project', 'learn', 'passion', 'skill', 'built', 'team', 'year'],
    hint: 'Structure: background → key skills → why this role.',
  },
  {
    text: 'Describe a challenging problem you faced and how you solved it.',
    category: 'Problem Solving',
    keywords: ['problem', 'solution', 'approach', 'result', 'debug', 'fixed', 'improved', 'because', 'impact'],
    hint: 'Use the STAR method: Situation, Task, Action, Result.',
  },
  {
    text: 'Tell me about a time you worked in a team under a tight deadline.',
    category: 'Experience',
    keywords: ['team', 'deadline', 'priority', 'communicate', 'deliver', 'plan', 'collaborate', 'together'],
    hint: 'Mention your specific role and the outcome.',
  },
  {
    text: 'Where do you see yourself growing in the next two years?',
    category: 'Communication',
    keywords: ['grow', 'learn', 'goal', 'skill', 'lead', 'improve', 'contribute', 'plan'],
    hint: 'Tie your goals to real skills you want to build.',
  },
]

const ROLE_QUESTIONS: Record<string, Question> = {
  'Frontend Developer': {
    text: 'How do you make a web page fast and responsive across devices?',
    category: 'Technical',
    keywords: ['performance', 'responsive', 'lazy', 'bundle', 'cache', 'media', 'css', 'render', 'optimize', 'image'],
    hint: 'Think loading performance, rendering, and responsive layout.',
  },
  'Full Stack Engineer': {
    text: 'Walk me through how you would design an API and its database for a job-matching app.',
    category: 'Technical',
    keywords: ['api', 'database', 'schema', 'endpoint', 'auth', 'index', 'query', 'rest', 'model', 'scale'],
    hint: 'Cover endpoints, data models, and how they connect.',
  },
  'Backend Developer': {
    text: 'How would you scale a service that suddenly gets 10x more traffic?',
    category: 'Technical',
    keywords: ['scale', 'cache', 'load', 'balancer', 'queue', 'database', 'horizontal', 'monitor', 'bottleneck'],
    hint: 'Mention caching, load balancing, and finding bottlenecks.',
  },
  'Data Analyst': {
    text: 'How do you approach cleaning and analyzing a messy dataset?',
    category: 'Technical',
    keywords: ['clean', 'missing', 'outlier', 'sql', 'python', 'visualize', 'trend', 'insight', 'duplicate'],
    hint: 'Describe your process step by step, from raw data to insight.',
  },
  'AI / ML Engineer': {
    text: 'Explain how you would build and evaluate a model that predicts candidate–job fit.',
    category: 'Technical',
    keywords: ['model', 'feature', 'train', 'evaluate', 'accuracy', 'data', 'overfit', 'metric', 'label', 'test'],
    hint: 'Cover features, training, and evaluation metrics.',
  },
  'Product Manager': {
    text: 'How would you decide what feature to build next for a hiring platform?',
    category: 'Problem Solving',
    keywords: ['user', 'data', 'priority', 'impact', 'metric', 'research', 'feedback', 'roadmap', 'value'],
    hint: 'Show how you balance user needs, data, and business impact.',
  },
  'Civil Engineer': {
    text: 'Walk me through a project where you balanced safety codes, budget, and schedule on site.',
    category: 'Technical',
    keywords: ['safety', 'code', 'design', 'site', 'concrete', 'steel', 'schedule', 'budget', 'inspect', 'plan'],
    hint: 'Name the structure, your responsibility, and how you managed risk.',
  },
  'Mechanical Engineer': {
    text: 'Describe a time you diagnosed a failure in a mechanical system and validated your fix.',
    category: 'Technical',
    keywords: ['failure', 'design', 'test', 'tolerance', 'maintenance', 'root cause', 'cad', 'thermal', 'stress'],
    hint: 'Cover symptoms, analysis method, and measured outcome.',
  },
  'Chemical Engineer': {
    text: 'How do you approach process safety and quality when scaling a chemical process?',
    category: 'Technical',
    keywords: ['process', 'safety', 'hazop', 'quality', 'batch', 'reactor', 'yield', 'spec', 'control'],
    hint: 'Mention hazards, controls, and data you tracked.',
  },
  'Electrical Engineer': {
    text: 'Explain a power or controls project you delivered — design choices and commissioning.',
    category: 'Technical',
    keywords: ['power', 'circuit', 'plc', 'commission', 'load', 'protection', 'test', 'standard', 'panel'],
    hint: 'Include standards, testing, and handover.',
  },
  'Oil & Gas / Energy': {
    text: 'Describe a high-risk operational decision you made and how you managed HSE and downtime.',
    category: 'Experience',
    keywords: ['hse', 'shutdown', 'pipeline', 'risk', 'permit', 'maintenance', 'gas', 'incident', 'procedure'],
    hint: 'Be clear on risk assessment and communication.',
  },
  'Healthcare / Clinical': {
    text: 'Tell me about a patient-care or clinical workflow improvement you led or supported.',
    category: 'Experience',
    keywords: ['patient', 'clinical', 'protocol', 'team', 'outcome', 'safety', 'chart', 'handoff', 'quality'],
    hint: 'Focus on safety, teamwork, and measurable impact.',
  },
  'Registered Nurse (RN)': {
    text: 'How do you prioritize care when multiple patients need attention at once?',
    category: 'Problem Solving',
    keywords: ['triage', 'patient', 'assessment', 'communicate', 'doctor', 'medication', 'safety', 'delegate'],
    hint: 'Use a real shift example with outcomes.',
  },
  'Medical Laboratory Tech': {
    text: 'How do you ensure accuracy and turnaround when processing critical lab samples?',
    category: 'Technical',
    keywords: ['sample', 'qc', 'calibration', 'sop', 'result', 'contamination', 'instrument', 'verify'],
    hint: 'Mention QC, SOPs, and escalation.',
  },
  'Construction / Site Manager': {
    text: 'Describe how you kept a site safe and on schedule when plans changed mid-project.',
    category: 'Experience',
    keywords: ['site', 'contractor', 'schedule', 'safety', 'rfi', 'delay', 'crew', 'inspect', 'cost'],
    hint: 'Cover trade-offs and stakeholder updates.',
  },
  'General Professional': {
    text: 'Describe a complex problem in your field and how you delivered a measurable result.',
    category: 'Problem Solving',
    keywords: ['problem', 'team', 'result', 'plan', 'stakeholder', 'deliver', 'measure', 'improve'],
    hint: 'Use STAR: situation, action, outcome with numbers if possible.',
  },
}

export type ScoreContext = {
  skills?: string[]
  profileRole?: string
  experienceLabel?: string
}

/** Map wizard experience labels onto interview levels. */
export function mapExperienceToLevel(experience: string): (typeof LEVELS)[number] {
  const e = experience.toLowerCase()
  if (!e || e.includes('fresher') || e.includes('0 years') || e.includes('0 – 1')) {
    return 'Fresher'
  }
  if (e.includes('1 – 2') || e.includes('2 – 3') || e.includes('1-2') || e.includes('2-3')) {
    return '1–3 years'
  }
  if (e.includes('3 – 5') || e.includes('5 – 8') || e.includes('3-5') || e.includes('5-8')) {
    return '3–6 years'
  }
  return '6+ years'
}

/** Best-effort match of free-text profile role to interview role chips. */
export function mapProfileRoleToInterviewRole(profileRole: string): string {
  const r = profileRole.toLowerCase()
  if (!r) return ROLES[0]
  if (r.includes('front') || r.includes('ui') || r.includes('react')) return 'Frontend Developer'
  if (r.includes('full') || r.includes('mern') || r.includes('stack')) return 'Full Stack Engineer'
  if (r.includes('back') || r.includes('node') || r.includes('java') || r.includes('api')) {
    return 'Backend Developer'
  }
  if (r.includes('llm') || r.includes('generative ai')) return 'AI / ML Engineer'
  if (r.includes('data engineer')) return 'Data Analyst'
  if (r.includes('data') || r.includes('analyst') || r.includes('bi')) return 'Data Analyst'
  if (
    r.includes('ml') ||
    r.includes('machine') ||
    r.includes('ai ') ||
    r.startsWith('ai') ||
    r.includes('nlp') ||
    r.includes('computer vision')
  ) {
    return 'AI / ML Engineer'
  }
  if (r.includes('product') || r.includes('pm')) return 'Product Manager'
  if (r.includes('civil') || r.includes('structural')) return 'Civil Engineer'
  if (r.includes('mechanical') || r.includes('hvac')) return 'Mechanical Engineer'
  if (r.includes('chemical') || r.includes('process eng')) return 'Chemical Engineer'
  if (r.includes('electrical') || r.includes('instrumentation')) return 'Electrical Engineer'
  if (r.includes('oil') || r.includes('gas') || r.includes('petro') || r.includes('energy')) {
    return 'Oil & Gas / Energy'
  }
  if (r.includes('nurse') || r.includes('rn ') || r.startsWith('rn')) return 'Registered Nurse (RN)'
  if (r.includes('lab tech') || r.includes('laboratory')) return 'Medical Laboratory Tech'
  if (r.includes('doctor') || r.includes('physician') || r.includes('clinical') || r.includes('health')) {
    return 'Healthcare / Clinical'
  }
  if (r.includes('construction') || r.includes('site manager')) return 'Construction / Site Manager'
  const exact = ROLES.find((role) => role.toLowerCase() === r)
  return exact ?? 'General Professional'
}

function skillQuestion(skills: string[]): Question | null {
  const top = skills.filter(Boolean).slice(0, 5)
  if (top.length === 0) return null
  const listed = top.join(', ')
  return {
    text: `You listed ${listed} on your profile. Pick one and walk me through a real project where you used it — what you built, your role, and the outcome.`,
    category: 'Technical',
    keywords: [
      ...top.map((s) => s.toLowerCase()),
      'project',
      'built',
      'used',
      'result',
      'impact',
      'team',
      'challenge',
    ],
    hint: 'Name the skill, the project, your concrete actions, and a measurable result.',
  }
}

export function buildQuestionSet(role: string, skills: string[] = []): Question[] {
  const roleQ =
    ROLE_QUESTIONS[role] ?? ROLE_QUESTIONS['General Professional'] ?? ROLE_QUESTIONS['Full Stack Engineer']
  const skillQ = skillQuestion(skills)
  // Prefer skill-deep dive when profile has skills; keep 5 questions total.
  if (skillQ) {
    return [COMMON_QUESTIONS[0], skillQ, roleQ, COMMON_QUESTIONS[1], COMMON_QUESTIONS[2]]
  }
  return [COMMON_QUESTIONS[0], roleQ, COMMON_QUESTIONS[1], COMMON_QUESTIONS[2], COMMON_QUESTIONS[3]]
}

const STRUCTURE_SIGNALS = [
  'for example', 'first', 'then', 'finally', 'as a result', 'because',
  'situation', 'task', 'action', 'result', 'so i', 'which led', 'in the end',
]

function analyzeAnswer(
  question: Question,
  answer: string,
  profileSkills: string[] = [],
): AnswerAnalysis {
  const text = answer.trim()
  const lower = text.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  // Length: 0–30 pts. Ideal is 60–200 words.
  let lengthScore = 0
  if (wordCount >= 10) lengthScore = 8
  if (wordCount >= 30) lengthScore = 18
  if (wordCount >= 60) lengthScore = 30
  if (wordCount > 260) lengthScore = 24

  // Keyword coverage: 0–35 pts.
  const keywordsHit = question.keywords.filter((k) => lower.includes(k.toLowerCase()))
  const keywordScore = Math.min(
    35,
    Math.round((keywordsHit.length / Math.min(question.keywords.length, 5)) * 35),
  )

  // Structure signals: 0–15 pts.
  const structureHits = STRUCTURE_SIGNALS.filter((s) => lower.includes(s)).length
  const structureScore = Math.min(15, structureHits * 5)

  // Specificity (numbers, named tools): 0–10 pts.
  const hasNumbers = /\d/.test(text)
  const specificityScore =
    (hasNumbers ? 5 : 0) +
    (wordCount > 0 &&
    /[A-Z][a-z]+[A-Z]|\b(react|node|python|sql|aws|figma|excel|typescript|docker)\b/i.test(text)
      ? 5
      : 0)

  // Profile skill alignment: 0–10 pts — reward mentioning skills you claimed.
  const skillsHit = profileSkills.filter((s) => {
    const token = s.trim().toLowerCase()
    return token.length >= 2 && lower.includes(token)
  })
  const skillAlignScore = Math.min(10, skillsHit.length * 3)

  const score = Math.min(
    100,
    lengthScore + keywordScore + structureScore + specificityScore + skillAlignScore,
  )

  let feedback: string
  if (wordCount < 10) {
    feedback = 'Too brief — interviewers need detail to assess your thinking. Aim for 60–150 words.'
  } else if (keywordsHit.length === 0 && skillsHit.length === 0) {
    feedback = `Stayed too general. Bring in specifics like ${question.keywords.slice(0, 3).join(', ')}${
      profileSkills[0] ? ` or your skill ${profileSkills[0]}` : ''
    }.`
  } else if (structureHits === 0) {
    feedback = 'Good content, but structure it: situation → action → result makes answers land better.'
  } else if (score >= 75) {
    feedback =
      skillsHit.length > 0
        ? `Strong answer — you connected it to your profile skills (${skillsHit.slice(0, 2).join(', ')}).`
        : 'Strong answer — specific, structured, and relevant to the question.'
  } else {
    feedback = 'Solid base. Add a concrete example with a measurable result to push this higher.'
  }

  return {
    question: question.text,
    answer: text,
    score,
    wordCount,
    keywordsHit: [...new Set([...keywordsHit, ...skillsHit])],
    feedback,
  }
}

export function scoreInterview(
  role: string,
  level: string,
  questions: Question[],
  answers: string[],
  context: ScoreContext = {},
): InterviewResult {
  const skills = context.skills ?? []
  const analyses = questions.map((q, i) => analyzeAnswer(q, answers[i] ?? '', skills))

  const byCategory = new Map<string, number[]>()
  questions.forEach((q, i) => {
    const list = byCategory.get(q.category) ?? []
    list.push(analyses[i].score)
    byCategory.set(q.category, list)
  })

  const categories = ['Communication', 'Technical', 'Problem Solving', 'Experience'].map((label) => {
    const scores = byCategory.get(label)
    const score =
      scores && scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0
    return { label, score }
  })

  let overall = Math.round(analyses.reduce((a, b) => a + b.score, 0) / analyses.length)

  // Small boost when answers reference claimed skills across the whole interview.
  const joined = answers.join(' ').toLowerCase()
  const skillsReferenced = skills.filter((s) => joined.includes(s.toLowerCase())).length
  if (skills.length >= 3 && skillsReferenced >= 2) {
    overall = Math.min(100, overall + 4)
  } else if (skills.length >= 3 && skillsReferenced === 0) {
    overall = Math.max(0, overall - 3)
  }

  const strengths: string[] = []
  const improvements: string[] = []

  const avgWords = analyses.reduce((a, b) => a + b.wordCount, 0) / analyses.length
  if (avgWords >= 50) strengths.push('You give detailed, substantial answers.')
  else improvements.push('Expand your answers — aim for 60–150 words each.')

  const totalKeywords = analyses.reduce((a, b) => a + b.keywordsHit.length, 0)
  if (totalKeywords >= 8) strengths.push('You use relevant, role-specific vocabulary.')
  else improvements.push('Use more role-specific terms and name real tools you have used.')

  if (skillsReferenced >= 2) {
    strengths.push(
      `You backed up profile skills in answers (${skills
        .filter((s) => joined.includes(s.toLowerCase()))
        .slice(0, 3)
        .join(', ')}).`,
    )
  } else if (skills.length > 0) {
    improvements.push(
      `Mention skills from your profile (${skills.slice(0, 3).join(', ')}) with real examples.`,
    )
  }

  const best = [...categories].sort((a, b) => b.score - a.score)[0]
  const worst = [...categories].sort((a, b) => a.score - b.score)[0]
  if (best.score >= 60) strengths.push(`${best.label} is your standout area (${best.score}/100).`)
  if (worst.score < 60) improvements.push(`${worst.label} needs the most practice (${worst.score}/100).`)

  if (strengths.length === 0) strengths.push('You completed the full interview — consistency matters.')
  if (improvements.length === 0) improvements.push('Keep practicing with tougher, role-specific questions.')

  return {
    role,
    level,
    date: new Date().toISOString(),
    overall,
    categories,
    strengths,
    improvements,
    answers: analyses,
  }
}
