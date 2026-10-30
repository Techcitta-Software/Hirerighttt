import { projectTechnicalQuestion } from './projectInterview'
import { selectFresherConcept, selectFresherSkills } from './fresherConcepts'
/** Interview plan shared in behavior with backend/node/interviewQuestionPlan.mjs */
import type { Question } from './interviewEngine'
import type { SavedProfile } from './store'
import { ROLE_SKILL_LIBRARY } from './roleSkillLibrary'
import { getSkillsForRole } from './roleSkillStore'

export type PlanContext = {
  skills?: string[]
  jobs?: string[]
  achievements?: string[]
  resumeSnippet?: string
  certs?: string[]
  role?: string
}

const clean = (s: unknown): string => String(s ?? '').trim()
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))]
const spokenLead = (first: string, text: string) =>
  first && first !== 'there' ? `${first}, ${text}` : text.charAt(0).toUpperCase() + text.slice(1)

type StructuredRaw = Question & { focus?: string; scoringProfile?: string }

export const FRESHER_INTERVIEW_TURN_COUNT = 7
export const FRESHER_GREETING =
  'Thanks for joining today — I am Ava, and I will guide you through this interview.'
export const FRESHER_THANK_YOU =
  'Thank you for your time today. That is all from my side. Wishing you the best with your next steps.'
export const MAX_ROLE_SKILLS = 3
export const EXPERIENCE_PROJECT_TURNS = 2
export const EXPERIENCED_FALLBACK_TURNS = 1
export const EXPERIENCED_CLOSING_TURNS = 1
export const EXPERIENCED_INTERVIEW_TURN_COUNT =
  1 + MAX_ROLE_SKILLS + EXPERIENCE_PROJECT_TURNS + EXPERIENCED_FALLBACK_TURNS + EXPERIENCED_CLOSING_TURNS

const OPENING_GREETINGS = [
  'Thanks for joining today — I am Ava, and I will guide you through this interview.',
  'Good to meet you — I am Ava. We will keep this focused on your real work experience.',
  'Hello — I am Ava, your interviewer for this session. Let us begin with your background.',
  'Welcome — I am Ava. I will ask about your experience and skills in a conversational way.',
]
const CLOSING_LINES = [
  (role: string) =>
    `Thank you for your time today — it was helpful hearing about your path toward ${role}. We will wrap up here; wishing you the best with your next steps.`,
  (role: string) =>
    `I appreciate the detail you shared in this session. That is all from my side for this ${role} conversation — take care and good luck.`,
  (role: string) =>
    `Thanks for walking me through your experience. We are done with questions for this ${role} interview — hope the rest of your day goes well.`,
  (role: string) =>
    `Great speaking with you. This concludes our ${role} interview — thank you again for your thoughtful answers.`,
]

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function resolveExactInterviewRole(profile: SavedProfile | null, roleOverride = ''): string {
  return (
    clean(profile?.currentRole) ||
    clean(profile?.workExperiences?.find((w) => w.jobTitle)?.jobTitle) ||
    clean(roleOverride) ||
    'Software Engineer'
  )
}

export function isPlanFresher(profile: SavedProfile | null, ctx: PlanContext, level = ''): boolean {
  const experience = clean(profile?.totalExperience) || clean(level)
  if (/fresher|student|no (?:work )?experience|^0(?:\s*(?:years?|months?))?$|less than 1/i.test(experience))
    return true
  if ((ctx.jobs || []).length || profile?.workExperiences?.some((w) => w.company || w.jobTitle)) return false
  const years = Number.parseFloat(experience)
  return !Number.isFinite(years) || years === 0
}

const ROLE_RESUME_SKILL_PATTERNS: { role: RegExp; skill: RegExp }[] = [
  { role: /data engineer|big data engineer|analytics engineer/i, skill: /pyspark|spark|airflow|kafka|dbt|snowflake|python|^sql$|etl|pipeline|warehouse/i },
  { role: /machine learning|ml engineer|data scientist|ai engineer|mlops/i, skill: /python|tensorflow|pytorch|sklearn|scikit|pandas|sql|feature|model|mlops|docker/i },
  { role: /devops|sre|platform engineer|cloud engineer/i, skill: /docker|kubernetes|terraform|aws|azure|gcp|ci\/cd|linux|monitoring/i },
  { role: /frontend|react|ui developer|web developer/i, skill: /react|typescript|javascript|css|html|next|redux|vue|angular/i },
  { role: /backend|api developer|java developer|python developer/i, skill: /node|python|java|postgres|mysql|rest|api|spring|django|redis/i },
]

function resumeSkillsRelevantToRole(exactRole: string, ctx: PlanContext): string[] {
  const entry = ROLE_RESUME_SKILL_PATTERNS.find((e) => e.role.test(clean(exactRole)))
  if (!entry) return []
  return unique((ctx.skills || []).map(clean).filter((s) => s && entry.skill.test(s)))
}

function canonicalSkillKey(value: string): string {
  return value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9+#]/g, '')
}

function resumeSkillEvidence(ctx: PlanContext): string[] {
  const fromProfile = (ctx.skills || []).map(clean).filter(Boolean)
  const snippet = clean(ctx.resumeSnippet)
  if (!snippet) return unique(fromProfile)
  const catalog =
    'Python JavaScript TypeScript Java React Node SQL PostgreSQL MySQL PySpark Spark Airflow Kafka Docker Kubernetes AWS Excel Figma Git Linux HTML CSS'
  const fromText = catalog.split(/\s+/).filter((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(snippet)
  })
  return unique([...fromProfile, ...fromText])
}

/** Role catalog skills the résumé supports (e.g. Python on résumé → PySpark for Data Engineer). */
export function planRoleAlignedInterviewSkills(
  exactRole: string,
  ctx: PlanContext,
  varietySeed: string,
  roleSkillsFromStore: string[] | null = null,
): string[] {
  const catalog = jsonRoleSkillsForInterview(exactRole, roleSkillsFromStore)
  const resumeSkills = resumeSkillEvidence(ctx)
  const roleLower = clean(exactRole).toLowerCase()
  const has = (pattern: RegExp) => resumeSkills.some((s) => pattern.test(s))

  const eligible = catalog.filter((skill) => {
    const s = clean(skill)
    if (!s) return false
    if (isSqlSkill(s)) return has(/sql|postgres|mysql|sqlite|tsql|pl\/?sql/i) || /data|engineer|analyst|bi|backend|full stack/i.test(roleLower)
    if (/pyspark|^spark$/i.test(s)) {
      return (
        has(/pyspark|spark/i) ||
        (has(/python/i) && /data engineer|big data|analytics engineer|data analyst/i.test(roleLower))
      )
    }
    if (/python/i.test(s)) return has(/python/i)
    if (/react|angular|vue/i.test(s)) return has(/react|angular|vue|javascript|typescript/i)
    if (/javascript|typescript/i.test(s)) return has(/javascript|typescript|react|node/i)
    if (/node/i.test(s)) return has(/node|javascript|typescript/i)
    if (/docker|kubernetes|terraform|aws|azure|gcp/i.test(s)) return has(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
    return resumeSkills.some((r) => canonicalSkillKey(r) === canonicalSkillKey(s))
  })

  let pool =
    eligible.length >= 2
      ? eligible
      : unique([...resumeSkillsRelevantToRole(exactRole, ctx), ...eligible, ...catalog])

  if (pool.some((s) => /pyspark|^spark$/i.test(s)) && pool.some((s) => /^python$/i.test(s))) {
    pool = pool.filter((s) => !/^python$/i.test(s))
  }

  if (!pool.length) pool = [...catalog]
  const start = hashString(`${varietySeed}|aligned-skills|${exactRole}`) % pool.length
  const rotated = [...pool.slice(start), ...pool.slice(0, start)]
  const nonSql = rotated.filter((s) => !isSqlSkill(s))
  const sqlSkills = rotated.filter((s) => isSqlSkill(s))
  let catalogTail = catalog
  if (nonSql.some((s) => /pyspark|^spark$/i.test(s))) {
    catalogTail = catalog.filter((s) => !/^python$/i.test(s))
  }
  return unique([...nonSql, ...sqlSkills, ...catalogTail]).slice(0, MAX_ROLE_SKILLS)
}

function planFresherTheorySkills(
  exactRole: string,
  ctx: PlanContext,
  varietySeed: string,
  roleSkillsFromStore: string[] | null,
): [string, string, string] {
  const aligned = planRoleAlignedInterviewSkills(exactRole, ctx, varietySeed, roleSkillsFromStore)
  const sqlSkill = aligned.find((s) => isSqlSkill(s)) || 'SQL'
  const nonSql = aligned.filter((s) => !isSqlSkill(s))
  const coding = pickFresherCodingLanguage(ctx.skills || [])
  const fallbackOther = pickFresherOtherSkill(ctx.skills || [], coding)
  const slot2 = nonSql[0] || aligned[0] || coding
  const slot4 = nonSql.find((s) => canonicalSkillKey(s) !== canonicalSkillKey(slot2)) || nonSql[1] || fallbackOther
  return [slot2, sqlSkill, slot4]
}

export function parseExperienceYears(level = '', profile: SavedProfile | null = null): number {
  const raw = clean(profile?.totalExperience) || clean(level)
  if (/fresher|student|no (?:work )?experience|less than 1/i.test(raw)) return 0
  const band = raw.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/)
  if (band) return (Number(band[1]) + Number(band[2])) / 2 / (/month/i.test(raw) ? 12 : 1)
  const years = raw.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i)
  const months = raw.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?)/i)
  if (years || months) return Number(years?.[1] || 0) + Number(months?.[1] || 0) / 12
  const n = Number.parseFloat(raw)
  if (Number.isFinite(n)) return Math.max(0, n)
  if (/senior|lead|principal|architect/i.test(raw)) return 8
  return 0
}

export function experienceTierFromYears(years: number, _level = ''): 'junior' | 'mid' | 'senior' {
  if (years >= 5) return 'senior'
  if (years >= 2) return 'mid'
  return 'junior'
}

export function jsonRoleSkillsForInterview(exactRole: string, roleSkillsFromStore: string[] | null = null): string[] {
  const fromStore = Array.isArray(roleSkillsFromStore) ? roleSkillsFromStore.map(clean).filter(Boolean) : []
  if (fromStore.length) return fromStore.slice(0, MAX_ROLE_SKILLS)
  const fromJson = getSkillsForRole(exactRole)
  if (fromJson.length) return fromJson.slice(0, MAX_ROLE_SKILLS)
  const fromLibrary = ROLE_SKILL_LIBRARY.find((entry) => entry.test.test(exactRole))?.skills
  if (fromLibrary?.length) return fromLibrary.slice(0, MAX_ROLE_SKILLS)
  return [`${exactRole} fundamentals`, `${exactRole} quality and risk principles`, 'Problem Solving']
}

export function recommendTopSkillsForRole(
  exactRole: string,
  ctx: PlanContext,
  roleSkillsFromStore: string[] | null = null,
): string[] {
  const fromStore = Array.isArray(roleSkillsFromStore) ? roleSkillsFromStore.map(clean).filter(Boolean) : []
  const fromJson = fromStore.length ? fromStore : getSkillsForRole(exactRole)
  const defaults =
    fromJson.length > 0
      ? fromJson
      : ROLE_SKILL_LIBRARY.find((entry) => entry.test.test(exactRole))?.skills
  if (!defaults?.length) return [`${exactRole} fundamentals`, `${exactRole} quality and risk principles`, 'Problem Solving']
  const canonical = (value: string) => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '')
  const evidence = (ctx.skills || []).map(canonical)
  const known = defaults.filter((skill) => evidence.includes(canonical(skill)))
  const fromResume = resumeSkillsRelevantToRole(exactRole, ctx)
  return unique([...fromResume, ...known, ...defaults]).slice(0, MAX_ROLE_SKILLS)
}

export function resolveInterviewTurnCount(
  profile: SavedProfile | null,
  ctx: PlanContext,
  level = '',
  roleSkillsFromStore: string[] | null = null,
): number {
  const exactRole = resolveExactInterviewRole(profile, ctx?.role || '')
  return structuredPlanSummary(exactRole, ctx, profile, level, roleSkillsFromStore).totalTurns
}

function resolveMostRecentJob(profile: SavedProfile | null, ctx: PlanContext) {
  const we = profile?.workExperiences?.[0]
  if (we?.jobTitle || we?.company) {
    return {
      label: `${clean(we.jobTitle) || 'Role'} at ${clean(we.company) || 'Company'}`.replace(/ at Company$/, ''),
      responsibilities: clean(we.responsibilities || ('description' in we && typeof we.description === 'string' ? we.description : '')),
    }
  }
  const line = clean(ctx.jobs?.[0])
  if (!line) return { label: 'your most recent role', responsibilities: '' }
  return {
    label: line.split(':')[0].slice(0, 160),
    responsibilities: line.includes(':') ? line.split(':').slice(1).join(':').trim() : '',
  }
}

function splitResumeBullets(text: string) {
  return String(text ?? '')
    .split(/\r?\n|•|·|▪|\u2022|(?<=[.!?])\s+/)
    .map(clean)
    .filter((s) => s.length >= 20 && s.length <= 320)
}

function scoreProjectLine(line: string, exactRole: string, ctx: PlanContext) {
  const lower = line.toLowerCase()
  let score = 0
  if (
    /project|built|develop|implement|design|deliver|migrat|pipeline|platform|system|application|product|architect|led|owned|launch/i.test(
      lower,
    )
  )
    score += 2
  const roleTokens = clean(exactRole)
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3)
  if (roleTokens.some((t) => lower.includes(t))) score += 2
  for (const skill of (ctx.skills || []).map(clean).filter(Boolean)) {
    const s = skill.toLowerCase().replace(/\.js\b/, '')
    if (s.length >= 2 && lower.includes(s)) score += 1
  }
  return score
}

export type ResumeProjectAnchor = {
  label: string
  summary: string
  employer: string
  source: string
  score: number
}

export function extractResumeProjects(
  profile: SavedProfile | null,
  ctx: PlanContext,
  exactRole = '',
): ResumeProjectAnchor[] {
  const role = clean(exactRole) || clean(ctx?.role) || resolveExactInterviewRole(profile, '')
  const projects: ResumeProjectAnchor[] = []
  const explicitProjects = profile && 'projects' in profile && Array.isArray(profile.projects) ? profile.projects : [];
  for (const item of explicitProjects) {
    const entry = typeof item === 'string' ? { name: item } : item;
    if (!entry || typeof entry !== 'object') continue;
    const label = clean(entry.name || entry.title);
    const summary = [label, entry.description, entry.contribution, ...(Array.isArray(entry.technologies) ? entry.technologies : []), ...(Array.isArray(entry.tools) ? entry.tools : [])].filter(v => typeof v === 'string').join('. ');
    if (!label || !summary) continue;
    projects.push({label: label.slice(0, 110), summary: summary.slice(0, 500), employer: clean(entry.company || entry.employer), source: 'project', score: scoreProjectLine(summary, role, ctx) + 3});
  }

  for (const ach of (ctx.achievements || []).map(clean).filter(Boolean)) {
    if (!/project|built|develop|implement|design|deliver|migrat|pipeline|platform|application|launch/i.test(ach)) continue;
    projects.push({
      label: ach.slice(0, 110),
      summary: ach.slice(0, 240),
      employer: '',
      source: 'achievement',
      score: scoreProjectLine(ach, role, ctx) + 1,
    })
  }
  for (const we of profile?.workExperiences || []) {
    const employer = `${clean(we.jobTitle) || 'Role'} at ${clean(we.company) || 'Company'}`.replace(
      / at Company$/,
      '',
    )
    const blob = [('description' in we && typeof we.description === 'string' ? we.description : ''), we.responsibilities].filter(Boolean).join('\n')
    for (const line of splitResumeBullets(blob)) {
    if (!/project|built|develop|implement|design|deliver|migrat|pipeline|platform|application|launch/i.test(line)) continue;
      projects.push({
        label: line.slice(0, 110),
        summary: line.slice(0, 240),
        employer,
        source: 'experience',
        score: scoreProjectLine(line, role, ctx),
      })
    }
  }
  const snippet = clean(profile?.resumeText || ctx.resumeSnippet)
  if (snippet) {
    for (const line of splitResumeBullets(snippet)) {
      if (
        !/project|built|develop|implement|design|deliver|pipeline|platform|system|application|architect|migrat/i.test(
          line,
        )
      )
        continue
      projects.push({
        label: line.slice(0, 110),
        summary: line.slice(0, 240),
        employer: '',
        source: 'resume',
        score: scoreProjectLine(line, role, ctx),
      })
    }
  }
  const seen = new Set<string>()
  return projects
    .sort((a, b) => b.score - a.score)
    .filter((p) => {
      const key = p.label.slice(0, 48).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 8)
}

function pickProjectAnchor(projects: ResumeProjectAnchor[], _slot: number, varietySeed: string) {
  if (!projects.length) return null;
  const best = projects.filter(p => p.score >= projects[0].score - 1);
  return best[hashString(varietySeed + '|project') % best.length];
}



const CODING_LANGUAGE_RE =
  /^(python|javascript|typescript|java|c\+\+|c#|go|golang|ruby|kotlin|swift|php|dart|rust|scala|r|node\.?js)$/i
const SQL_SKILL_RE = /^(sql|postgresql|postgres|mysql|sqlite|tsql|pl\/?sql)$/i

function isCodingLanguageSkill(skill: string): boolean {
  return CODING_LANGUAGE_RE.test(clean(skill))
}

function isSqlSkill(skill: string): boolean {
  return SQL_SKILL_RE.test(clean(skill).replace(/\s+/g, ''))
}

export function pickFresherCodingLanguage(skills: string[] = []): string {
  const known = skills.map(clean).filter(Boolean)
  return known.find(isCodingLanguageSkill) || 'a programming language you know'
}

export function pickFresherOtherSkill(skills: string[] = [], codingLanguage: string): string {
  const skip = new Set(
    [codingLanguage, 'SQL', 'PostgreSQL', 'Postgres', 'MySQL']
      .map((value) => value.toLowerCase().replace(/[^a-z0-9+#]/g, '')),
  )
  const other = skills
    .map(clean)
    .filter(Boolean)
    .find((skill) => {
      const key = skill.toLowerCase().replace(/[^a-z0-9+#]/g, '')
      return key && !skip.has(key) && !isSqlSkill(skill) && !isCodingLanguageSkill(skill)
    })
  return other || 'a skill you know'
}

export function fresherSkillForTurn(
  plan: { recommendedSkills?: string[] },
  turn: number,
): string {
  if (turn === 2) return plan.recommendedSkills?.[0] || 'a programming language you know'
  if (turn === 3) return plan.recommendedSkills?.[1] || 'SQL'
  if (turn === 4) return plan.recommendedSkills?.[2] || 'a skill you know'
  return ''
}

export function isTheoryTurnForPlan(plan: ReturnType<typeof structuredPlanSummary>, turn: number): boolean {
  if (plan.fresher) return turn >= 2 && turn <= 4
  return turn >= 2 && turn <= 1 + MAX_ROLE_SKILLS
}

export function analyzeOpeningAnswerAlignment(answer: string, roleSkills: string[], ctx: PlanContext = {}) {
  void ctx
  const jsonSkills = jsonRoleSkillsForInterview('', roleSkills)
  const canonical = (value: string) => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '')
  const lower = clean(answer).toLowerCase()
  if (!lower) {
    return {
      matched: [] as string[],
      unmatched: [...jsonSkills],
      orderedSkills: [...jsonSkills],
      matchRatio: 0,
      skillsFromJsonFallback: true,
    }
  }
  const blob = lower.replace(/[^a-z0-9\s]/g, ' ')
  const matched: string[] = []
  const unmatched: string[] = []
  for (const skill of jsonSkills) {
    const s = clean(skill)
    if (!s) continue
    const c = canonical(s)
    let hit = lower.includes(s.toLowerCase()) || (c.length >= 3 && blob.replace(/\s/g, '').includes(c))
    if (!hit && /spark|pyspark/i.test(s) && /spark|pyspark/i.test(lower)) hit = true
    if (hit) matched.push(s)
    else unmatched.push(s)
  }
  if (!matched.length) {
    return {
      matched: [],
      unmatched: [...jsonSkills],
      orderedSkills: [...jsonSkills],
      matchRatio: 0,
      skillsFromJsonFallback: true,
    }
  }
  const orderedSkills = unique([...matched, ...unmatched]).slice(0, MAX_ROLE_SKILLS)
  return {
    matched: unique(matched),
    unmatched: unique(unmatched),
    orderedSkills,
    matchRatio: jsonSkills.length ? matched.length / jsonSkills.length : 0,
    skillsFromJsonFallback: false,
  }
}

export function experiencedTurnSlot(turn: number) {
  if (turn === 1) return 'opening'
  if (turn >= 2 && turn <= 1 + MAX_ROLE_SKILLS) return 'skill'
  if (turn >= 2 + MAX_ROLE_SKILLS && turn <= 1 + MAX_ROLE_SKILLS + EXPERIENCE_PROJECT_TURNS) return 'project'
  if (turn === 1 + MAX_ROLE_SKILLS + EXPERIENCE_PROJECT_TURNS + 1) return 'fallback'
  if (turn === EXPERIENCED_INTERVIEW_TURN_COUNT) return 'closing'
  return 'unknown'
}


const THEORY_TOPICS: [RegExp, string, string][] = [
  [
    /^sql$|postgres|mysql/i,
    'how INNER JOIN differs from LEFT JOIN, including what happens when there is no matching row',
    'how transaction isolation keeps updates from interfering with each other',
  ],
  [
    /react/i,
    'how props and state differ and when a component re-renders',
    'how React uses keys to keep track of items when a list changes',
  ],
  [/node/i, 'how the event loop handles asynchronous I/O', 'how you would handle a stream that receives data faster than it can process it'],
  [
    /javascript|typescript/i,
    'how lexical scope and closures work',
    'how the event loop orders microtasks and tasks and why that order matters',
  ],
  [
    /python/i,
    'how mutable and immutable objects differ and what that means for function arguments',
    'how generators save memory compared with lists',
  ],
  [/^java$/i, 'how interfaces differ from abstract classes', 'how you would safely update shared data from several threads'],
  [/^c\+\+$|^c#$/i, 'how value and reference semantics differ', 'how resource ownership and object lifetime affect memory safety'],
  [
    /docker/i,
    'how an image differs from a container',
    'how layered filesystems and multi-stage builds affect reproducibility and image size',
  ],
  [
    /kubernetes/i,
    'how a deployment differs from a service',
    'how readiness and liveness probes affect rollout safety and availability',
  ],
  [/statistics/i, 'how correlation differs from causation', 'how selection bias and confounding affect causal interpretation'],
  [
    /ai \/ ml/i,
    'how overfitting differs from underfitting',
    'how data leakage affects model validation and how to prevent it',
  ],
]

const ALT_GENERIC_CONCEPTS = [
  'a core concept practitioners often misunderstand',
  'how you would debug a subtle issue in production',
  'a design choice you would make differently for scale versus simplicity',
  'how you would explain this topic to a teammate new to the stack',
]

const TIERED_SKILL_CONCEPTS: [RegExp, { junior: string[]; mid: string[]; senior: string[] }][] = [
  [
    /pyspark|apache spark|^spark$/i,
    {
      junior: [
        'what a Spark DataFrame is and how it differs from working row-by-row in plain Python',
        'why transformations stay lazy until an action runs',
        'how you would drop or fill nulls in a column before an aggregation',
      ],
      mid: [
        'why PySpark waits to run transformations until an action is called',
        'how you would repartition data before a heavy join',
        'how you would debug a job that runs out of memory on one task',
      ],
      senior: [
        'how you would handle data skew when some Spark tasks take much longer than others',
        'how you would choose between broadcast join and sort-merge join',
        'how you would validate a pipeline after a schema change upstream',
      ],
    },
  ],
  [
    /^etl$|extract transform load|data pipeline/i,
    {
      junior: [
        'the basic stages of an ETL pipeline and what can go wrong at each stage',
        'how you would check row counts between extract and load',
      ],
      mid: [
        'how you would rerun an ETL job without creating duplicate data',
        'how idempotency keys or watermarks help with late data',
      ],
      senior: [
        'how you design backfills and failure recovery without corrupting downstream tables',
        'how you would monitor SLA breaches in a multi-step pipeline',
      ],
    },
  ],
]

function pickConceptFromPool(
  pool: string[],
  varietySeed: string,
  skill: string,
  turn: number,
  priorTexts: string[],
): string {
  const unused = pool.filter(
    (concept) => !priorTexts.some((text) => text.toLowerCase().includes(concept.toLowerCase().slice(0, 28))),
  )
  const candidates = unused.length ? unused : pool
  return candidates[hashString(`${varietySeed}|${skill}|${turn}|concept`) % candidates.length]
}

function resolveSkillConcept(
  skill: string,
  tier: 'junior' | 'mid' | 'senior',
  varietySeed: string,
  turn: number,
  priorTexts: string[] = [],
): string {
  const tiered = TIERED_SKILL_CONCEPTS.find(([pattern]) => pattern.test(skill))
  if (tiered) {
    const pool = tiered[1][tier]
    return pickConceptFromPool(pool, varietySeed, skill, turn, priorTexts)
  }
  const topics = THEORY_TOPICS.find(([pattern]) => pattern.test(skill))
  if (topics) {
    const pool =
      tier === 'senior'
        ? [topics[2], `${topics[1]} at scale`]
        : tier === 'mid'
          ? [`${topics[1]} and when you would use it`, topics[1]]
          : [topics[1]]
    return pickConceptFromPool(pool, varietySeed, skill, turn, priorTexts)
  }
  const alt = ALT_GENERIC_CONCEPTS[hashString(`${varietySeed}|${skill}|${turn}`) % ALT_GENERIC_CONCEPTS.length]
  if (tier === 'senior') return pickConceptFromPool([`how you would compare two approaches using ${skill}`, alt.replace('this topic', skill)], varietySeed, skill, turn, priorTexts)
  if (tier === 'mid') return alt.replace('this topic', skill)
  return pickConceptFromPool([`a core ${skill} concept practitioners use daily`, `how ${skill} fits into the ${skill} toolchain`], varietySeed, skill, turn, priorTexts)
}

function buildSkillQuestion(
  first: string,
  skill: string,
  level: string,
  turn: number,
  _fresher: boolean,
  varietySeed = '',
  options: {
    skillMatchedInOpening?: boolean
    exactRole?: string
    profile?: SavedProfile | null
    priorTexts?: string[]
  } = {},
): StructuredRaw {
  const exactRole = clean(options.exactRole) || 'this role'
  const years = parseExperienceYears(level, options.profile ?? null)
  const tier = experienceTierFromYears(years)
  const priorTexts = options.priorTexts || []
  const concept = _fresher
    ? selectFresherConcept(skill, varietySeed, turn, priorTexts)
    : resolveSkillConcept(skill, tier, varietySeed, turn, priorTexts)
  const body =
    skill === 'a skill you know'
      ? `pick something you've practiced and explain ${concept} in plain words.`
      : _fresher
        ? `can you explain ${concept} in ${skill}, in simple terms?`
        : `for ${skill} in ${exactRole}, explain ${concept}.`
  return {
    text: spokenLead(first, body),
    category: 'Technical',
    keywords: [skill.toLowerCase(), exactRole.toLowerCase(), tier],
    hint: 'Explain the concept directly for this role and experience level. No résumé story required.',
    topic: skill,
    focus: `structured-theory-${turn}`,
    scoringProfile: 'technical',
  }
}

function buildOpeningWorkQuestion(
  first: string,
  profile: SavedProfile | null,
  ctx: PlanContext,
  _exactRole: string,
  varietySeed = '',
): StructuredRaw {
  const job = resolveMostRecentJob(profile, ctx)
  const greeting = OPENING_GREETINGS[hashString(varietySeed || 'open') % OPENING_GREETINGS.length]
  const lead = first && first !== 'there' ? `${greeting} ${first},` : greeting
  return {
    text: `${lead} what were your main responsibilities in ${job.label}?`
      .replace(/\s+/g, ' ')
      .trim(),
    category: 'Experience',
    keywords: ['responsibilities', 'experience', 'exposure', 'role'],
    hint: 'Describe your main tasks in simple words.',
    topic: 'Opening — prior employer',
    resumeAnchor: job.label,
    focus: 'structured-opening-generic',
    scoringProfile: 'opening_generic',
  }
}

function buildFallbackRecentQuestion(
  first: string,
  profile: SavedProfile | null,
  ctx: PlanContext,
  varietySeed = '',
  lastAnswer = '',
): StructuredRaw {
  const job = resolveMostRecentJob(profile, ctx)
  const variant = hashString(`${varietySeed}|fallback`) % 3
  const snippets = [
    `following up on your earlier answers about ${job.label}, pick one responsibility you mentioned and go deeper — what was hardest, and how did you handle it?`,
    `thinking about ${job.label}, how would you decide which task to work on first?`,
    `thinking about ${job.label}, how would you decide whether a task is complete?`,
  ]
  let text = snippets[variant]
  if (clean(lastAnswer).length > 40 && variant === 0) {
    text = `as a follow-up, what would you change about the approach in your last answer?`
  }
  return {
    text: spokenLead(first, text),
    category: 'Problem Solving',
    keywords: ['follow-up', 'decision', 'outcome'],
    hint: 'Explain your approach; a hypothetical example is fine.',
    topic: 'Recent work follow-up',
    resumeAnchor: job.label,
    focus: 'structured-fallback-recent',
    scoringProfile: 'project',
  }
}

function buildClosingQuestion(first: string, exactRole: string, varietySeed = ''): StructuredRaw {
  const line = CLOSING_LINES[hashString(`${varietySeed}|close`) % CLOSING_LINES.length](exactRole)
  return {
    text: first && first !== 'there' ? `${first}, ${line}` : line,
    category: 'Communication',
    keywords: ['closing', 'thanks'],
    hint: 'A brief, professional sign-off is fine.',
    topic: 'Closing',
    focus: 'structured-closing',
    scoringProfile: 'behavioral',
  }
}

function buildFresherIntroQuestion(first: string): StructuredRaw {
  const lead = first && first !== 'there' ? `${FRESHER_GREETING} ${first},` : FRESHER_GREETING
  return {
    text: `${lead} to start, tell me a bit about yourself — your studies, what you've picked up so far, and the kind of role you want.`
      .replace(/\s+/g, ' ')
      .trim(),
    category: 'Communication',
    keywords: ['about yourself', 'education', 'background', 'introduction'],
    hint: 'About a minute: who you are, your studies, and one thing you want from this role.',
    topic: 'About yourself',
    focus: 'structured-fresher-intro',
    scoringProfile: 'behavioral',
  }
}

function buildFresherClosingQuestion(first: string): StructuredRaw {
  return {
    text:
      first && first !== 'there'
        ? `${first}, ${FRESHER_THANK_YOU[0].toLowerCase()}${FRESHER_THANK_YOU.slice(1)}`
        : FRESHER_THANK_YOU,
    category: 'Communication',
    keywords: ['closing', 'thanks'],
    hint: 'A brief, professional sign-off is fine.',
    topic: 'Closing',
    focus: 'structured-closing',
    scoringProfile: 'behavioral',
  }
}

function projectQuestion(
  first: string,
  profile: SavedProfile | null,
  ctx: PlanContext,
  slot: 1 | 2,
  exactRole = '',
  varietySeed = '',
  lastAnswer = '',
): StructuredRaw {
  const role = clean(exactRole) || clean(ctx.role) || 'this role'
  const anchor = pickProjectAnchor(extractResumeProjects(profile, ctx, role), 1, varietySeed)
  return {
    text: spokenLead(
      first,
      projectTechnicalQuestion(anchor?.label || '', anchor?.summary || '', role, 0, slot, varietySeed, lastAnswer),
    ),
    category: slot === 1 ? 'Experience' : 'Problem Solving',
    keywords: ['project', slot === 1 ? 'contribution' : 'testing', role.toLowerCase()],
    hint: 'Explain your own part in a real academic, personal, or practice project. Employment is not required.',
    topic: slot === 1 ? 'Project contribution' : 'Project technical',
    resumeAnchor: anchor?.label,
    focus: `structured-project-${slot}`,
    scoringProfile: 'project',
  }
}

function lastExperienceProjectQuestion(first: string, profile: SavedProfile | null, ctx: PlanContext, slot: number, level: string, varietySeed = '', exactRole = '', options: {lastOpeningAnswer?: string; lastAnswer?: string} = {}): StructuredRaw {
  const role = clean(exactRole) || resolveExactInterviewRole(profile, ctx?.role);
  const years = parseExperienceYears(level, profile);
  const anchor = pickProjectAnchor(extractResumeProjects(profile, ctx, role), 1, varietySeed);
  return {
    text: spokenLead(first, projectTechnicalQuestion(anchor?.label || '', anchor?.summary || '', role, years, slot, varietySeed, options.lastAnswer || '')),
    category: slot === 1 ? 'Experience' : 'Problem Solving',
    keywords: ['project', slot === 1 ? 'contribution' : 'validation', role.toLowerCase()],
    hint: 'Explain what you personally did. Use the tools and decisions from your real project.',
    topic: slot === 1 ? 'Recent work project' : 'Recent work problem solving',
    resumeAnchor: anchor?.label, focus: `structured-recent-project-${slot}`, scoringProfile: 'project',
  };
}

export function buildStructuredTurnQuestion(options: {
  turnNumber: number
  first: string
  level: string
  profile: SavedProfile | null
  ctx: PlanContext
  roleOverride?: string
  history?: { question: Question; answer: string }[]
  senior?: boolean
  planSummary?: ReturnType<typeof structuredPlanSummary>
  roleSkills?: string[] | null
  varietySeed?: string
  openingAnalysis?: ReturnType<typeof analyzeOpeningAnswerAlignment> | null
  lastAnswer?: string
}): StructuredRaw | null {
  const { turnNumber: turn, first, level, profile, ctx } = options
  const role = resolveExactInterviewRole(profile, options.roleOverride || ctx.role)
  const fresh = isPlanFresher(profile, ctx, level)
  const plan =
    options.planSummary ||
    structuredPlanSummary(role, ctx, profile, level, options.roleSkills, options.openingAnalysis, options.varietySeed)
  const maxTurn = plan.totalTurns || FRESHER_INTERVIEW_TURN_COUNT
  if (turn < 1 || turn > maxTurn) return null
  const expLevel = clean(profile?.totalExperience) || level
  const varietySeed = clean(options.varietySeed)

  if (fresh) {
    if (turn === 1) return buildFresherIntroQuestion(first)
    if (turn >= 2 && turn <= 4) {
      const skill = fresherSkillForTurn(plan, turn)
      return buildSkillQuestion(first, skill, expLevel, turn, true, varietySeed, {
        exactRole: role,
        priorTexts: (options.history || []).map((h) =>
          typeof h.question === 'string' ? h.question : h.question.text || '',
        ),
      })
    }
    if (turn === 5) return projectQuestion(first, profile, ctx, 1, role, varietySeed, options.lastAnswer || '')
    if (turn === 6) return projectQuestion(first, profile, ctx, 2, role, varietySeed, options.lastAnswer || '')
    return buildFresherClosingQuestion(first)
  }

  const openingAnalysis = options.openingAnalysis
  const priorTexts = (options.history || []).map((h) =>
    typeof h.question === 'string' ? h.question : h.question.text || '',
  )
  const slot = experiencedTurnSlot(turn)
  if (slot === 'opening') return buildOpeningWorkQuestion(first, profile, ctx, role, varietySeed)
  if (slot === 'skill') {
    const skillIndex = turn - 2
    const skill = plan.recommendedSkills[skillIndex]
    if (!skill) return null
    const matched = openingAnalysis?.matched?.some((m) => clean(m).toLowerCase() === clean(skill).toLowerCase())
    return buildSkillQuestion(first, skill, expLevel, turn, false, varietySeed, {
      skillMatchedInOpening: matched,
      exactRole: role,
      profile,
      priorTexts,
    })
  }
  if (slot === 'project')
    return lastExperienceProjectQuestion(
      first,
      profile,
      ctx,
      turn - (1 + MAX_ROLE_SKILLS),
      expLevel,
      varietySeed,
      role,
      {
        lastOpeningAnswer: options.history?.[0]?.answer || '',
        lastAnswer: options.lastAnswer || '',
      },
    )
  if (slot === 'fallback')
    return buildFallbackRecentQuestion(first, profile, ctx, varietySeed, options.lastAnswer || '')
  if (slot === 'closing') return buildClosingQuestion(first, role, varietySeed)
  return null
}

export function structuredPlanSummary(
  exactRole: string,
  ctx: PlanContext,
  profile: SavedProfile | null = null,
  level = '',
  roleSkillsFromStore: string[] | null = null,
  openingAnalysis: ReturnType<typeof analyzeOpeningAnswerAlignment> | null = null,
  varietySeed = '',
) {
  const fresher = isPlanFresher(profile, ctx, level)
  const topRoleSkills = jsonRoleSkillsForInterview(exactRole, roleSkillsFromStore)
  const aligned = planRoleAlignedInterviewSkills(exactRole, ctx, varietySeed, roleSkillsFromStore)
  const skills =
    !fresher && openingAnalysis?.matched?.length && !openingAnalysis.skillsFromJsonFallback
      ? unique([...openingAnalysis.orderedSkills, ...aligned]).slice(0, MAX_ROLE_SKILLS)
      : aligned
  if (fresher) {
    const [skillQ2, skillQ3, skillQ4] = planFresherTheorySkills(exactRole, ctx, varietySeed, roleSkillsFromStore)
    const fresherSkills = [skillQ2, skillQ3, skillQ4]
    return {
      exactRole,
      fresher,
      recommendedSkills: fresherSkills,
      topRoleSkills,
      experienceYears: parseExperienceYears(level, profile),
      difficulty: experienceTierFromYears(parseExperienceYears(level, profile)),
      totalTurns: FRESHER_INTERVIEW_TURN_COUNT,
      turnPlan: [
        'Q1: same greeting for every fresher, then ask the candidate to tell about themselves',
        `Q2: beginner ${exactRole} topic — ${skillQ2} (conceptual, not a work story)`,
        `Q3: beginner SQL question (${skillQ3})`,
        `Q4: beginner ${exactRole} topic — ${skillQ4} (conceptual)`,
        'Q5: what they built in a real academic or personal project; do not assume employment',
        'Q6: technical follow-up on that same project: how they built, tested, or fixed it',
        'Q7: same thank-you for every fresher',
      ],
    }
  }
  const turnPlan = [
    `Q1: greet; roles, responsibilities, experience and exposure at most recent employer`,
    ...skills.map(
      (skill, i) =>
        `Q${i + 2} technical: ${skill}; difficulty from experience; conceptual, not résumé story`,
    ),
    `Q${2 + MAX_ROLE_SKILLS}: real résumé project — how it was implemented for ${exactRole}; use only evidenced tools`,
    `Q${3 + MAX_ROLE_SKILLS}: technical follow-up on the same project — testing, debugging or design choices; depth from experience`,
    `Q${4 + MAX_ROLE_SKILLS}: fallback follow-up on recent work`,
    `Q${EXPERIENCED_INTERVIEW_TURN_COUNT}: varied closing thanks`,
  ]
  return {
    exactRole,
    fresher,
    recommendedSkills: skills,
            topRoleSkills,
            experienceYears: parseExperienceYears(level, profile),
            difficulty: experienceTierFromYears(parseExperienceYears(level, profile)),
    totalTurns: EXPERIENCED_INTERVIEW_TURN_COUNT,
    turnPlan,
  }
}

export function questionMatchesPlan(
  question: { text?: string; topic?: string; resumeAnchor?: string },
  plan: ReturnType<typeof structuredPlanSummary>,
  turn: number,
): boolean {
  const text = clean(question.text)
  if (/\b(?:prove|proof)\b|\byou (?:claim|claimed|say|said|mentioned|have worked|worked|have been working)\b|\byou['’]ve worked\b|\b(?:verify|justify) (?:your|that you)\b|\bevidence (?:of|that)\b/i.test(text)) return false
  if (!plan.fresher && turn === 1)
    return /responsibilit|experience|exposure|role|walk me through|begin/i.test(text)
  if (!plan.fresher && turn === EXPERIENCED_INTERVIEW_TURN_COUNT)
    return /thank|appreciat|conclud|wrap|wish|good luck|best/i.test(text)
  if (!plan.fresher && experiencedTurnSlot(turn) === 'fallback')
    return /follow|deeper|expand|decision|decide|handle|metric|outcome|mentioned/i.test(text)
  const theory = isTheoryTurnForPlan(plan, turn)
  if (theory) {
    const skill = plan.fresher ? fresherSkillForTurn(plan, turn) : plan.recommendedSkills[turn - 2]
    if (
      question.resumeAnchor ||
      /résumé|resume|your (?:project|experience|work|background)|you (?:used|built|implemented|worked|applied)|tell me about a time|describe a (?:time|situation|challenge)|you have|you've/i.test(
        text,
      )
    )
      return false
    const normalized = (value: string) => value.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '')
    if (skill !== 'a skill you know' && !normalized(text).includes(normalized(skill))) return false
    return /explain|what|how|why|compare|difference|define/i.test(text)
  }
  if (plan.fresher && turn === 1)
    return /about yourself|tell me about|education|background|looking for/i.test(text)
  if (plan.fresher && turn === FRESHER_INTERVIEW_TURN_COUNT)
    return /thank|appreciat|all from my side|wish|good luck|best/i.test(text)
  if (plan.fresher && (turn === 5 || turn === 6))
    return /project|academic|practice|coursework|assignment|built|test|debug|fix/i.test(text) &&
      !/your (?:employer|company|job)|at work/i.test(text)
  if (!plan.fresher && experiencedTurnSlot(turn) === 'project')
    return /project|deliver|initiative|work|role|contribut|problem|decision|challenge|valid|fix|bug|release/i.test(text)
  return /work|responsibilit|role|contribut|problem|decision|challenge/i.test(text)
}

export function selectProjectForInterview(profile: SavedProfile | null, ctx: PlanContext, role: string, varietySeed = '') {
  return pickProjectAnchor(extractResumeProjects(profile, ctx, role), 1, varietySeed);
}
