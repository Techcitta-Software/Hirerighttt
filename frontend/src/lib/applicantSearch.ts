/**
 * Applicants page (vendor side): resume-database style search over the organisation's candidate list.
 *
 * Everything here is pure and runs on the list the page already loaded from GET /api/vendor/candidates (plus the
 * per-job ranking from GET /api/vendor/jobs/:id/applicants). It only reads the scores, ranks and names the API
 * sends; it never recomputes them.
 *
 * Keyword syntax (familiar from resume databases):
 *   react typescript        both words must appear (AND is implied)
 *   react AND typescript    same
 *   react OR vue            either word
 *   "design system"         exact phrase
 *   react, node             commas separate keywords like spaces do
 *   -angular                leave out resumes that mention a word
 */
import { candidateScore, needsIntegrityReview } from './candidateSearch'
import { hasResumeContent } from './employerCandidateUtils'
import { compareTopCandidature, roleSkillsFitOf } from './jobApplicantFilters'
import type { EmployerApplicant } from './store'

/* ─────────────────────────── Query parsing ─────────────────────────── */

/**
 * `clauses`: AND of clauses, each an OR of alternatives (words or quoted phrases), all lower-case.
 * `exclude`: words / phrases that must not appear anywhere on the applicant.
 */
export type KeywordQuery = { clauses: string[][]; exclude: string[] }

export function parseKeywordQuery(input: string): KeywordQuery {
  const tokens: { text: string; quoted: boolean }[] = []
  const exclude: string[] = []
  const re = /(-?)"([^"]*)"|([^\s,;"]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    if (m[2] !== undefined) {
      const phrase = m[2].trim().toLowerCase().replace(/\s+/g, ' ')
      if (phrase && m[1]) exclude.push(phrase)
      else if (phrase) tokens.push({ text: phrase, quoted: true })
    } else if (m[3]) {
      if (m[3].length > 1 && m[3].startsWith('-')) exclude.push(m[3].slice(1).toLowerCase())
      else tokens.push({ text: m[3], quoted: false })
    }
  }
  const clauses: string[][] = []
  let joinNext = false
  for (const t of tokens) {
    const op = t.quoted ? '' : t.text.toUpperCase()
    if (op === 'OR' || op === '|') {
      if (clauses.length) joinNext = true
      continue
    }
    if (op === 'AND' || op === '&') {
      joinNext = false
      continue
    }
    const term = t.quoted ? t.text : t.text.toLowerCase()
    if (joinNext && clauses.length) clauses[clauses.length - 1].push(term)
    else clauses.push([term])
    joinNext = false
  }
  // Drop duplicate alternatives inside a clause.
  return { clauses: clauses.map((c) => Array.from(new Set(c))), exclude: Array.from(new Set(exclude)) }
}

export function isEmptyQuery(q: KeywordQuery): boolean {
  return q.clauses.length === 0 && q.exclude.length === 0
}

/** Every searched term (for highlighting). Longest first so phrases win over their own words. */
export function queryTerms(query: KeywordQuery): string[] {
  return Array.from(new Set(query.clauses.flat())).sort((a, b) => b.length - a.length)
}

/** Splits text into highlighted / plain parts for the given terms (case-insensitive). */
export function highlightParts(text: string, terms: string[]): { text: string; match: boolean }[] {
  const usable = terms.filter((t) => t.length > 0)
  if (!text || !usable.length) return [{ text, match: false }]
  const pattern = usable.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const splitter = new RegExp(`(${pattern})`, 'gi')
  const exact = new RegExp(`^(?:${pattern})$`, 'i')
  return text
    .split(splitter)
    .filter((p) => p !== '')
    .map((p) => ({ text: p, match: exact.test(p) }))
}

/* ─────────────────────────── Derived fields ─────────────────────────── */

const SECTION_HEADING = /^\s*(?:[A-Z][A-Z &/]{2,40}|[A-Za-z][A-Za-z &/]{2,40}:)\s*$/

/** Lines under a resume heading (e.g. "SKILLS", "Education:"), until the next heading. Empty when absent. */
function resumeSection(resumeText: string | undefined, heading: RegExp, maxLines = 4): string[] {
  if (!resumeText) return []
  const lines = resumeText.split(/\r?\n/)
  const start = lines.findIndex((l) => heading.test(l.trim()))
  if (start === -1) return []
  const out: string[] = []
  // "Skills: React, Node" on the heading line itself.
  const inline = lines[start].split(':').slice(1).join(':').trim()
  if (inline) out.push(inline)
  for (let i = start + 1; i < lines.length && out.length < maxLines; i += 1) {
    const line = lines[i].trim()
    if (!line) {
      if (out.length) break
      continue
    }
    if (SECTION_HEADING.test(line) && !/[,|•]/.test(line)) break
    out.push(line)
  }
  return out
}

const SKILLS_HEADING = /^(?:key\s+|technical\s+|core\s+)?skills(?:\s*(?:&|and)\s*tools)?\s*:?(?:\s|$)/i
const EDUCATION_HEADING = /^(?:education|academic(?:s| qualifications?)?|qualifications?)\s*:?(?:\s|$)/i

/** Skills listed on the resume (its Skills section), as written. */
export function resumeSkills(resumeText: string | undefined): string[] {
  const raw = resumeSection(resumeText, SKILLS_HEADING, 4)
    .join(',')
    .split(/[,|•·;]/)
    .map((s) => s.replace(/^[-*\s]+/, '').trim())
    .filter((s) => s.length > 1 && s.length <= 32 && !/^\d+$/.test(s))
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of raw) {
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= 15) break
  }
  return out
}

/** First line of the resume's Education section, when it has one. */
export type ResumeHeadline = { title: string; company: string; location: string }

const NO_HEADLINE: ResumeHeadline = { title: '', company: '', location: '' }
const SECTION_WORD = /^(summary|profile|experience|education|skills|projects|objective|contact)\b/i

/**
 * Current title, company and location from the resume's headline line, the line under the name such as
 * "Senior Software Engineer at Flipside Tech | Bengaluru" or "Frontend Developer | Chennai, India | me@x.com".
 * Only what the resume says: anything that does not look like a headline gives empty fields (never a guess).
 */
export function resumeHeadline(resumeText: string | undefined): ResumeHeadline {
  const lines = String(resumeText ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
  const line = lines.slice(1).find((l) => !SECTION_WORD.test(l) && (l.includes('|') || /\s(at|@)\s/i.test(l)))
  if (!line || line.length > 200) return NO_HEADLINE
  const parts = line
    .split(/\s*[|•·]\s*/)
    .map((p) => p.trim())
    .filter((p) => p && !/@|https?:|www\.|\d{5,}|\+\d/.test(p.replace(/\s/g, '')))
  if (!parts.length) return NO_HEADLINE
  const [first, ...rest] = parts
  const m = first.match(/^(.{2,80}?)\s+(?:at|@)\s+(.{2,80})$/i)
  const title = (m ? m[1] : first).trim()
  const company = m ? m[2].trim() : ''
  if (title.length > 80 || /\d{4}/.test(title)) return NO_HEADLINE
  const location = rest.find((p) => /^[A-Za-z][A-Za-z .,'/()-]{1,60}$/.test(p)) ?? ''
  return { title, company, location }
}

export function resumeEducation(resumeText: string | undefined): string {
  const line = resumeSection(resumeText, EDUCATION_HEADING, 1)[0] || ''
  return line.replace(/^[-*•\s]+/, '').slice(0, 140)
}

/** Sources where the application's `primarySkills` are the JOB's skills, not the candidate's. */
const JOB_SKILL_SOURCES = new Set(['application', 'interview_report'])

/**
 * The candidate's own skills: skills the ATS check found on the resume, the resume's Skills section, and (for
 * profile / vault rows) the skills on their profile. An application's `primarySkills` are the job's, so they are not
 * used for application rows.
 */
export function applicantSkills(a: EmployerApplicant): string[] {
  const fromJobSource = !a.recordSource || JOB_SKILL_SOURCES.has(a.recordSource)
  const lists: (string[] | undefined)[] = [
    a.matchedSkills,
    a.interviewResult?.roleSkillsAnalysis?.onResume,
    resumeSkills(a.resumeText),
    fromJobSource ? undefined : a.primarySkills,
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const s of list || []) {
      const name = String(s || '').trim()
      const key = name.toLowerCase()
      if (!name || seen.has(key)) continue
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

/** Years of experience as a number ("3-5 years" → 3, "6+ yrs" → 6, "2.5" → 2.5); null when unknown. */
export function experienceYearsOf(a: Pick<EmployerApplicant, 'experienceYears'> & { resumeText?: string }): number | null {
  const m = String(a.experienceYears ?? '').match(/\d+(?:\.\d+)?/)
  if (m) return Number(m[0])
  // No experience on the application: the resume's own "6 years of experience" / "6+ yrs experience", never a guess.
  const r = String(a.resumeText ?? '').match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,20}?\bexperience/i)
  return r ? Number(r[1]) : null
}

/** Every job of this organisation the applicant applied to (one row per person, even with several applications). */
export function jobIdsOf(a: Pick<EmployerApplicant, 'jobId' | 'appliedJobIds'>): string[] {
  if (a.appliedJobIds?.length) return a.appliedJobIds
  return a.jobId ? [a.jobId] : []
}

/** Camera / integrity flags raised during the interview (proctoring summary, else face violations). */
export function proctorFlagCount(a: Pick<EmployerApplicant, 'interviewResult'>): number {
  const integrity = a.interviewResult?.integrity
  const total = integrity?.proctoring?.counts?.total
  if (typeof total === 'number') return total
  return integrity?.faceViolations ?? 0
}

/** Last activity we know of: the interview completion, else the application / profile update date. */
export function lastActiveAt(a: Pick<EmployerApplicant, 'interviewCompletedAt' | 'appliedAt' | 'interviewResult'>): string {
  const dates = [a.interviewCompletedAt, a.appliedAt, a.interviewResult?.date].filter(
    (d): d is string => Boolean(d) && !Number.isNaN(new Date(String(d)).getTime()),
  )
  return dates.sort().at(-1) || ''
}

export type InterviewStatus = 'completed' | 'not_interviewed'
export function interviewStatusOf(a: Pick<EmployerApplicant, 'aiScore' | 'interviewResult'>): InterviewStatus {
  return a.interviewResult || candidateScore(a) !== null ? 'completed' : 'not_interviewed'
}

/** Shortlist and Save for later are different lists; the same words are used on rows, the drawer, the bulk bar and filters. */
export const SHORTLIST_HINT = 'Shortlist moves the applicant forward on the job (their application status changes).'
export const SAVE_HINT = 'Save for later is your private list on this device. The applicant is not told and nothing changes on the job.'

/** How the row reached this organisation, in recruiter words. */
export function sourceLabel(source: string | undefined): string {
  switch (source) {
    case 'application':
      return 'Applied to your job'
    case 'interview':
    case 'interview_report':
      return 'Shared an interview'
    case 'vault':
      return 'Candidates'
    case 'talent':
    case 'platform':
      return 'HireRighttt talent pool'
    default:
      return 'Other'
  }
}

/* ─────────────────────────── Filters ─────────────────────────── */

export type ScoreBucket = '80+' | '60-79' | '40-59' | '<40'
/** Same cut-offs as the score buckets, so the two filter groups read the same way. */
export type FitBucket = '80+' | '60-79' | '40-59' | '<40'
export type ActiveWithin = 0 | 7 | 15 | 30 | 90
export type ResumeFilter = '' | 'yes' | 'no'

/**
 * Candidates experience radios. Adjacent buckets share an edge: the lower bound is inclusive and the upper bound
 * is exclusive, so 2.5 and 5.5 years each land in exactly one bucket. 8+ is `>= 8`.
 */
export const CANDIDATE_EXPERIENCE_PRESETS: { id: string; label: string; min: string; max: string }[] = [
  { id: '0-1', label: '0–1 yr', min: '0', max: '1' },
  { id: '1-3', label: '1–3 yrs', min: '1', max: '3' },
  { id: '3-5', label: '3–5 yrs', min: '3', max: '5' },
  { id: '5-8', label: '5–8 yrs', min: '5', max: '8' },
  { id: '8+', label: '8+ yrs', min: '8', max: '' },
]

/** `'any'` when both bounds are empty; a preset id when the bounds match one; null for a custom top-bar range. */
export function experiencePresetId(expMin: string, expMax: string): string | null {
  const min = expMin.trim()
  const max = expMax.trim()
  if (min === '' && max === '') return 'any'
  return CANDIDATE_EXPERIENCE_PRESETS.find((p) => p.min === min && p.max === max)?.id ?? null
}

/** Cities offered on the candidates rail, in display order. Matched on resume text and role, with word boundaries. */
const CANDIDATE_CITIES: { value: string; pattern: RegExp }[] = [
  { value: 'Bengaluru', pattern: /\b(?:bengaluru|bangalore)\b/i },
  { value: 'Hyderabad', pattern: /\bhyderabad\b/i },
  { value: 'Chennai', pattern: /\bchennai\b/i },
  { value: 'Pune', pattern: /\bpune\b/i },
  { value: 'Mumbai', pattern: /\bmumbai\b/i },
  { value: 'Delhi NCR', pattern: /\b(?:delhi|gurgaon|gurugram|noida)\b/i },
  { value: 'Kolkata', pattern: /\bkolkata\b/i },
]

function citiesMentioned(resumeText: string | undefined, role: string | undefined): string[] {
  const text = `${resumeText ?? ''}\n${role ?? ''}`
  if (!text.trim()) return []
  return CANDIDATE_CITIES.filter((c) => c.pattern.test(text)).map((c) => c.value)
}

function canonicalCities(values: string[]): string[] {
  const out: string[] = []
  for (const raw of values) {
    const hit = CANDIDATE_CITIES.find((c) => c.value.toLowerCase() === raw.trim().toLowerCase())
    if (hit && !out.includes(hit.value)) out.push(hit.value)
  }
  return out
}

export type ApplicantFilters = {
  keywords: string
  /** Free text matched against the resume and role (the API has no separate location field). */
  location: string
  expMin: string
  expMax: string
  jobs: string[]
  interview: InterviewStatus[]
  score: ScoreBucket[]
  fit: FitBucket[]
  skills: string[]
  /** Current-role checkboxes (any of). Values are trimmed lower-case role text. */
  roles: string[]
  /** City checkboxes (any of). Canonical names from the candidates location list. */
  cities: string[]
  /** Resume radio. Empty means any. */
  resume: ResumeFilter
  sources: string[]
  activeWithin: ActiveWithin
  integrityReviewOnly: boolean
  savedOnly: boolean
  shortlistedOnly: boolean
}

export const EMPTY_APPLICANT_FILTERS: ApplicantFilters = {
  keywords: '',
  location: '',
  expMin: '',
  expMax: '',
  jobs: [],
  interview: [],
  score: [],
  fit: [],
  skills: [],
  roles: [],
  cities: [],
  resume: '',
  sources: [],
  activeWithin: 0,
  integrityReviewOnly: false,
  savedOnly: false,
  shortlistedOnly: false,
}

/** Candidates mode drops these so a stale applicants link cannot filter the resume database with no control for it. */
export function stripCandidateIgnoredFilters(filters: ApplicantFilters): ApplicantFilters {
  return {
    ...filters,
    jobs: [],
    fit: [],
    sources: [],
    integrityReviewOnly: false,
    savedOnly: false,
    shortlistedOnly: false,
  }
}

/**
 * Filters actually applied by ApplicantsSearch.
 * Applications keeps the job scope plus the search card. Candidates drops the rail groups that page does not show.
 */
export function filtersForApplicantSearch(
  mode: 'candidates' | 'applications',
  filters: ApplicantFilters,
): ApplicantFilters {
  if (mode === 'applications') {
    return {
      ...EMPTY_APPLICANT_FILTERS,
      keywords: filters.keywords,
      location: filters.location,
      expMin: filters.expMin,
      expMax: filters.expMax,
      jobs: filters.jobs,
    }
  }
  return stripCandidateIgnoredFilters(filters)
}

export type InterviewRadio = 'any' | 'interviewed' | '80' | '60' | 'not'

/** Which candidates Interview radio matches the current interview + score filters. Null when the combo is custom. */
export function interviewRadioOf(f: Pick<ApplicantFilters, 'interview' | 'score'>): InterviewRadio | null {
  const noScore = f.score.length === 0
  const noInterview = f.interview.length === 0
  if (noInterview && noScore) return 'any'
  if (noScore && f.interview.length === 1 && f.interview[0] === 'completed') return 'interviewed'
  if (noInterview && f.score.length === 1 && f.score[0] === '80+') return '80'
  if (noInterview && f.score.length === 2 && f.score.includes('80+') && f.score.includes('60-79')) return '60'
  if (noScore && f.interview.length === 1 && f.interview[0] === 'not_interviewed') return 'not'
  return null
}

export function filtersForInterviewRadio(value: InterviewRadio): Pick<ApplicantFilters, 'interview' | 'score'> {
  switch (value) {
    case 'any':
      return { interview: [], score: [] }
    case 'interviewed':
      return { interview: ['completed'], score: [] }
    case '80':
      return { interview: [], score: ['80+'] }
    case '60':
      return { interview: [], score: ['80+', '60-79'] }
    case 'not':
      return { interview: ['not_interviewed'], score: [] }
  }
}

export type ApplicantSort = 'relevance' | 'score' | 'fit' | 'recent' | 'experience'

export const SORT_LABELS: Record<ApplicantSort, string> = {
  relevance: 'Relevance',
  score: 'Interview score',
  fit: 'Skills fit',
  recent: 'Recently active',
  experience: 'Experience',
}

export function scoreBucketOf(score: number | null): ScoreBucket | null {
  if (score === null) return null
  if (score >= 80) return '80+'
  if (score >= 60) return '60-79'
  if (score >= 40) return '40-59'
  return '<40'
}

export function fitBucketOf(fit: number | null): FitBucket | null {
  if (fit === null) return null
  if (fit >= 80) return '80+'
  if (fit >= 60) return '60-79'
  if (fit >= 40) return '40-59'
  return '<40'
}

/** Everything the search needs about one applicant, computed once per list. */
export type IndexedApplicant = {
  applicant: EmployerApplicant
  skills: string[]
  skillKeys: Set<string>
  experience: number | null
  score: number | null
  fit: number | null
  flags: number
  review: boolean
  lastActive: string
  interview: InterviewStatus
  education: string
  /** Title / company / location from the resume headline line (empty when the resume has none). */
  headline: ResumeHeadline
  /** Trimmed lower-case role (applicant.role, else the headline title). Empty when neither exists. */
  roleKey: string
  /** First spelling of that role on this person. */
  roleLabel: string
  /** Canonical cities mentioned in the resume or role. */
  cities: string[]
  hasResume: boolean
  /** Lower-case search fields. */
  fields: { name: string; role: string; skills: string; job: string; contact: string; resume: string }
}

const lc = (v: unknown) => String(v ?? '').toLowerCase()

export function indexApplicant(a: EmployerApplicant): IndexedApplicant {
  const skills = applicantSkills(a)
  const headline = resumeHeadline(a.resumeText)
  const roleLabel = (a.role ?? '').trim() || headline.title.trim()
  return {
    applicant: a,
    skills,
    skillKeys: new Set(skills.map((s) => s.toLowerCase())),
    experience: experienceYearsOf(a),
    score: candidateScore(a),
    fit: roleSkillsFitOf(a),
    flags: proctorFlagCount(a),
    review: needsIntegrityReview(a),
    lastActive: lastActiveAt(a),
    interview: interviewStatusOf(a),
    education: resumeEducation(a.resumeText),
    headline,
    roleKey: roleLabel.toLowerCase(),
    roleLabel,
    cities: citiesMentioned(a.resumeText, roleLabel),
    hasResume: hasResumeContent(a),
    fields: {
      name: lc(a.candidateName),
      role: lc(a.role),
      skills: lc(skills.join(' | ')),
      job: `${lc(a.jobTitle)} ${lc(a.company)}`,
      contact: `${lc(a.candidateEmail)} ${lc(a.candidatePhone)}`,
      resume: lc(a.resumeText),
    },
  }
}

const TERM_WEIGHTS = { name: 10, role: 6, skills: 6, job: 4, contact: 8, resume: 1 } as const

/** 0 when a clause is not satisfied; otherwise a relevance score (higher = stronger match). */
export function keywordMatchScore(row: IndexedApplicant, query: KeywordQuery): number {
  const f0 = row.fields
  for (const ex of query.exclude) {
    if (f0.name.includes(ex) || f0.role.includes(ex) || f0.skills.includes(ex) || f0.job.includes(ex) || f0.resume.includes(ex)) {
      return 0
    }
  }
  if (!query.clauses.length) return 1
  let total = 0
  for (const clause of query.clauses) {
    let best = 0
    for (const term of clause) {
      const f = row.fields
      if (f.name.includes(term)) best = Math.max(best, TERM_WEIGHTS.name)
      if (f.contact.includes(term)) best = Math.max(best, TERM_WEIGHTS.contact)
      if (f.role.includes(term)) best = Math.max(best, TERM_WEIGHTS.role)
      if (f.skills.includes(term)) best = Math.max(best, TERM_WEIGHTS.skills)
      if (f.job.includes(term)) best = Math.max(best, TERM_WEIGHTS.job)
      if (f.resume.includes(term)) {
        const hits = f.resume.split(term).length - 1
        best = Math.max(best, TERM_WEIGHTS.resume + Math.min(4, hits - 1))
      }
    }
    if (best === 0) return 0
    total += best
  }
  return total
}

function daysSince(iso: string, now: number): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : (now - t) / 86_400_000
}

/** Which filter group a check belongs to; facet counts ignore their own group (standard faceted search). */
type Group = 'base' | 'jobs' | 'interview' | 'score' | 'fit' | 'skills' | 'sources' | 'active' | 'roles' | 'cities' | 'resume'

/** Preset radios use [min, max). Any other min/max (the top bar) stays inclusive on both ends. */
function matchesExperience(years: number | null, expMin: string, expMax: string): boolean {
  const minRaw = expMin.trim()
  const maxRaw = expMax.trim()
  const min = minRaw === '' ? null : Number(minRaw)
  const max = maxRaw === '' ? null : Number(maxRaw)
  const hasMin = min !== null && Number.isFinite(min)
  const hasMax = max !== null && Number.isFinite(max)
  if (!hasMin && !hasMax) return true
  if (years === null) return false
  const preset = CANDIDATE_EXPERIENCE_PRESETS.some((p) => p.min === minRaw && p.max === maxRaw)
  if (hasMin && years < (min as number)) return false
  if (preset) {
    if (hasMax && years >= (max as number)) return false
  } else if (hasMax && years > (max as number)) {
    return false
  }
  return true
}

function passes(
  row: IndexedApplicant,
  f: ApplicantFilters,
  ctx: { query: KeywordQuery; saved: ReadonlySet<string>; now: number },
  skip?: Group,
): boolean {
  const a = row.applicant
  if (skip !== 'base') {
    const loc = f.location.trim().toLowerCase()
    if (loc && !row.fields.resume.includes(loc) && !row.fields.role.includes(loc) && !row.fields.job.includes(loc)) {
      return false
    }
    if (!matchesExperience(row.experience, f.expMin, f.expMax)) return false
    if (f.integrityReviewOnly && !row.review) return false
    if (f.savedOnly && !ctx.saved.has(a.id)) return false
    if (f.shortlistedOnly && a.status !== 'Shortlisted') return false
    if (keywordMatchScore(row, ctx.query) === 0) return false
  }
  if (skip !== 'jobs' && f.jobs.length && !jobIdsOf(a).some((id) => f.jobs.includes(id))) return false
  if (skip !== 'interview' && f.interview.length && !f.interview.includes(row.interview)) return false
  if (skip !== 'score' && f.score.length) {
    const b = scoreBucketOf(row.score)
    if (!b || !f.score.includes(b)) return false
  }
  if (skip !== 'fit' && f.fit.length) {
    const b = fitBucketOf(row.fit)
    if (!b || !f.fit.includes(b)) return false
  }
  if (skip !== 'skills' && f.skills.length && !f.skills.every((s) => row.skillKeys.has(s.toLowerCase()))) return false
  if (skip !== 'roles' && f.roles.length) {
    const wanted = new Set(f.roles.map((r) => r.trim().toLowerCase()).filter(Boolean))
    if (!row.roleKey || !wanted.has(row.roleKey)) return false
  }
  if (skip !== 'cities' && f.cities.length && !row.cities.some((c) => f.cities.includes(c))) return false
  if (skip !== 'resume' && f.resume === 'yes' && !row.hasResume) return false
  if (skip !== 'resume' && f.resume === 'no' && row.hasResume) return false
  if (skip !== 'sources' && f.sources.length && !f.sources.includes(row.applicant.recordSource || '')) return false
  if (skip !== 'active' && f.activeWithin > 0 && daysSince(row.lastActive, ctx.now) > f.activeWithin) return false
  return true
}

export type FacetCount = { value: string; label: string; count: number }

export type ApplicantFacets = {
  jobs: FacetCount[]
  interview: FacetCount[]
  score: FacetCount[]
  fit: FacetCount[]
  skills: FacetCount[]
  roles: FacetCount[]
  cities: FacetCount[]
  resume: FacetCount[]
  /** Counts for the candidates Interview radio, with interview and score filters cleared. */
  interviewChoices: { interviewed: number; score80: number; score60: number; notInterviewed: number }
  sources: FacetCount[]
  active: FacetCount[]
  /** Counts for "Has proctoring flags", "Shortlisted" and "Saved for later". */
  lists: { review: number; shortlisted: number; saved: number }
}

export type ApplicantSearchResult = {
  rows: IndexedApplicant[]
  facets: ApplicantFacets
  terms: string[]
}

/**
 * The platform's top-candidature order (interview score, Role Skills Fit, …). A rank is per job, so ranks are only
 * compared between applicants of the same job; across jobs the same rule runs on the scores alone.
 */
function topOrder(x: EmployerApplicant, y: EmployerApplicant): number {
  if (x.jobId && x.jobId === y.jobId) return compareTopCandidature(x, y)
  return compareTopCandidature({ ...x, rank: null }, { ...y, rank: null })
}

function compareRows(sort: ApplicantSort, hasQuery: boolean, rel: Map<IndexedApplicant, number>) {
  const byRecent = (x: IndexedApplicant, y: IndexedApplicant) => y.lastActive.localeCompare(x.lastActive)
  return (x: IndexedApplicant, y: IndexedApplicant): number => {
    switch (sort) {
      case 'score':
        return (y.score ?? -1) - (x.score ?? -1) || topOrder(x.applicant, y.applicant) || byRecent(x, y)
      case 'fit':
        return (y.fit ?? -1) - (x.fit ?? -1) || (y.score ?? -1) - (x.score ?? -1) || byRecent(x, y)
      case 'recent':
        return byRecent(x, y)
      case 'experience':
        return (y.experience ?? -1) - (x.experience ?? -1) || byRecent(x, y)
      default:
        // Relevance: keyword strength first when searching, then the platform's own ranking order
        // (interview score, Role Skills Fit, rank), then the most recent.
        return (
          (hasQuery ? (rel.get(y) ?? 0) - (rel.get(x) ?? 0) : 0) ||
          topOrder(x.applicant, y.applicant) ||
          byRecent(x, y)
        )
    }
  }
}

const SCORE_LABELS: Record<ScoreBucket, string> = { '80+': '80 – 100', '60-79': '60 – 79', '40-59': '40 – 59', '<40': 'Below 40' }
const FIT_LABELS: Record<FitBucket, string> = { '80+': '80 – 100%', '60-79': '60 – 79%', '40-59': '40 – 59%', '<40': 'Below 40%' }

export function searchApplicants(
  rows: IndexedApplicant[],
  filters: ApplicantFilters,
  sort: ApplicantSort,
  opts: { saved?: ReadonlySet<string>; now?: number; jobTitles?: Record<string, string> } = {},
): ApplicantSearchResult {
  const query = parseKeywordQuery(filters.keywords)
  const ctx = { query, saved: opts.saved ?? new Set<string>(), now: opts.now ?? Date.now() }

  const matched = rows.filter((r) => passes(r, filters, ctx))
  const rel = new Map<IndexedApplicant, number>()
  const hasQuery = query.clauses.length > 0
  if (hasQuery) for (const r of matched) rel.set(r, keywordMatchScore(r, query))
  matched.sort(compareRows(sort, hasQuery, rel))

  // Facet counts: rows passing every filter except the facet's own group.
  const pool = (g: Group) => rows.filter((r) => passes(r, filters, ctx, g))
  const tally = <K extends string>(list: IndexedApplicant[], keyOf: (r: IndexedApplicant) => K | K[] | null) => {
    const m = new Map<K, number>()
    for (const r of list) {
      const k = keyOf(r)
      for (const key of Array.isArray(k) ? k : k === null ? [] : [k]) m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }

  const jobCounts = tally(pool('jobs'), (r) => jobIdsOf(r.applicant))
  const jobTitles: Record<string, string> = { ...(opts.jobTitles ?? {}) }
  for (const r of rows) if (r.applicant.jobId && !jobTitles[r.applicant.jobId]) jobTitles[r.applicant.jobId] = r.applicant.jobTitle
  const jobs = Array.from(new Set([...Object.keys(jobTitles), ...filters.jobs]))
    .filter(Boolean)
    .map((id) => ({ value: id, label: jobTitles[id] || 'Job', count: jobCounts.get(id) ?? 0 }))
    // A stable order: options must not jump around when a count changes.
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))

  const ic = tally(pool('interview'), (r) => r.interview)
  const interview: FacetCount[] = [
    { value: 'completed', label: 'Interview completed', count: ic.get('completed') ?? 0 },
    { value: 'not_interviewed', label: 'Not interviewed yet', count: ic.get('not_interviewed') ?? 0 },
  ]

  const sc = tally(pool('score'), (r) => scoreBucketOf(r.score))
  const score = (Object.keys(SCORE_LABELS) as ScoreBucket[]).map((b) => ({ value: b, label: SCORE_LABELS[b], count: sc.get(b) ?? 0 }))

  const fc = tally(pool('fit'), (r) => fitBucketOf(r.fit))
  const fit = (Object.keys(FIT_LABELS) as FitBucket[]).map((b) => ({ value: b, label: FIT_LABELS[b], count: fc.get(b) ?? 0 }))

  // Skills: keep the first spelling seen for each skill.
  const skillPool = pool('skills')
  const skillNames = new Map<string, string>()
  for (const r of skillPool) for (const s of r.skills) if (!skillNames.has(s.toLowerCase())) skillNames.set(s.toLowerCase(), s)
  const skc = tally(skillPool, (r) => Array.from(r.skillKeys))
  const skills = Array.from(skc.entries())
    .map(([key, count]) => ({ value: skillNames.get(key) || key, label: skillNames.get(key) || key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  for (const s of filters.skills) {
    if (!skills.some((x) => x.value.toLowerCase() === s.toLowerCase())) skills.unshift({ value: s, label: s, count: 0 })
  }

  const soc = tally(pool('sources'), (r) => r.applicant.recordSource || null)
  const sources = Array.from(soc.entries())
    .map(([value, count]) => ({ value, label: sourceLabel(value), count }))
    .sort((a, b) => b.count - a.count)

  const activePool = pool('active')
  const active = ([7, 15, 30, 90] as const).map((d) => ({
    value: String(d),
    label: `Last ${d} days`,
    count: activePool.filter((r) => daysSince(r.lastActive, ctx.now) <= d).length,
  }))

  // The three on/off filters: how many rows each would leave, with every other filter applied.
  const lists = {
    review: rows.filter((r) => r.review && passes(r, { ...filters, integrityReviewOnly: false }, ctx)).length,
    shortlisted: rows.filter(
      (r) => r.applicant.status === 'Shortlisted' && passes(r, { ...filters, shortlistedOnly: false }, ctx),
    ).length,
    saved: rows.filter((r) => ctx.saved.has(r.applicant.id) && passes(r, { ...filters, savedOnly: false }, ctx)).length,
  }

  const roleLabels = new Map<string, string>()
  for (const r of rows) {
    if (r.roleKey && !roleLabels.has(r.roleKey)) roleLabels.set(r.roleKey, r.roleLabel)
  }
  const rolePool = pool('roles')
  const roleCounts = tally(rolePool, (r) => (r.roleKey ? r.roleKey : null))
  const roles = Array.from(roleCounts.entries())
    .map(([value, count]) => ({ value, label: roleLabels.get(value) || value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  for (const role of filters.roles) {
    const key = role.trim().toLowerCase()
    if (!key || roles.some((x) => x.value === key)) continue
    roles.unshift({ value: key, label: roleLabels.get(key) || role.trim(), count: 0 })
  }

  const cityPool = pool('cities')
  const cityCounts = tally(cityPool, (r) => r.cities)
  const cities = CANDIDATE_CITIES.map((c) => ({
    value: c.value,
    label: c.value,
    count: cityCounts.get(c.value) ?? 0,
  }))

  const resumePool = pool('resume')
  const resumeYes = resumePool.filter((r) => r.hasResume).length
  const resume: FacetCount[] = [
    { value: 'yes', label: 'Has a resume', count: resumeYes },
    { value: 'no', label: 'No resume yet', count: resumePool.length - resumeYes },
  ]

  const interviewPool = rows.filter((r) => passes(r, { ...filters, interview: [], score: [] }, ctx))
  const interviewChoices = {
    interviewed: interviewPool.filter((r) => r.interview === 'completed').length,
    score80: interviewPool.filter((r) => scoreBucketOf(r.score) === '80+').length,
    score60: interviewPool.filter((r) => {
      const bucket = scoreBucketOf(r.score)
      return bucket === '80+' || bucket === '60-79'
    }).length,
    notInterviewed: interviewPool.filter((r) => r.interview === 'not_interviewed').length,
  }

  return {
    rows: matched,
    facets: { jobs, interview, score, fit, skills, roles, cities, resume, interviewChoices, sources, active, lists },
    terms: queryTerms(query),
  }
}

/** Applied-filter chips: one per active value, each with the patch that removes it. */
const INTERVIEW_RADIO_LABEL: Record<Exclude<InterviewRadio, 'any'>, string> = {
  interviewed: 'Interviewed',
  '80': 'Score 80 and above',
  '60': 'Score 60 and above',
  not: 'Not interviewed yet',
}

export function activeFilterChips(
  f: ApplicantFilters,
  labels: { jobs?: Record<string, string>; roles?: Record<string, string> } = {},
): { key: string; label: string; clear: Partial<ApplicantFilters> }[] {
  const chips: { key: string; label: string; clear: Partial<ApplicantFilters> }[] = []
  if (f.keywords.trim()) chips.push({ key: 'kw', label: `Keywords: ${f.keywords.trim()}`, clear: { keywords: '' } })
  if (f.location.trim()) chips.push({ key: 'loc', label: `Location: ${f.location.trim()}`, clear: { location: '' } })
  if (f.expMin.trim() || f.expMax.trim()) {
    const label = f.expMin && f.expMax ? `${f.expMin}–${f.expMax} yrs` : f.expMin ? `${f.expMin}+ yrs` : `Up to ${f.expMax} yrs`
    chips.push({ key: 'exp', label: `Experience: ${label}`, clear: { expMin: '', expMax: '' } })
  }
  for (const id of f.jobs) chips.push({ key: `job-${id}`, label: labels.jobs?.[id] || 'Job', clear: { jobs: f.jobs.filter((j) => j !== id) } })
  const interviewChoice = interviewRadioOf(f)
  if (interviewChoice && interviewChoice !== 'any') {
    chips.push({ key: 'iv', label: INTERVIEW_RADIO_LABEL[interviewChoice], clear: { interview: [], score: [] } })
  } else if (interviewChoice === null) {
    for (const s of f.interview) {
      chips.push({ key: `iv-${s}`, label: s === 'completed' ? 'Interview completed' : 'Not interviewed', clear: { interview: f.interview.filter((x) => x !== s) } })
    }
    for (const b of f.score) chips.push({ key: `sc-${b}`, label: `Score ${SCORE_LABELS[b]}`, clear: { score: f.score.filter((x) => x !== b) } })
  }
  for (const b of f.fit) chips.push({ key: `fit-${b}`, label: `Skills fit ${FIT_LABELS[b]}`, clear: { fit: f.fit.filter((x) => x !== b) } })
  for (const s of f.skills) chips.push({ key: `sk-${s}`, label: s, clear: { skills: f.skills.filter((x) => x !== s) } })
  for (const role of f.roles) {
    const key = role.trim().toLowerCase()
    if (!key) continue
    chips.push({
      key: `role-${key}`,
      label: labels.roles?.[key] || labels.roles?.[role] || role.trim(),
      clear: { roles: f.roles.filter((r) => r.trim().toLowerCase() !== key) },
    })
  }
  for (const city of f.cities) {
    chips.push({ key: `city-${city}`, label: city, clear: { cities: f.cities.filter((c) => c !== city) } })
  }
  if (f.resume === 'yes') chips.push({ key: 'cv', label: 'Has a resume', clear: { resume: '' } })
  if (f.resume === 'no') chips.push({ key: 'cv', label: 'No resume yet', clear: { resume: '' } })
  for (const s of f.sources) chips.push({ key: `src-${s}`, label: sourceLabel(s), clear: { sources: f.sources.filter((x) => x !== s) } })
  if (f.activeWithin) chips.push({ key: 'active', label: `Active in ${f.activeWithin} days`, clear: { activeWithin: 0 } })
  if (f.integrityReviewOnly) chips.push({ key: 'review', label: 'Needs integrity review', clear: { integrityReviewOnly: false } })
  if (f.shortlistedOnly) chips.push({ key: 'short', label: 'Shortlisted', clear: { shortlistedOnly: false } })
  if (f.savedOnly) chips.push({ key: 'saved', label: 'Saved', clear: { savedOnly: false } })
  return chips
}

/** "Showing 1–20 of 134 applicants" (or candidates, on the resume database). */
export function resultRangeLabel(
  page: number,
  pageSize: number,
  total: number,
  noun: 'applicant' | 'candidate' = 'applicant',
): string {
  const plural = `${noun}s`
  if (total === 0) return `No ${plural} found`
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return `Showing ${from}–${to} of ${total} ${total === 1 ? noun : plural}`
}

export function relativeActive(iso: string, now: number): string {
  const t = new Date(iso).getTime()
  if (!iso || Number.isNaN(t)) return ''
  const days = Math.floor((now - t) / 86_400_000)
  if (days <= 0) return 'Active today'
  if (days === 1) return 'Active yesterday'
  if (days < 30) return `Active ${days} days ago`
  return `Active ${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** A line of the resume around the first searched keyword ("…led the React migration…"). */
export function keywordSnippet(text: string | undefined, terms: string[], radius = 70): string {
  if (!text || !terms.length) return ''
  const lower = text.toLowerCase()
  let at = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i !== -1 && (at === -1 || i < at)) at = i
  }
  if (at === -1) return ''
  let start = Math.max(0, at - radius)
  let end = Math.min(text.length, at + radius)
  // Whole words only: move the cut points to the nearest spaces.
  if (start > 0) {
    const space = text.slice(start, at).search(/\s/)
    if (space !== -1) start += space + 1
  }
  if (end < text.length) {
    const tail = text.slice(at, end)
    const space = Math.max(tail.lastIndexOf(' '), tail.lastIndexOf('\n'))
    if (space > 0) end = at + space
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

/** "6 yrs", "1 yr", "<1 yr"; the raw text when it has no number; "" when unknown. */
export function formatExperience(raw: string | undefined): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const n = experienceYearsOf({ experienceYears: text })
  if (n === null) return text
  if (n < 1) return '<1 yr'
  const plus = /\+/.test(text) ? '+' : ''
  return `${Number.isInteger(n) ? n : n.toFixed(1)}${plus} ${n === 1 && !plus ? 'yr' : 'yrs'}`
}

/** The row's experience label: the application's own value, else what the resume states. */
export function experienceLabel(row: Pick<IndexedApplicant, 'applicant' | 'experience'>): string {
  return formatExperience(row.applicant.experienceYears || (row.experience !== null ? `${row.experience}` : ''))
}

/* ─────────────────────────── URL state ─────────────────────────── */

export type PanelTabKey = 'resume' | 'report' | 'contact'

/** Everything that defines the view, as kept in the address bar (reload / share / back-forward reproduce it). */
export type ApplicantsUrlState = {
  filters: ApplicantFilters
  sort: ApplicantSort
  page: number
  applicant: string | null
  tab: PanelTabKey
}

const SORTS: ApplicantSort[] = ['relevance', 'score', 'fit', 'recent', 'experience']
const SCORE_BUCKETS: ScoreBucket[] = ['80+', '60-79', '40-59', '<40']
const FIT_BUCKETS: FitBucket[] = ['80+', '60-79', '40-59', '<40']
const ACTIVE_WINDOWS: ActiveWithin[] = [0, 7, 15, 30, 90]

export function readApplicantsUrl(params: URLSearchParams): ApplicantsUrlState {
  const all = (k: string) => params.getAll(k).filter(Boolean)
  const num = (k: string) => {
    const v = params.get(k) ?? ''
    return v !== '' && Number.isFinite(Number(v)) ? v : ''
  }
  // ?jobId= is the address the application alerts link to.
  const jobs = Array.from(new Set([...all('job'), ...all('jobId')]))
  const sort = params.get('sort') as ApplicantSort
  const active = Number(params.get('active') || 0) as ActiveWithin
  const tab = params.get('tab') as PanelTabKey
  const page = Math.max(1, Math.floor(Number(params.get('page') || 1)) || 1)
  return {
    filters: {
      keywords: params.get('q') ?? '',
      location: params.get('loc') ?? '',
      expMin: num('emin'),
      expMax: num('emax'),
      jobs,
      interview: all('iv').filter((v): v is InterviewStatus => v === 'completed' || v === 'not_interviewed'),
      score: all('score').filter((v): v is ScoreBucket => SCORE_BUCKETS.includes(v as ScoreBucket)),
      fit: all('fit').filter((v): v is FitBucket => FIT_BUCKETS.includes(v as FitBucket)),
      skills: all('skill'),
      roles: Array.from(new Set(all('role').map((r) => r.trim().toLowerCase()).filter(Boolean))),
      cities: canonicalCities(all('city')),
      resume: params.get('cv') === 'yes' || params.get('cv') === 'no' ? (params.get('cv') as ResumeFilter) : '',
      sources: all('src'),
      activeWithin: ACTIVE_WINDOWS.includes(active) ? active : 0,
      integrityReviewOnly: params.get('review') === '1',
      savedOnly: params.get('saved') === '1',
      shortlistedOnly: params.get('short') === '1',
    },
    sort: SORTS.includes(sort) ? sort : 'relevance',
    page,
    applicant: params.get('applicant') || null,
    tab: tab === 'report' || tab === 'contact' ? tab : 'resume',
  }
}

/** Only non-default values are written, so a clean view has a clean address. Unknown params are dropped. */
export function writeApplicantsUrl(state: ApplicantsUrlState): URLSearchParams {
  const p = new URLSearchParams()
  const f = state.filters
  if (f.keywords.trim()) p.set('q', f.keywords)
  if (f.location.trim()) p.set('loc', f.location)
  if (f.expMin !== '') p.set('emin', f.expMin)
  if (f.expMax !== '') p.set('emax', f.expMax)
  f.jobs.forEach((v) => p.append('job', v))
  f.interview.forEach((v) => p.append('iv', v))
  f.score.forEach((v) => p.append('score', v))
  f.fit.forEach((v) => p.append('fit', v))
  f.skills.forEach((v) => p.append('skill', v))
  f.roles.forEach((v) => p.append('role', v))
  f.cities.forEach((v) => p.append('city', v))
  if (f.resume === 'yes' || f.resume === 'no') p.set('cv', f.resume)
  f.sources.forEach((v) => p.append('src', v))
  if (f.activeWithin) p.set('active', String(f.activeWithin))
  if (f.integrityReviewOnly) p.set('review', '1')
  if (f.savedOnly) p.set('saved', '1')
  if (f.shortlistedOnly) p.set('short', '1')
  if (state.sort !== 'relevance') p.set('sort', state.sort)
  if (state.page > 1) p.set('page', String(state.page))
  if (state.applicant) {
    p.set('applicant', state.applicant)
    if (state.tab !== 'resume') p.set('tab', state.tab)
  }
  return p
}

/* ─────────────────────────── CSV export ─────────────────────────── */

function csvCell(value: unknown): string {
  let text = String(value ?? '')
  // Spreadsheet formula injection: a leading = + - @ is made literal.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The rows as CSV. Contact columns carry only what the API returned (hidden contacts stay empty). */
export function applicantsToCsv(rows: IndexedApplicant[]): string {
  const header = [
    'Name',
    'Title',
    'Experience',
    'Applied for',
    'Source',
    'Interview score',
    'Rank',
    'Skills fit',
    'Proctoring flags',
    'Status',
    'Key skills',
    'Email',
    'Phone',
    'Last active',
  ]
  const lines = rows.map((r) => {
    const a = r.applicant
    const visible = Boolean(a.candidateEmail) && !a.contactHidden
    return [
      a.candidateName,
      a.role || '',
      experienceLabel(r),
      a.jobTitle || '',
      sourceLabel(a.recordSource),
      r.score ?? '',
      typeof a.rank === 'number' ? a.rank : '',
      r.fit !== null ? Math.round(r.fit) : '',
      r.interview === 'completed' ? r.flags : '',
      a.status,
      r.skills.join('; '),
      visible ? a.candidateEmail : '',
      visible ? a.candidatePhone : '',
      r.lastActive ? r.lastActive.slice(0, 10) : '',
    ]
      .map(csvCell)
      .join(',')
  })
  return [header.join(','), ...lines].join('\r\n')
}
