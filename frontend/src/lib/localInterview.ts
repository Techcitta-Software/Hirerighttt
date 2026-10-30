/**
 * Fully local resume interview agent — no network / API / LLM.
 * Reads profile + resume text and builds questions + scores answers in-browser.
 */

import { scoreInterview, type Question } from './interviewEngine'
import { classifyQuestionScoringProfile, scoreAnswerRubrics } from './interviewRubrics'
import type { InterviewResult, SavedProfile } from './store'
import { firstName, getUser } from './store'
import type { IntegritySnapshot } from './interviewAgentClient'

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'been', 'were',
  'been', 'your', 'into', 'over', 'under', 'about', 'using', 'used', 'work',
  'working', 'experience', 'skilled', 'skills', 'responsible', 'team', 'project',
  'projects', 'company', 'role', 'years', 'year', 'month', 'months',
])

function unique(items: string[]) {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))]
}

/** Pull likely tech / tool tokens from resume body. */
function extractTokensFromResume(resumeText: string, knownSkills: string[]): string[] {
  const text = resumeText || ''
  const lower = text.toLowerCase()
  const fromKnown = knownSkills.filter((s) => lower.includes(s.toLowerCase()))

  const techHits =
    text.match(
      /\b(?:React(?:\.js)?|Next\.js|Node(?:\.js)?|TypeScript|JavaScript|Python|Java|Kotlin|Swift|Go|Golang|Rust|C\+\+|C#|\.NET|SQL|PostgreSQL|MySQL|MongoDB|Redis|AWS|Azure|GCP|Docker|Kubernetes|Kafka|GraphQL|REST|Django|Flask|Spring|Angular|Vue(?:\.js)?|Tailwind|Figma|Excel|Power BI|TensorFlow|PyTorch|Spark|Hadoop|Linux|Git|CI\/CD|Selenium|Jest|Cypress)\b/gi,
    ) || []

  return unique([...fromKnown, ...techHits]).slice(0, 12)
}

function extractCompanies(profile: SavedProfile | null, resumeText: string): string[] {
  const fromJobs = (profile?.workExperiences || [])
    .map((w) => w.company)
    .filter(Boolean) as string[]
  const fromResume =
    resumeText.match(
      /(?:at|@|,\s*)([A-Z][A-Za-z0-9&.\- ]{2,40}(?:Pvt\.?\s*Ltd\.?|Inc\.?|LLC|Ltd\.?|Technologies|Solutions|Systems|Labs)?)/g,
    ) || []
  const cleaned = fromResume
    .map((m) => m.replace(/^at\s+|^@\s+|,\s*/i, '').trim())
    .filter((c) => c.length > 2 && !STOP.has(c.toLowerCase()))
  return unique([...fromJobs, ...cleaned]).slice(0, 6)
}

function extractProjectLines(resumeText: string): string[] {
  const lines = resumeText
    .split(/\n|[•●▪‣]/)
    .map((l) => l.trim())
    .filter((l) => l.length > 28 && l.length < 220)
  const projectish = lines.filter((l) =>
    /\b(built|developed|designed|implemented|created|led|improved|reduced|increased|migrated|deployed|launched)\b/i.test(
      l,
    ),
  )
  return unique(projectish).slice(0, 5)
}

export function buildResumeInterviewQuestions(
  role: string,
  level: string,
  profile: SavedProfile | null,
  jobDescription?: string,
): Question[] {
  const name = firstName() || getUser()?.name?.split(' ')[0] || 'there'
  const resumeText = profile?.resumeText || ''
  const skills = extractTokensFromResume(resumeText, profile?.skills || [])
  const companies = extractCompanies(profile, resumeText)
  const projects = extractProjectLines(resumeText)
  const achievements = (profile?.achievements || []).filter(Boolean)
  const job = profile?.workExperiences?.find((w) => w.jobTitle || w.company)
  const targetRole = profile?.currentRole || role

  const jdSnippet = (jobDescription || '').trim()
  const jdKeywords = jdSnippet
    ? unique(
        jdSnippet
          .split(/\W+/)
          .filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())),
      ).slice(0, 8)
    : []

  const questions: Question[] = []

  if (jdSnippet) {
    questions.push({
      text: `${name}, considering the Job Description requirement for ${targetRole} (${level}), summarize your background in 90 seconds — how does your experience align with what this role needs?`,
      category: 'Communication',
      keywords: unique([
        'experience',
        'project',
        'skill',
        'role',
        targetRole.toLowerCase(),
        ...jdKeywords.slice(0, 4).map((k) => k.toLowerCase()),
      ]),
      hint: 'Connect your strongest skills directly to the key requirements of this JD.',
    })

    questions.push({
      text: `The Job Description highlights specific technical competencies in ${jdKeywords.slice(0, 3).join(', ') || targetRole}. Describe a real project where you used these skills or similar tools to deliver a production system.`,
      category: 'Technical',
      keywords: unique([
        targetRole.toLowerCase(),
        ...jdKeywords.map((k) => k.toLowerCase()),
        ...skills.map((s) => s.toLowerCase()),
      ]),
      hint: 'Name the tool/skill from the JD, the project context, and your technical solution.',
    })

    if (projects[0]) {
      questions.push({
        text: `Looking at your resume project: “${projects[0].slice(0, 140)}” — how did you solve technical challenges in that project that prepare you for the responsibilities in this JD?`,
        category: 'Problem Solving',
        keywords: unique([
          'challenge',
          'solution',
          'impact',
          'built',
          ...skills.slice(0, 3).map((s) => s.toLowerCase()),
        ]),
        hint: 'Walk through situation → task → action → outcome.',
      })
    } else if (job) {
      questions.push({
        text: `In your role as ${job.jobTitle || 'Engineer'} at ${job.company || 'your previous team'}, what was a major problem you solved that demonstrates the expertise required for this JD?`,
        category: 'Problem Solving',
        keywords: ['problem', 'solution', 'result', 'impact', 'delivered'],
        hint: 'Highlight problem solving and measurable business impact.',
      })
    } else {
      questions.push({
        text: `Describe a complex technical challenge related to ${targetRole} that you solved end-to-end. How does your solution match the standards of this Job Description?`,
        category: 'Problem Solving',
        keywords: ['challenge', 'solution', 'approach', 'built', 'result'],
        hint: 'Use the STAR format: Situation, Task, Action, Result.',
      })
    }

    if (achievements[0]) {
      questions.push({
        text: `You achieved: “${achievements[0].slice(0, 140)}”. How did you personally drive this outcome, and how will you replicate that success in this ${targetRole} position?`,
        category: 'Experience',
        keywords: ['result', 'driven', 'outcome', 'impact', 'delivered'],
        hint: 'Quantify your contribution and connect it to the new role.',
      })
    } else {
      questions.push({
        text: `What is the most technical or high-impact project you have delivered, and how does it demonstrate your readiness for this ${level} ${targetRole} JD?`,
        category: 'Experience',
        keywords: ['impact', 'delivered', 'project', 'result', 'scale'],
        hint: 'Focus on scale, technical depth, and tangible outcomes.',
      })
    }

    questions.push({
      text: `Based on this Job Description and your profile, what key area do you plan to master in your first 90 days as a ${targetRole}?`,
      category: 'Communication',
      keywords: ['grow', 'learn', 'first 90 days', 'impact', 'plan'],
      hint: 'Show initiative, fast onboarding, and clear learning goals.',
    })

    return questions
  }

  questions.push({
    text: resumeText
      ? `${name}, I read your resume for ${targetRole}. Summarize your background in about a minute — what should a hiring manager remember?`
      : `${name}, introduce yourself for the ${targetRole} track (${level}). What stands out from your experience?`,
    category: 'Communication',
    keywords: unique([
      'experience',
      'project',
      'skill',
      'built',
      targetRole.toLowerCase(),
      ...skills.slice(0, 4).map((s) => s.toLowerCase()),
    ]),
    hint: 'Background → top skills → one concrete win from your resume.',
  })

  if (skills[0]) {
    questions.push({
      text: `Your resume highlights ${skills.slice(0, 3).join(', ')}. Walk me through a real project where you used ${skills[0]} — what you built, your role, and the result.`,
      category: 'Technical',
      keywords: unique([
        skills[0].toLowerCase(),
        ...(skills[1] ? [skills[1].toLowerCase()] : []),
        'project',
        'built',
        'result',
        'impact',
      ]),
      hint: 'Name the skill, the project, your actions, and a metric.',
    })
  } else {
    questions.push({
      text: `What is your strongest technical skill for a ${role} role, and how have you applied it in a real project?`,
      category: 'Technical',
      keywords: ['skill', 'project', 'built', 'result', role.toLowerCase()],
      hint: 'Pick one skill and give a production example.',
    })
  }

  if (projects[0]) {
    questions.push({
      text: `On your resume you mention: “${projects[0].slice(0, 150)}”. What was the hardest part, and how did you solve it?`,
      category: 'Problem Solving',
      keywords: unique([
        'problem',
        'solution',
        'approach',
        'result',
        'challenge',
        ...projects[0]
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 4 && !STOP.has(w))
          .slice(0, 5),
      ]),
      hint: 'STAR: situation → task → action → result.',
    })
  } else if (job) {
    questions.push({
      text: `At ${job.company || 'your last role'} as ${job.jobTitle || 'a contributor'}, what was the toughest problem you owned end-to-end?`,
      category: 'Problem Solving',
      keywords: unique([
        'problem',
        'solution',
        'approach',
        'result',
        ...(job.company ? [job.company.toLowerCase()] : []),
      ]),
      hint: 'Be specific about your ownership and the outcome.',
    })
  } else {
    questions.push({
      text: 'Describe a challenging problem from your experience and how you solved it step by step.',
      category: 'Problem Solving',
      keywords: ['problem', 'solution', 'approach', 'result', 'impact'],
      hint: 'Use STAR and include a measurable result.',
    })
  }

  if (achievements[0]) {
    questions.push({
      text: `You listed this achievement: “${achievements[0].slice(0, 140)}”. How did you personally drive that result?`,
      category: 'Experience',
      keywords: ['result', 'impact', 'led', 'improved', 'metric'],
      hint: 'Your contribution vs the team, plus a metric.',
    })
  } else if (companies[0] && skills[1]) {
    questions.push({
      text: `How did you use ${skills[1]} while working${companies[0] ? ` at ${companies[0]}` : ''}? Give one concrete example.`,
      category: 'Experience',
      keywords: unique([
        skills[1].toLowerCase(),
        companies[0].toLowerCase(),
        'example',
        'project',
        'result',
      ]),
      hint: 'Tie the skill to a workplace example.',
    })
  } else if (skills[1]) {
    questions.push({
      text: `Compare your depth in ${skills[0]} versus ${skills[1]}. Give an example that proves the difference.`,
      category: 'Experience',
      keywords: unique([
        skills[0].toLowerCase(),
        skills[1].toLowerCase(),
        'example',
        'depth',
        'project',
      ]),
      hint: 'Contrast two resume skills with proof.',
    })
  } else {
    questions.push({
      text: 'Tell me about a time you delivered under a tight deadline. What did you prioritize and what shipped?',
      category: 'Experience',
      keywords: ['deadline', 'priority', 'deliver', 'shipped', 'plan'],
      hint: 'Priorities, trade-offs, and the outcome.',
    })
  }

  questions.push({
    text: skills[0]
      ? `Based on your resume, how would you apply ${skills[0]} in the first 90 days as a ${role}, and what would you learn next?`
      : `Where do you want to grow as a ${role} over the next two years, based on your experience so far?`,
    category: 'Communication',
    keywords: unique([
      'grow',
      'learn',
      'goal',
      'plan',
      ...(skills[0] ? [skills[0].toLowerCase()] : []),
    ]),
    hint: 'Tie growth to skills already on your resume.',
  })

  // Optional 6th deep-dive if resume has another project line
  if (projects[1] && questions.length < 6) {
    questions.push({
      text: `Another line from your resume: “${projects[1].slice(0, 140)}”. What was your exact contribution?`,
      category: 'Technical',
      keywords: unique([
        'contribution',
        'built',
        'designed',
        'result',
        ...projects[1]
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 4 && !STOP.has(w))
          .slice(0, 4),
      ]),
      hint: 'Be precise about what YOU did.',
    })
  }

  return questions.slice(0, 6)
}

function avg(values: number[]): number {
  if (!values.length) return 0
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
}

function resumeFitScore(
  answers: string[],
  profile: SavedProfile | null,
): number {
  const resumeText = (profile?.resumeText || '').toLowerCase()
  const skills = extractTokensFromResume(resumeText, profile?.skills || [])
  const joined = answers.join(' ').toLowerCase()
  if (!skills.length && !resumeText) return 50
  const hits = skills.filter((s) => joined.includes(s.toLowerCase())).length
  const companyHits = extractCompanies(profile, profile?.resumeText || '').filter((c) =>
    joined.includes(c.toLowerCase()),
  ).length
  return Math.min(
    100,
    Math.round((hits / Math.max(Math.min(skills.length, 5), 1)) * 70 + companyHits * 8 + 10),
  )
}

export function runLocalInterviewScore(options: {
  role: string
  level: string
  questions: Question[]
  answers: string[]
  profile: SavedProfile | null
  integrity: IntegritySnapshot
}): InterviewResult {
  const skills = options.profile?.skills ?? []
  const rubricAnswers = options.questions.map((q, i) => {
    const extended = q as Question & { scoringProfile?: string; focus?: string; topic?: string }
    const { rubrics, score, scoringProfile } = scoreAnswerRubrics(
      extended,
      options.answers[i] ?? '',
      skills,
    )
    return {
      question: q.text,
      answer: options.answers[i] ?? '',
      score,
      wordCount: (options.answers[i] ?? '').split(/\s+/).filter(Boolean).length,
      keywordsHit: q.keywords.filter((k) =>
        (options.answers[i] ?? '').toLowerCase().includes(k.toLowerCase()),
      ),
      feedback:
        score >= 75
          ? 'Strong answer for this question type.'
          : score >= 55
            ? 'Solid — add one concrete example or tool name to score higher.'
            : 'Expand and stay on the exact question asked.',
      topic: extended.topic ?? q.category,
      scoringProfile: scoringProfile ?? classifyQuestionScoringProfile(extended),
      rubrics,
      performance: score >= 80 ? 'Strong' : score >= 65 ? 'Good' : score >= 45 ? 'Fair' : 'Needs work',
    }
  })

  const rubricAgg = { correctness: [] as number[], depth: [] as number[], communication: [] as number[] }
  for (const a of rubricAnswers) {
    for (const r of a.rubrics ?? []) {
      if (r.id in rubricAgg) rubricAgg[r.id as keyof typeof rubricAgg].push(r.score)
    }
  }
  const categories = [
    { label: 'Answer Correctness', score: avg(rubricAgg.correctness) },
    { label: 'Depth', score: avg(rubricAgg.depth) },
    { label: 'Communication', score: avg(rubricAgg.communication) },
  ]
  let overall = Math.round(rubricAnswers.reduce((s, a) => s + a.score, 0) / Math.max(rubricAnswers.length, 1))

  const scored = scoreInterview(
    options.role,
    options.level,
    options.questions,
    options.answers,
    {
      skills,
      profileRole: options.profile?.currentRole,
      experienceLabel: options.profile?.totalExperience,
    },
  )

  overall = overall || scored.overall

  const fit = resumeFitScore(options.answers, options.profile)
  const strengths = [...scored.strengths]
  const improvements = [...scored.improvements]
  if (fit >= 70) strengths.unshift('Answers align well with skills/projects on your resume.')
  else improvements.unshift('Reference more tools and projects that appear on your resume.')

  const commAvg = categories.find((c) => c.label === 'Communication')?.score ?? 0
  if (commAvg >= 75) strengths.unshift('Communication is clear and well structured.')

  return {
    ...scored,
    overall,
    categories,
    answers: rubricAnswers,
    resumeFitScore: fit,
    strengths: strengths.slice(0, 6),
    improvements: improvements.slice(0, 6),
    integrity: options.integrity,
    agent: 'local-resume-agent',
  }
}
