/**
 * One place that decides how much experience a resume shows and whether the candidate is a fresher.
 *
 * Rules (in order):
 *  1. A real job counts: any employment that is not an internship/apprenticeship. Even three months of
 *     full-time work means the candidate is NOT a fresher.
 *  2. Internships, projects, training and education never count as experience.
 *  3. Months are worked out from the job dates with overlaps merged and gaps left out, so two jobs held at the
 *     same time are not added twice and a career break is not counted as experience.
 *  4. When the resume states its own total ("5+ years of experience") the larger of the stated and the
 *     date-based figure is used: a resume often lists only its latest jobs but states the full career.
 *  5. No real job and nothing stated means fresher.
 */

export type ExperienceJob = {
  jobTitle?: string
  company?: string
  employmentType?: string
  startDate?: string
  endDate?: string
  currentlyWorking?: boolean
  /** Months worked when the resume gives a duration ("2.5 Years") instead of dates. */
  durationMonths?: number
}

export type ExperienceSummary = {
  /** One of the wizard's experience options. */
  label: string
  /** Whole months of professional experience (0 for a fresher). */
  months: number
  isFresher: boolean
  /** Where the figure came from, for debugging and the parse report. */
  source: 'job-dates' | 'stated' | 'section-dates' | 'undated-job' | 'none'
}

export const FRESHER_LABEL = 'Fresher / 0 years'

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/** "May 2026" -> months since year 0; "2022" -> January of that year. Returns null if unreadable. */
export function monthIndex(value: string | undefined, fallbackMonth = 0, now = new Date()): number | null {
  const v = (value || '').trim()
  if (!v) return null
  if (/present|current|ongoing|till|now|today/i.test(v)) return now.getFullYear() * 12 + now.getMonth()
  const year = v.match(/(?:19|20)\d{2}/)
  if (!year) {
    // "08/24" style
    const short = v.match(/^(0?[1-9]|1[0-2])\s*[/.-]\s*(\d{2})$/)
    if (short) return (2000 + Number(short[2])) * 12 + (Number(short[1]) - 1)
    return null
  }
  // "2020-07": what <input type="month"> stores (it used to fall through and count as January).
  const iso = v.match(/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])\b/)
  if (iso) return Number(iso[1]) * 12 + (Number(iso[2]) - 1)
  const numeric = v.match(/\b(0?[1-9]|1[0-2])\s*[/.-]\s*(?:19|20)\d{2}\b/)
  if (numeric) return Number(year[0]) * 12 + (Number(numeric[1]) - 1)
  const month = v.match(/[A-Za-z]{3}/)
  const m = month ? MONTHS[month[0].toLowerCase()] : undefined
  return Number(year[0]) * 12 + (m ?? fallbackMonth)
}

/**
 * A resume date ("Jul 2020", "07/2020", "2020", "2020-07") as the "yyyy-MM" value <input type="month"> needs.
 * The parser keeps dates as written, which the month input silently shows as blank. "Present" or unreadable -> "".
 */
export function toMonthInputValue(value: string | undefined): string {
  const v = (value || '').trim()
  if (!v || /present|current|ongoing|till|now|today/i.test(v)) return ''
  const idx = monthIndex(v)
  if (idx === null) return ''
  const year = Math.floor(idx / 12)
  const month = (idx % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Internships and apprenticeships are training, not employment. */
export function isInternshipRole(job: ExperienceJob): boolean {
  const title = job.jobTitle || ''
  const type = job.employmentType || ''
  return (
    /\bintern(?:ship)?s?\b|\bapprentice(?:ship)?\b|\bsummer\s+trainee\b|\bindustrial\s+training\b/i.test(title) ||
    /\bintern(?:ship)?\b|\bapprentice/i.test(type)
  )
}

/** The job that ended last (a present job wins), for the "current role". */
export function latestJob<T extends ExperienceJob>(works: T[], realOnly = false): T | undefined {
  const nowIdx = new Date().getFullYear() * 12 + new Date().getMonth()
  const endOf = (w: T) =>
    w.currentlyWorking ? nowIdx + 1 : (monthIndex(w.endDate, 11) ?? monthIndex(w.startDate) ?? -1)
  const real = works.filter((w) => w.jobTitle?.trim() && !isInternshipRole(w))
  const pool = real.length || realOnly ? real : works.filter((w) => w.jobTitle?.trim())
  // Listed newest-first or oldest-first: the job that ended last wins; ties keep the order on the page.
  return pool.reduce<T | undefined>((best, w) => (!best || endOf(w) > endOf(best) ? w : best), undefined)
}

type Interval = [number, number]

function jobInterval(job: ExperienceJob, now: Date): Interval | null {
  const nowIdx = now.getFullYear() * 12 + now.getMonth()
  const start = monthIndex(job.startDate, 0, now)
  if (start === null || start > nowIdx) return null
  const rawEnd = job.currentlyWorking ? nowIdx : monthIndex(job.endDate, 11, now)
  const end = Math.min(rawEnd ?? start, nowIdx)
  if (end < start) return null
  return [start, end + 1] // end month is worked too, so the interval is half-open at end + 1
}

function mergedMonths(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let curStart = -1
  let curEnd = -1
  for (const [s, e] of sorted) {
    if (curEnd < 0 || s > curEnd) {
      if (curEnd >= 0) total += curEnd - curStart
      curStart = s
      curEnd = e
    } else {
      curEnd = Math.max(curEnd, e)
    }
  }
  if (curEnd >= 0) total += curEnd - curStart
  return total
}

/**
 * The candidate's own statement: "5+ years of experience", "experience: 3.5 yrs", "2 years' experience".
 * Only counts when the number is attached to the word experience, so "4 year B.Tech" or "3 years of Python
 * coursework" are ignored. Month-only statements ("6 months internship experience") are not a career total.
 */
export function pickStatedMonths(text: string): number | null {
  const t = text.replace(/\s+/g, ' ')
  const num = '(\\d{1,2}(?:\\.\\d+)?)'
  const unit = '(?:years?|yrs?)'
  const patterns: { re: RegExp; pick: (m: RegExpMatchArray) => number }[] = [
    // "3-5 years of experience" / "3 to 5 years experience"
    {
      re: new RegExp(`${num}\\s*(?:\\+|-|–|to)\\s*${num}\\s*\\+?\\s*${unit}\\s*(?:of\\s+|'\\s*)?(?:[a-z-]+\\s+){0,3}experience`, 'i'),
      pick: (m) => ((Number(m[1]) + Number(m[2])) / 2) * 12,
    },
    // "5+ years of (professional/relevant/IT) experience", "2 years experience"
    {
      re: new RegExp(`${num}\\s*\\+?\\s*${unit}(?:\\s*(?:and\\s*)?(\\d{1,2})\\s*months?)?\\s*(?:of\\s+|'\\s*)?(?:[a-z-]+\\s+){0,3}experience`, 'i'),
      pick: (m) => Number(m[1]) * 12 + (m[2] ? Number(m[2]) : 0),
    },
    // "experience of 3 years", "experience: 2.5 yrs", "total experience – 4 years"
    {
      re: new RegExp(`experience\\s*(?:of|[:–-])?\\s*(?:about\\s+|around\\s+|over\\s+)?${num}\\s*\\+?\\s*${unit}`, 'i'),
      pick: (m) => Number(m[1]) * 12,
    },
  ]
  for (const { re, pick } of patterns) {
    const m = t.match(re)
    if (m) {
      const months = pick(m)
      if (Number.isFinite(months) && months >= 0 && months <= 60 * 12) return Math.round(months)
    }
  }
  return null
}

/** Date ranges ("Jan 2021 – Mar 2023", "2019 - Present", "08/2020 – 11/2021") found in a block of text. */
export function dateRangesIn(text: string, now = new Date()): Interval[] {
  const mon = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
  const point = `(?:${mon}[a-z]*[\\s,.']*(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])\\s*[/.]\\s*(?:19|20)\\d{2}|(?:19|20)\\d{2})`
  const re = new RegExp(`(${point})\\s*(?:-|–|—|to|until|till)\\s*(${point}|present|current|ongoing|till\\s*date|now|today)`, 'gi')
  const out: Interval[] = []
  for (const m of text.matchAll(re)) {
    const iv = jobInterval(
      { startDate: m[1], endDate: m[2], currentlyWorking: /present|current|ongoing|till|now|today/i.test(m[2]) },
      now,
    )
    if (iv) out.push(iv)
  }
  return out
}

/** The experience ranges the resume parser produces; forms that edit `totalExperience` must offer exactly these. */
export const EXPERIENCE_RANGE_LABELS = [
  'Fresher / 0 years',
  '0 – 1 Years',
  '1 – 2 Years',
  '2 – 3 Years',
  '3 – 5 Years',
  '5 – 8 Years',
  '8 – 12 Years',
  '12+ Years',
] as const

export function monthsToLabel(months: number): string {
  const years = months / 12
  if (years <= 1) return '0 – 1 Years'
  if (years <= 2) return '1 – 2 Years'
  if (years <= 3) return '2 – 3 Years'
  if (years <= 5) return '3 – 5 Years'
  if (years <= 8) return '5 – 8 Years'
  if (years <= 12) return '8 – 12 Years'
  return '12+ Years'
}

/**
 * @param jobs the parsed work history
 * @param text the whole resume text (for a stated total)
 * @param experienceSection the text of the experience section, so dates can still be read when the jobs could not
 */
export function computeExperience(
  jobs: ExperienceJob[],
  text: string,
  experienceSection = '',
  now = new Date(),
): ExperienceSummary {
  const real = jobs.filter((j) => (j.company?.trim() || j.jobTitle?.trim()) && !isInternshipRole(j))
  const stated = pickStatedMonths(text)

  if (real.length > 0) {
    const intervals = real.map((j) => jobInterval(j, now)).filter((x): x is Interval => x !== null)
    // a job given only as a duration ("2.5 Years") adds its months; it has no place on the timeline
    const undatedMonths = real.reduce((sum, j) => (jobInterval(j, now) ? sum : sum + (j.durationMonths ?? 0)), 0)
    const dated = mergedMonths(intervals) + undatedMonths
    if (dated > 0 || (stated ?? 0) > 0) {
      const months = Math.max(dated, stated ?? 0)
      return { label: monthsToLabel(months), months, isFresher: false, source: dated >= (stated ?? 0) ? 'job-dates' : 'stated' }
    }
    // A real job with no readable dates is still real work: never call that candidate a fresher.
    return { label: monthsToLabel(6), months: 0, isFresher: false, source: 'undated-job' }
  }

  // No job could be read. Before calling someone a fresher, see whether the experience section carries
  // date ranges of its own (a layout the job reader could not split) — unless it is only internships.
  if (experienceSection.trim() && !/\bintern(?:ship)?s?\b|\bapprentice|\btrainee\b|\bindustrial\s+training\b/i.test(experienceSection)) {
    const months = mergedMonths(dateRangesIn(experienceSection, now))
    if (months > 0) {
      const total = Math.max(months, stated ?? 0)
      return { label: monthsToLabel(total), months: total, isFresher: false, source: 'section-dates' }
    }
  }

  if (stated !== null && stated > 0) {
    return { label: monthsToLabel(stated), months: stated, isFresher: false, source: 'stated' }
  }
  return { label: FRESHER_LABEL, months: 0, isFresher: true, source: 'none' }
}

/** "8 – 12 Years" -> [8, 12]; "12+ Years" -> [12, 60]; anything else -> null. */
function bandBounds(band: string): [number, number] | null {
  const range = band.match(/(\d+(?:\.\d+)?)\s*(?:–|-|to)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/i)
  if (range) return [Number(range[1]), Number(range[2])]
  const plus = band.match(/(\d+(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)/i)
  return plus ? [Number(plus[1]), 60] : null
}

/** The experience section of saved resume text (work history dates only, never education years). */
function experienceSectionOf(text: string): string {
  const m = text.match(
    /(?:^|\n)\s*(?:work\s+experience|professional\s+experience|employment(?:\s+history)?|work\s+history|experience)\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:education|skills|technical\s+skills|projects|certifications?|achievements?|awards?|internships?|tools|languages?|references|declaration)\b|$)/i,
  )
  return m?.[1] ?? ''
}

/**
 * The candidate's real years inside an experience band ("8 – 12 Years" + a resume showing 9 years -> 9), so a card
 * shows "9 yrs" instead of the band's lower bound. Uses the job dates of the experience section and the resume's own
 * "N years of experience"; null when neither gives a figure inside the band.
 */
export function yearsWithinBand(band: string | undefined, resumeText: string | undefined, now = new Date()): number | null {
  const bounds = bandBounds(String(band ?? ''))
  const text = String(resumeText ?? '')
  if (!bounds || !text.trim()) return null
  const section = experienceSectionOf(text)
  const dated = section ? mergedMonths(dateRangesIn(section, now)) : 0
  const stated = pickStatedMonths(text) ?? 0
  const years = Math.floor(Math.max(dated, stated) / 12)
  const [lo, hi] = bounds
  return years >= lo && years <= hi ? years : null
}
