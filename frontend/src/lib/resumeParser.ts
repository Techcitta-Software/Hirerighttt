import mammoth from 'mammoth'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  LOCATION_OPTIONS,
  ROLE_OPTIONS,
  SKILL_OPTIONS,
  createEmptyMetric,
  type ProfileFormData,
  type WorkExperience,
  type Certification,
  type PerformanceMetric,
} from '../data/wizard'
import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import { clientLlmAllowed } from './clientLlm'

GlobalWorkerOptions.workerSrc = pdfWorker

const CLIENT_GEMINI_MODEL =
  import.meta.env.VITE_PRIMARY_MODEL || 'gemini-3.1-flash-lite'

export type ResumeExtract = Partial<
  Pick<
    ProfileFormData,
    | 'whoAreYou'
    | 'whatDrivesYou'
    | 'keyStrengths'
    | 'currentRole'
    | 'totalExperience'
    | 'currentLocation'
    | 'skills'
    | 'experienceSummary'
    | 'workExperiences'
    | 'achievements'
    | 'metrics'
    | 'certifications'
  >
> & {
  fullName?: string
  /** Full extracted text used by Ava for resume-accurate questions. */
  resumeText?: string
}

/** Maps parsed resume fields into onboarding profile shape (shared by upload + wizard). */
export function resumeExtractToProfilePatch(
  extract: ResumeExtract,
): Partial<ProfileFormData> {
  const patch: Partial<ProfileFormData> = {}
  if (extract.fullName) {
    // Keep the saved profile in step with the resume that was just read, so an older resume's name cannot stick.
    Object.assign(patch, { name: extract.fullName, fullName: extract.fullName })
  }
  if (extract.whoAreYou) patch.whoAreYou = extract.whoAreYou
  if (extract.keyStrengths) patch.keyStrengths = extract.keyStrengths
  if (extract.currentRole) patch.currentRole = extract.currentRole
  if (extract.totalExperience) patch.totalExperience = extract.totalExperience
  if (extract.currentLocation) patch.currentLocation = extract.currentLocation
  if (extract.skills?.length) patch.skills = extract.skills
  if (extract.experienceSummary) patch.experienceSummary = extract.experienceSummary
  if (extract.workExperiences?.length) {
    patch.workExperiences = extract.workExperiences.map((exp) => ({
      ...exp,
      fromResume: true,
    }))
    patch.noPriorWorkExperience = false
  } else if (
    extract.totalExperience &&
    !/fresher|0\s*[-–]\s*1|0\s*years|\b0\s*year/i.test(extract.totalExperience)
  ) {
    patch.noPriorWorkExperience = false
  }
  if (extract.achievements?.length) patch.achievements = extract.achievements
  if (extract.metrics !== undefined) {
    patch.metrics = extract.metrics.length ? extract.metrics : [createEmptyMetric()]
  }
  if (extract.certifications?.length) {
    patch.certifications = extract.certifications.map((cert) => ({
      ...cert,
      fromResume: true,
    }))
  }
  if (extract.resumeText) patch.resumeText = extract.resumeText
  return patch
}

/** A text fragment as returned by pdf.js `getTextContent()`. */
export type PdfTextItem = {
  str?: string
  /** [scaleX, skewY, skewX, scaleY, x, y] */
  transform?: number[]
  width?: number
  hasEOL?: boolean
}

type PdfPart = { x: number; w: number; str: string }

/** Join the fragments of one visual line, adding a space only where there is a real gap. */
function joinPdfParts(parts: PdfPart[]): string {
  const ordered = [...parts].sort((p, q) => p.x - q.x)
  let line = ''
  let prevEnd = Number.NEGATIVE_INFINITY
  for (const part of ordered) {
    const gap = part.x - prevEnd
    const needsSpace = line !== '' && gap > 1.2 && !/\s$/.test(line) && !/^[\s,.;:)\]!?%]/.test(part.str)
    line += (needsSpace ? ' ' : '') + part.str
    prevEnd = part.x + part.w
  }
  return line.replace(/\s+/g, ' ').trim()
}

const COLUMN_GAP_PT = 24 // a gap this wide inside one line is a gutter between columns, not a word space

/**
 * Where two columns are separated by a gutter, return the x position where the right column starts; otherwise null.
 *
 * The right column starts at about the same x on every line, while the left column ends wherever its text ends, so
 * the votes are cast on the START of the right-hand fragment. A one-off wide gap (a right-aligned date) lands on a
 * different x each time and never wins. Real content is required on both sides.
 */
function findColumnBoundary(rows: { y: number; parts: PdfPart[] }[]): number | null {
  const BUCKET = 12
  const votes = new Map<number, { x: number; str: string }[]>()
  let multiPartRows = 0
  for (const row of rows) {
    const parts = [...row.parts].sort((p, q) => p.x - q.x)
    if (parts.length < 2) continue
    multiPartRows += 1
    const seen = new Set<number>()
    for (let i = 1; i < parts.length; i += 1) {
      const gap = parts[i].x - (parts[i - 1].x + parts[i - 1].w)
      if (gap >= COLUMN_GAP_PT) {
        const bucket = Math.round(parts[i].x / BUCKET)
        if (!seen.has(bucket)) {
          seen.add(bucket)
          votes.set(bucket, [...(votes.get(bucket) ?? []), { x: parts[i].x, str: parts[i].str }])
        }
      }
    }
  }
  let bestStarts: { x: number; str: string }[] = []
  for (const [bucket, starts] of votes) {
    // neighbouring buckets describe the same column edge
    const group = [...starts, ...(votes.get(bucket - 1) ?? []), ...(votes.get(bucket + 1) ?? [])]
    if (group.length > bestStarts.length) bestStarts = group
  }
  if (bestStarts.length < 4 || bestStarts.length < multiPartRows * 0.5) return null
  // A column of right-aligned dates ("Jan 2021 - Present") is not a second column: the right side must be real text.
  const DATE_ONLY = /^[\s\d\-–—/.,()[\]]*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|present|current|till\s+date|to\s+date|\d{4}|\d{1,2}\/\d{4})(?:[\s\d\-–—/.,()[\]]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|present|current|till\s+date|to\s+date)*$/i
  const dateLike = bestStarts.filter((s) => DATE_ONLY.test(s.str.trim())).length
  if (dateLike >= bestStarts.length * 0.6) return null
  const boundary = Math.min(...bestStarts.map((s) => s.x)) - 6
  const leftRows = rows.filter((r) => r.parts.some((p) => p.x + p.w <= boundary)).length
  const rightRows = rows.filter((r) => r.parts.some((p) => p.x >= boundary)).length
  return leftRows >= 4 && rightRows >= 4 ? boundary : null
}

/**
 * Rebuild the visual lines of a PDF page from its text fragments.
 *
 * pdf.js returns loose fragments ("Python", ",", " with hands-on"...). Joining them all with a space (as this code
 * used to) turns a whole page into ONE line, which breaks name, role, dates, skills and certification parsing.
 * Instead, fragments are grouped by their vertical position (same baseline = same line), ordered left to right, and
 * a space is added only where there is a real gap between two fragments.
 *
 * Two-column layouts (a sidebar next to the experience) are read one column at a time, so the left and right
 * columns are never glued into the same line.
 */
export function pdfItemsToLines(items: PdfTextItem[]): string[] {
  const rows: { y: number; parts: PdfPart[] }[] = []
  const TOLERANCE = 2.5 // points; superscripts and mixed fonts sit within this of the baseline

  for (const item of items) {
    const str = item.str ?? ''
    if (!str) continue
    const x = item.transform?.[4] ?? 0
    const y = item.transform?.[5] ?? 0
    const w = item.width ?? 0
    const row = rows.find((r) => Math.abs(r.y - y) <= TOLERANCE)
    if (row) row.parts.push({ x, w, str })
    else rows.push({ y, parts: [{ x, w, str }] })
  }

  rows.sort((a, b) => b.y - a.y) // PDF y grows upwards: top of the page first
  const boundary = findColumnBoundary(rows)
  const lines: string[] = []

  if (boundary === null) {
    for (const row of rows) {
      const clean = joinPdfParts(row.parts)
      if (clean) lines.push(clean)
    }
    return lines
  }

  // Two columns: full-width lines (title, summary) split the page into bands; inside a band, left column first.
  let left: string[] = []
  let right: string[] = []
  const flush = () => {
    lines.push(...left, ...right)
    left = []
    right = []
  }
  for (const row of rows) {
    const crossesGutter = row.parts.some((p) => p.x < boundary - 4 && p.x + p.w > boundary + 8)
    if (crossesGutter) {
      flush()
      const clean = joinPdfParts(row.parts)
      if (clean) lines.push(clean)
      continue
    }
    const leftText = joinPdfParts(row.parts.filter((p) => p.x < boundary))
    const rightText = joinPdfParts(row.parts.filter((p) => p.x >= boundary))
    if (leftText) left.push(leftText)
    if (rightText) right.push(rightText)
  }
  flush()
  return lines
}

async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())
  try {
    const pdf = await getDocument({ data }).promise
    const chunks: string[] = []
    for (let page = 1; page <= pdf.numPages; page += 1) {
      const content = await (await pdf.getPage(page)).getTextContent()
      const lines = pdfItemsToLines(content.items as PdfTextItem[])
      if (lines.length) chunks.push(lines.join('\n'))
    }
    const combined = chunks.join('\n')
    if (combined.trim().length > 20) return combined
  } catch (err) {
    console.warn('[ResumeParser] pdfjs-dist primary parse error, attempting fallback:', err)
  }

  // Fallback: extract readable strings directly from PDF binary buffer
  try {
    const buf = await file.arrayBuffer()
    const dec = new TextDecoder('utf-8', { fatal: false })
    const str = dec.decode(buf)
    const matches = str.match(/\(([^()]{2,})\)/g)
    if (matches && matches.length > 5) {
      const text = matches.map((m) => m.slice(1, -1)).join(' ')
      if (text.length > 40) return text
    }
  } catch {}

  throw new Error('Could not read text from this PDF. Please ensure it contains selectable text, or upload a DOCX/TXT.')
}

async function extractDocxText(file: File): Promise<string> {
  try {
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    })
    if (result.value?.trim()) return result.value
  } catch (err) {
    console.warn('[ResumeParser] mammoth DOCX extraction warning:', err)
  }
  return await file.text()
}

export async function extractResumeText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (file.type === 'application/pdf' || ext === 'pdf') {
    return extractPdfText(file)
  }
  if (
    file.type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return extractDocxText(file)
  }
  if (
    file.type.startsWith('text/') ||
    ext === 'txt' ||
    ext === 'text' ||
    ext === 'md' ||
    ext === 'rtf' ||
    ext === 'json'
  ) {
    return await file.text()
  }
  if (file.type === 'application/msword' || ext === 'doc') {
    try {
      const txt = await file.text()
      if (txt.replace(/[^\x20-\x7E\n]/g, '').trim().length > 60) {
        return txt.replace(/[^\x20-\x7E\n]/g, ' ')
      }
    } catch {}
    throw new Error('Legacy .doc files can’t be reliably parsed in-browser. Please save as PDF, DOCX, or TXT.')
  }
  // Try plain text extraction for any other format
  try {
    const fallbackText = await file.text()
    if (fallbackText && fallbackText.trim().length > 30) return fallbackText
  } catch {}
  throw new Error(`Unsupported file type (.${ext || 'unknown'}). Please upload a PDF, DOCX, or TXT file.`)
}

function cleanLines(text: string): string[] {
  return text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

const DEFAULT_SECTION_STOPS = [
  'experience',
  'work experience',
  'employment',
  'education',
  'skills',
  'projects',
  'certifications?',
  'achievements?',
  'awards?',
  'summary',
  'profile',
  'objective',
  'contact',
]

/** Experience sections must not stop at bare "experience" (truncates real job blocks). */
const EXPERIENCE_SECTION_LABELS = [
  'work experience',
  'professional experience',
  'employment history',
  'employment details',
  'work history',
  'relevant experience',
  'industry experience',
  'career history',
  'internship experience',
  'internships?',
  'employment',
  'experience',
]

const EXPERIENCE_SECTION_STOPS = [
  'work experience',
  'professional experience',
  'employment history',
  'employment details',
  'education',
  'academic background',
  'skills',
  'technical skills',
  'core competencies',
  'projects',
  'certifications?',
  'certificates?',
  'achievements?',
  'awards?',
  'summary',
  'profile',
  'objective',
  'contact',
  'references',
  'declaration',
]

/**
 * PDF extraction sometimes glues a section title onto the previous word ("...teamsSkills").
 * Only break before a known section heading — never split camelCase generally, which used to
 * turn "TypeScript" into "Type Script" and "PostgreSQL" into "Postgre SQL".
 */
const GLUED_SECTION_RE =
  /([a-z0-9.,)])(Experience|Education|Skills|Projects?|Summary|Certifications?|Achievements?|Objective|Languages|Awards|References)\b/g

function normalizeResumeText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(GLUED_SECTION_RE, '$1\n$2')
    .replace(/\n{3,}/g, '\n\n')
}

function sectionBody(text: string, labels: string[], stopLabels = DEFAULT_SECTION_STOPS): string {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${labels.join('|')})\\s*[:\\-]?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:${stopLabels.join('|')})\\b|$)`,
    'i',
  )
  const match = text.match(pattern)
  return match?.[1]?.trim() ?? ''
}

/** PDFs often glue section titles into one line — slice between known headers. */
function inlineExperienceSection(text: string): string {
  const startRe =
    /\b(?:work\s+experience|professional\s+experience|employment\s+(?:history|details)|internship\s+experience|internships?|employment)\b[:\s-]*/i
  const start = text.match(startRe)
  if (!start || start.index === undefined) return ''
  const rest = text.slice(start.index + start[0].length)
  const endRe =
    /\b(?:education|academic|skills|technical\s+skills|certifications?|projects|achievements?|awards?|contact|references|declaration)\b/i
  const end = endRe.exec(rest)
  const slice = (end ? rest.slice(0, end.index) : rest).trim()
  return slice.length >= 20 ? slice : ''
}

function pickExperienceSectionBody(text: string): string {
  const normalized = normalizeResumeText(text)
  const fromSection = sectionBody(
    normalized,
    EXPERIENCE_SECTION_LABELS,
    EXPERIENCE_SECTION_STOPS,
  )
  if (fromSection.trim().length >= 20) return fromSection
  return inlineExperienceSection(normalized)
}

function clip(value: string, max: number) {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function pickRole(text: string): string {
  const lower = text.toLowerCase()
  const ranked = [...ROLE_OPTIONS].sort((a, b) => b.length - a.length)
  for (const role of ranked) {
    if (lower.includes(role.toLowerCase())) return role
  }
  const titleMatch = text.match(
    /\b((?:senior|junior|lead|principal|staff)?\s?(?:software|frontend|backend|full[\s-]?stack|product|data|devops|ui\/?ux)?\s?(?:engineer|developer|manager|designer|scientist|analyst))\b/i,
  )
  if (titleMatch) {
    const candidate = titleMatch[1]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    const close = ROLE_OPTIONS.find(
      (role) => role.toLowerCase() === candidate.toLowerCase(),
    )
    return close ?? candidate
  }
  return ''
}

function pickLocation(text: string): string {
  for (const location of LOCATION_OPTIONS) {
    if (new RegExp(`\\b${location.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text)) {
      return location
    }
  }
  if (/\bremote\b/i.test(text)) return 'Remote'
  return ''
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/** "May 2026" -> months since year 0; "2022" -> January of that year. Returns null if unreadable. */
function monthIndex(value: string | undefined, fallbackMonth = 0): number | null {
  const v = (value || '').trim()
  if (!v) return null
  if (/present|current|ongoing|till/i.test(v)) {
    const now = new Date()
    return now.getFullYear() * 12 + now.getMonth()
  }
  const year = v.match(/(?:19|20)\d{2}/)
  if (!year) return null
  const month = v.match(/[A-Za-z]{3}/)
  const m = month ? MONTHS[month[0].toLowerCase()] : undefined
  return Number(year[0]) * 12 + (m ?? fallbackMonth)
}

/** Total experience from the job dates when the resume never says "N years". */
function experienceFromWork(works: WorkExperience[]): string {
  let earliest: number | null = null
  let latest: number | null = null
  for (const w of works) {
    const start = monthIndex(w.startDate)
    const end = w.currentlyWorking ? monthIndex('Present') : monthIndex(w.endDate, 11)
    if (start === null) continue
    earliest = earliest === null ? start : Math.min(earliest, start)
    const endValue = end ?? start
    latest = latest === null ? endValue : Math.max(latest, endValue)
  }
  if (earliest === null || latest === null || latest < earliest) return ''
  return yearsToExperienceLabel((latest - earliest) / 12)
}

function pickExperience(text: string): string {
  const range = text.match(
    /(\d+(?:\.\d+)?)\s*(?:\+|to|–|-)\s*(\d+(?:\.\d+)?)\s*\+?\s*years?/i,
  )
  const single = text.match(/(\d+(?:\.\d+)?)\s*\+?\s*years?(?:\s+of\s+experience)?/i)
  const months = text.match(/\b(\d{1,2})\s*\+?\s*months?\b/i)
  const years = range
    ? (Number(range[1]) + Number(range[2])) / 2
    : single
      ? Number(single[1])
      : months
        ? Number(months[1]) / 12
        : NaN

  if (Number.isNaN(years)) return ''
  return yearsToExperienceLabel(years)
}

function yearsToExperienceLabel(years: number): string {
  if (years < 1) return 'Fresher / 0 years'
  if (years < 2) return '0 – 1 Years'
  if (years < 3) return '1 – 2 Years'
  if (years < 4) return '2 – 3 Years'
  if (years < 6) return '3 – 5 Years'
  if (years < 9) return '5 – 8 Years'
  if (years < 13) return '8 – 12 Years'
  return '12+ Years'
}

/** Short forms people actually write on resumes -> the canonical skill label. */
const SKILL_ALIASES: Record<string, string[]> = {
  'React.js': ['react', 'reactjs'],
  'Node.js': ['node', 'nodejs'],
  'Express.js': ['express', 'expressjs'],
  'Vue.js': ['vue', 'vuejs'],
  'Next.js': ['nextjs'],
  PostgreSQL: ['postgres'],
  'CI/CD': ['ci cd', 'cicd'],
}

function pickSkills(text: string): string[] {
  const lower = text.toLowerCase()
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = SKILL_OPTIONS.filter((skill) => {
    const names = [skill, ...(SKILL_ALIASES[skill] ?? [])]
    return names.some((name) =>
      new RegExp(`(?<![\\w.])${escape(name).replace(/\s+/g, '\\s+')}(?![\\w])`, 'i').test(lower),
    )
  })
  return [...new Set(found)].slice(0, 12)
}

const SKILL_SECTION_LABELS = ['technical skills', 'key skills', 'core skills', 'skills & tools', 'tools & technologies', 'technologies', 'skills']
const SKILL_SECTION_STOPS = [
  'professional experience', 'work experience', 'experience', 'employment', 'education', 'academic', 'projects?',
  'certifications?', 'achievements?', 'awards?', 'professional summary', 'summary', 'profile', 'objective',
  'declaration', 'languages', 'interests',
]

/** Split on commas / semicolons / pipes that are not inside brackets. */
function splitTopLevel(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(' || ch === '[') depth += 1
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && /[,;|•·]/.test(ch)) {
      out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current)
  return out
}

/** The candidate's own skills, in their own words, from the "Technical Skills" section. */
function pickSkillsFromSection(text: string): string[] {
  const body = sectionBody(text, SKILL_SECTION_LABELS, SKILL_SECTION_STOPS)
  if (!body) return []
  // Join wrapped lines; a new "Category:" line starts a new entry.
  const entries: string[] = []
  for (const line of body.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (/^[A-Z][^:,|]{1,45}:\s/.test(line) || !entries.length) entries.push(line)
    else entries[entries.length - 1] += ' ' + line
  }
  const seen = new Set<string>()
  const skills: string[] = []
  for (const entry of entries) {
    const list = entry.replace(/^[^:]{1,45}:\s*/, '')
    for (const raw of splitTopLevel(list)) {
      const skill = raw.replace(/^[\s•·\-–]+/, '').replace(/\s+/g, ' ').trim()
      const words = skill.split(' ').length
      if (skill.length < 2 || skill.length > 40 || words > 6) continue
      if (/^(and|etc\.?|basics?)$/i.test(skill)) continue
      const key = skill.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      skills.push(skill)
    }
  }
  return skills
}

function mergeSkills(fromSection: string[], fromCatalog: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const skill of [...fromSection, ...fromCatalog]) {
    const key = skill.toLowerCase().replace(/[^a-z0-9+#]/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(skill)
  }
  return out.slice(0, 40)
}

const NOT_NAME_WORDS =
  /^(?:engineers?|developers?|managers?|analysts?|designers?|architects?|consultants?|scientists?|interns?|specialists?|administrators?|executives?|programmers?|testers?|recruiters?|associates?|senior|junior|lead|principal|software|frontend|backend|full|stack|fullstack|devops|cloud|web|mobile|data|python|java|javascript|typescript|react|node|aws|sql|ai|ml|llms?|rag|resume|curriculum|vitae|profile|summary|objective|skills|education|experience)$/i

export function extractNameFromText(text: string): string | null {
  if (!text || typeof text !== 'string') return null
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  for (const rawLine of lines.slice(0, 10)) {
    // 1. Check if line explicitly has "Name: John Doe" or "Full Name: John Doe"
    const namePrefixMatch = rawLine.match(/(?:^|\b)(?:full\s*name|name)\s*[:-]\s*([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){1,3})/i)
    if (namePrefixMatch) {
      return namePrefixMatch[1].trim()
    }

    // 2. Strip common header labels
    let line = rawLine
      .replace(/^(?:curriculum\s+vitae|resume|cv|biodata|profile)\b[:\s-]*/i, '')
      .trim()

    // 3. Take segment before pipes, bullet points, emails, numbers, or dashes
    const cleanSegment = line
      // eslint-disable-next-line eslint/no-useless-escape -- `[`/`]` must stay escaped in this character class for oxlint/parser compatibility
      .split(/[@|•·,;–—()\[\]\d+]/)[0]
      .trim()

    if (!cleanSegment) continue
    if (/summary|objective|profile|experience|education|skills|projects|contact|declaration|email|phone/i.test(cleanSegment)) continue

    const words = cleanSegment.split(/\s+/).filter(Boolean)
    // A job title or a list of technologies is not a name ("AI Engineer", "Python Developer").
    if (words.some((w) => NOT_NAME_WORDS.test(w))) continue
    // Accept 2 to 4 words where all words look like name tokens
    if (
      words.length >= 2 &&
      words.length <= 4 &&
      words.every((w) => /^[A-Za-z.'-]+$/.test(w) && w.length >= 2)
    ) {
      return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    }

    // Also accept 1 capitalized name if next line is a role/title
    if (
      words.length === 1 &&
      /^[A-Za-z]{3,}$/.test(words[0]) &&
      !/^(engineer|developer|manager|resume|contact|profile|summary|skills|projects)$/i.test(words[0]) &&
      lines.length > 1 &&
      pickRole(lines[1])
    ) {
      return words[0][0].toUpperCase() + words[0].slice(1).toLowerCase()
    }
  }
  return null
}

function pickName(lines: string[]): string {
  return extractNameFromText(lines.join('\n')) || ''
}

const COUNTRY_NAMES =
  'India|USA|U\\.S\\.A?|United States|UK|United Kingdom|Canada|Australia|Germany|Singapore|UAE|Remote'
const COUNTRY_TAIL = new RegExp(
  `\\s+([A-Z][A-Za-z.]+)(?:\\s([A-Z][A-Za-z.]+))?,\\s*(?:${COUNTRY_NAMES})\\b.*$`,
)
const TITLE_WORD = /^(?:engineer|developer|manager|designer|scientist|analyst|architect|consultant|specialist|lead|executive|administrator|associate|intern|officer|programmer|tester)$/i

/** "AI Associate Engineer Hyderabad, India |" -> "AI Associate Engineer" (removes only the city and country). */
function cleanJobTitle(title: string): string {
  const withoutLocation = title.replace(COUNTRY_TAIL, (_whole, first: string, second?: string) => {
    // "Engineer Hyderabad, India": the first word is part of the title, only the city goes.
    if (second && TITLE_WORD.test(first)) return ` ${first}`
    return ''
  })
  return withoutLocation
    .replace(/\s*[|,;]+\s*$/g, '')
    .replace(/^\s*[|,;]+\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const LEVEL_WORDS = /\b(?:associate|junior|jr\.?|senior|sr\.?|lead|principal|staff|trainee|intern|i{1,3})\b/gi

/** Prefer a standard role name ("AI Engineer") over a level-decorated title ("AI Associate Engineer"). */
function canonicalRole(title: string): string {
  const cleaned = cleanJobTitle(title)
  if (!cleaned) return ''
  const bare = cleaned.replace(LEVEL_WORDS, ' ').replace(/\s{2,}/g, ' ').trim()
  const match = ROLE_OPTIONS.find((r) => r.toLowerCase() === bare.toLowerCase())
  return match ?? cleaned
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "[08/2024]" or "08/2024" -> "Aug 2024". */
function numericDatesToMonthNames(line: string): string {
  return line.replace(/\[?\b(0?[1-9]|1[0-2])\/((?:19|20)\d{2})\b\]?/g, (_m, month: string, year: string) => `${MONTH_SHORT[Number(month) - 1]} ${year}`)
}

const TITLE_LINE = /\b(?:engineer|developer|manager|designer|scientist|analyst|architect|consultant|specialist|executive|administrator|programmer|tester|intern|associate|lead|officer|recruiter|trainee)\b/i

function pickWorkExperiences(text: string): WorkExperience[] {
  // Only parse when a work/employment section exists (never the whole résumé).
  const body = pickExperienceSectionBody(text)
  if (!body || body.trim().length < 20) {
    return []
  }

  const bodyNormalized = body.includes('\n')
    ? body
    : body.replace(/\s{2,}/g, '\n').replace(/\s+(?=(?:19|20)\d{2}\s*[-–—])/g, '\n')

  const lines = bodyNormalized
    .split('\n')
    .map((l) => numericDatesToMonthNames(l.trim()))
    .filter(Boolean)
  if (!lines.length) return []

  const datePattern =
    /(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*[\s,.'-]*)?(?:19|20)\d{2}\s*(?:[-–—to/]+\s*(?:Present|Current|Ongoing|Till\s*Date|(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*[\s,.'-]*)?(?:19|20)\d{2})?)?|\b(?:19|20)\d{2}\s*[-–—/]\s*(?:(?:19|20)\d{2}|Present|Current|Ongoing)\b/i

  const blocks: { header: string; lines: string[] }[] = []
  let currentBlock: { header: string; lines: string[] } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isBullet =
      /^[•\-*]/.test(line) ||
      /^projects?\s*[:\-–]/i.test(line) ||
      // "Project name | Tech | Tech | Tech" with no dates is a project heading, not an employer.
      (!datePattern.test(line) && (line.match(/\|/g) || []).length >= 2)
    const hasRole = Boolean(pickRole(line))
    const hasDate = datePattern.test(line)
    const hasSeparator = /\s+(?:at|@|\||–|—|-)\s+/i.test(line)

    const isHeaderCandidate =
      !isBullet &&
      (hasRole ||
        hasSeparator ||
        (hasDate && line.length < 120) ||
        (hasDate && Boolean(lines[i + 1])))

    if (isHeaderCandidate && (!currentBlock || currentBlock.lines.length > 0)) {
      if (currentBlock) blocks.push(currentBlock)
      currentBlock = { header: line, lines: [] }
    } else if (currentBlock) {
      currentBlock.lines.push(line)
    } else if (!isBullet && line.length < 90) {
      currentBlock = { header: line, lines: [] }
    }
  }
  if (currentBlock) blocks.push(currentBlock)

  const experiences: WorkExperience[] = []

  for (const block of blocks.slice(0, 5)) {
    const header = block.header
    let role = ''
    let company = ''
    let dateStr = ''

    const dateMatch = header.match(datePattern) || block.lines.find((l) => datePattern.test(l))?.match(datePattern)
    if (dateMatch) {
      dateStr = dateMatch[0].trim()
    }

    const atMatch = header.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i)
    const pipeMatch = header.match(/^(.+?)\s+[|]\s+(.+)$/)
    const commaMatch = header.match(/^([^,]+),\s*(.+)$/)
    const dashMatch = header.match(/^(.+?)\s+[-–—]\s+(.+)$/)

    if (atMatch) {
      role = atMatch[1].replace(datePattern, '').replace(/[|(),]/g, '').trim()
      company = atMatch[2].replace(datePattern, '').replace(/[|(),]/g, '').trim()
    } else if (pipeMatch) {
      const p1 = pipeMatch[1].replace(datePattern, '').trim()
      const p2 = pipeMatch[2].replace(datePattern, '').trim()
      if (pickRole(p1)) {
        role = p1
        company = p2
      } else {
        company = p1
        role = p2
      }
    } else if (commaMatch && !datePattern.test(commaMatch[1])) {
      const c1 = commaMatch[1].replace(datePattern, '').trim()
      const c2 = commaMatch[2].replace(datePattern, '').trim()
      if (pickRole(c1)) {
        role = c1
        company = c2
      } else {
        company = c1
        role = c2
      }
    } else if (dashMatch && !dashMatch[1].toLowerCase().includes('present')) {
      const d1 = dashMatch[1].replace(datePattern, '').trim()
      const d2 = dashMatch[2].replace(datePattern, '').trim()
      if (pickRole(d1)) {
        role = d1
        company = d2
      } else {
        company = d1
        role = d2
      }
    } else {
      const r1 = pickRole(header)
      if (r1) {
        role = r1
        const nextLine = block.lines[0] || ''
        if (nextLine && !/^[•\-*]/.test(nextLine) && !datePattern.test(nextLine)) {
          company = nextLine.replace(/[|(),]/g, '').trim()
        }
      } else {
        company = header.replace(datePattern, '').replace(/[|(),]/g, '').trim()
        const nextLine = block.lines[0] || ''
        role = pickRole(nextLine) || nextLine.replace(datePattern, '').trim()
      }
    }

    role = role.replace(/^(senior|junior|lead|principal|staff|associate|intern)\s+/i, (m) => m).trim()
    company = company.replace(/\s+(?:Inc\.?|LLC|Pvt\.?\s*Ltd\.?|Ltd\.?)\b/i, (m) => m).trim()

    if (
      !company ||
      company.length < 2 ||
      company.length > 70 ||
      /^(company|experience|summary|skills|projects|education|university|college|school|responsibilities)$/i.test(company)
    ) {
      const foundComp = block.lines
        .slice(0, 2)
        .find((l) => !/^[•\-*]/.test(l) && !pickRole(l) && l.length > 2 && l.length < 60)
      if (foundComp) {
        company = foundComp.replace(datePattern, '').trim()
      }
    }

    // Two-line header: line 1 = company (+ country or "3 Months"), line 2 = job title (+ dates or city).
    const next = block.lines[0] || ''
    const headerHasTitle = Boolean(pickRole(header)) && TITLE_LINE.test(header)
    const headerDuration = /\b\d{1,2}\s*(?:months?|yrs?|years?)\b/i.test(header)
    if (
      next &&
      !headerHasTitle &&
      !/^[•\-*–]/.test(next) &&
      TITLE_LINE.test(next) &&
      next.length < 110 &&
      (datePattern.test(next) || headerDuration)
    ) {
      const titleOnly = next.replace(datePattern, '').replace(/\bpresent\b/i, '').replace(/[–—-]\s*$/g, '')
      role = titleOnly
      company = header.replace(datePattern, '')
      if (!dateStr) dateStr = (next.match(datePattern) || [''])[0].trim()
      block.lines = block.lines.slice(1)
    }

    role = cleanJobTitle(role)
    // "Techcitta Software Private Limited India" / "... 3 Months" -> just the company name
    company = company
      .replace(/\b\d{1,2}\s*(?:months?|yrs?|years?)\b/gi, '')
      .replace(new RegExp(`\\s+(?:${COUNTRY_NAMES})\\s*$`, 'i'), '')
    company = company
      .replace(/\(\s*\)/g, '')
      .replace(/[\s,;|\-–—]+$/g, '')
      .replace(/^[\s,;|\-–—]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()

    // Never hallucinate "Company", "TechCitta", or generic sections
    if (
      !company ||
      /^(company|experience|summary|skills|projects|education|university|college|school|responsibilities)$/i.test(company)
    ) {
      continue
    }

    const responsibilities = block.lines
      .filter((l) => /^[•\-*]/.test(l) || l.length > 30)
      .map((l) => l.replace(/^[•\-*]\s*/, '• '))
      .slice(0, 6)
      .join('\n')

    const isCurrent = /present|current|ongoing|till date/i.test(dateStr || header || block.lines.join(' '))

    experiences.push({
      id: crypto.randomUUID(),
      jobTitle: clip(role || pickRole(header) || 'Engineer', 80),
      company: clip(company, 80),
      employmentType: 'Full-time',
      startDate: dateStr.split(/[-–—to/]+/i)[0]?.trim() || '',
      endDate: isCurrent ? 'Present' : (dateStr.split(/[-–—to/]+/i)[1]?.trim() || ''),
      currentlyWorking: isCurrent,
      location: pickLocation(header + ' ' + block.lines.join(' ')),
      responsibilities: clip(responsibilities, 800),
    })
  }

  return experiences
}

function pickAchievements(text: string): string[] {
  const body = sectionBody(text, ['achievements?', 'accomplishments?', 'awards?'])
  if (!body) {
    return text
      .split('\n')
      .filter((line) => /^[•\-*]/.test(line) || /\d+%|increased|reduced|improved/i.test(line))
      .map((line) => clip(line.replace(/^[•\-*]\s*/, ''), 180))
      .filter(Boolean)
      .slice(0, 4)
  }
  return body
    .split('\n')
    .map((line) => clip(line.replace(/^[•\-*]\s*/, ''), 180))
    .filter((line) => line.length > 12)
    .slice(0, 4)
}

const METRIC_LINE_RE =
  /\d+%|\$\d|\d+\s*(?:x|X)\b|(?:increased|reduced|decreased|improved|saved|grew|boosted|cut|lowered|raised|accelerated|optimized|delivered|achieved|generated)/i

const IMPACT_RE =
  /(?:by|to|up to|down to|from)?\s*(\d+(?:\.\d+)?%|\d+\s*(?:%|percent|pp|x|X)|[$€£]\s*\d[\d,.]*[kKmMbB]?)/i

function metricLinePresentInText(line: string, rawText: string): boolean {
  const hay = rawText.toLowerCase()
  const words = line
    .toLowerCase()
    .replace(/[^a-z0-9\s%$]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
  if (!words.length) return false
  return words.filter((w) => hay.includes(w)).length >= Math.min(2, words.length)
}

function pickTimePeriodFromLine(line: string): string {
  const range = line.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*\s*[,.'-]?\s*(20\d\d|19\d\d)\s*(?:-|–|—|to)\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*\s*[,.'-]?\s*(20\d\d|19\d\d)/i,
  )
  if (!range) return ''
  const m1 = range[1].slice(0, 3)
  const y1 = range[2]
  const m2 = range[3].slice(0, 3)
  const y2 = range[4]
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  return `${cap(m1)} ${y1} - ${cap(m2)} ${y2}`
}

function workExperienceTimeLabel(exp: WorkExperience): string {
  const start = exp.startDate?.trim()
  const end = exp.currentlyWorking ? 'Present' : exp.endDate?.trim()
  if (start && end) return `${start} - ${end}`
  if (start) return start
  return ''
}

function parseMetricLine(
  line: string,
  fallbackPeriod: string,
  rawText: string,
): PerformanceMetric | null {
  const cleaned = line.replace(/^[•\-*]\s*/, '').trim()
  if (cleaned.length < 12 || !METRIC_LINE_RE.test(cleaned)) return null
  if (!metricLinePresentInText(cleaned, rawText)) return null

  const impactMatch = cleaned.match(IMPACT_RE)
  const impact = impactMatch ? clip(impactMatch[0].replace(/^(by|to)\s+/i, '').trim(), 80) : ''

  let metric = ''
  let contribution = clip(cleaned, 180)
  const byIdx = cleaned.toLowerCase().indexOf(' by ')
  if (byIdx > 0) {
    metric = clip(cleaned.slice(0, byIdx).trim(), 100)
    contribution = clip(cleaned.slice(byIdx + 4).trim(), 180)
  } else {
    const clause = cleaned.split(/[.;]/)[0]?.trim() || cleaned
    metric = clip(clause, 100)
  }

  const timePeriod = pickTimePeriodFromLine(cleaned) || fallbackPeriod

  if (!metric && !impact) return null

  return {
    id: crypto.randomUUID(),
    metric,
    contribution,
    impact,
    timePeriod,
  }
}

function pickMetrics(text: string, workExperiences: WorkExperience[] = []): PerformanceMetric[] {
  const fallbackPeriod = workExperiences[0]
    ? workExperienceTimeLabel(workExperiences[0])
    : ''

  const fromAchievements = pickAchievements(text).filter((a) => METRIC_LINE_RE.test(a))
  const fromBullets = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[•\-*]/.test(line) && METRIC_LINE_RE.test(line))
    .map((line) => line.replace(/^[•\-*]\s*/, '').trim())

  const seen = new Set<string>()
  const lines: string[] = []
  for (const line of [...fromAchievements, ...fromBullets]) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(line)
    if (lines.length >= 6) break
  }

  return lines
    .map((line) => parseMetricLine(line, fallbackPeriod, text))
    .filter(Boolean) as PerformanceMetric[]
}

function mapAiMetrics(
  parsed: Record<string, unknown>,
  rawText: string,
  workExperiences: WorkExperience[],
): PerformanceMetric[] {
  if (!Array.isArray(parsed.metrics)) return pickMetrics(rawText, workExperiences)

  const fallbackPeriod = workExperiences[0]
    ? workExperienceTimeLabel(workExperiences[0])
    : ''

  const mapped = parsed.metrics
    .map((row: Record<string, unknown>) => {
      const metric = String(row.metric || row.kpi || '').trim()
      const contribution = String(row.contribution || row.action || '').trim()
      const impact = String(row.impact || row.result || '').trim()
      const timePeriod = String(row.timePeriod || row.period || '').trim()
      if (!metric && !contribution && !impact) return null
      const verifyLine = [metric, contribution, impact].filter(Boolean).join(' ')
      if (verifyLine && !metricLinePresentInText(verifyLine, rawText)) return null
      return {
        id: crypto.randomUUID(),
        metric: clip(metric, 100),
        contribution: clip(contribution, 180),
        impact: clip(impact, 80),
        timePeriod: clip(timePeriod || fallbackPeriod, 40),
      }
    })
    .filter(Boolean) as PerformanceMetric[]

  if (mapped.length) return mapped
  return pickMetrics(rawText, workExperiences)
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function parseDateToMonthYear(str: string): string {
  if (!str) return ''
  const yyyymm = str.match(/\b(20\d\d|19\d\d)[-/.](0[1-9]|1[0-2])\b/)
  if (yyyymm) return `${yyyymm[1]}-${yyyymm[2]}`

  const monthYear = str.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*\s*[,.'-]?\s*(20\d\d|19\d\d)\b/i)
  if (monthYear) {
    const mPrefix = monthYear[1].toLowerCase().slice(0, 3)
    const mNum = MONTH_MAP[mPrefix] || '01'
    return `${monthYear[2]}-${mNum}`
  }

  const yyyy = str.match(/\b(20\d\d|19\d\d)\b/)
  if (yyyy) return `${yyyy[1]}-01`

  return ''
}

function extractCredentialId(str: string): string {
  const match = str.match(/(?:credential\s*id|license(?:\s*no\.?|\s*id)?|verification(?:\s*id)?)\s*[:#-]?\s*([A-Za-z0-9_-]{5,40})/i)
  return match ? match[1].trim() : ''
}

function cleanOrg(org: string): string {
  return org
    .replace(/^[\s:–—|\-,.]+|[\s:–—|\-,.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanCertName(name: string): string {
  return name
    .replace(/^[•*·\-–—\d.)\s]+|[\s:–—|\-,.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const KNOWN_CERT_ISSUERS = [
  'Amazon Web Services', 'AWS', 'Google Cloud Platform', 'Google Cloud', 'Google',
  'Microsoft Azure', 'Microsoft', 'Azure', 'Meta', 'IBM', 'Oracle', 'Cisco',
  'Coursera', 'Udemy', 'edX', 'NPTEL', 'Stanford Online', 'Stanford', 'Harvard',
  'freeCodeCamp', 'HackerRank', 'LinkedIn Learning', 'LinkedIn', 'Pluralsight',
  'I And T hubs', 'Prodigy Tech Info', 'Udacity', 'Salesforce', 'Red Hat',
  'Linux Foundation', 'The Linux Foundation', 'DeepLearning.AI', 'DataCamp',
]

export function pickCertifications(text: string): Certification[] {
  if (!text || typeof text !== 'string') return []

  const sectionHeaderRegex = /(?:^|\n)\s*(?:(?:licenses?\s*(?:&|and)\s*)?certifications?|(?:courses?\s*(?:&|and)\s*)?certifications?|certificates?|credentials?|accreditations?)\s*[:-]?\s*\n?([\s\S]*?)(?=\n\s*(?:work\s+experience|professional\s+experience|experience|employment|education|skills|projects|achievements?|awards?|summary|profile|objective|contact|declaration|languages|interests|extracurricular|co-?curricular|activities|volunteer(?:ing)?|hobbies|personal\s+details|references|publications)\b|$)/i

  const match = text.match(sectionHeaderRegex)
  const body = match ? match[1].trim() : ''
  if (!body || body.length < 5) return []

  const rawLines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const items: string[] = []

  for (const line of rawLines) {
    const bulletParts = line.split(/[•·]+/).map((p) => p.trim()).filter(Boolean)
    for (const bPart of bulletParts) {
      if (bPart.includes('|')) {
        const pipeParts = bPart.split('|').map((p) => p.trim()).filter(Boolean)
        const hasMultipleNamedCerts = pipeParts.filter((p) =>
          /[:]|(?:\s+by\s+)|\s[-–—]\s/i.test(p) && !/(?:credential|license|verification)\s*id/i.test(p)
        ).length >= 2

        if (hasMultipleNamedCerts) {
          items.push(...pipeParts)
          continue
        }
      }
      items.push(bPart)
    }
  }

  const certs: Certification[] = []

  for (const rawItem of items) {
    let item = rawItem
      .replace(/^[•*·\-\d.)\s]+/, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!item || item.length < 3) continue
    if (/^(certifications?|certificates?|licenses?|courses?|education)$/i.test(item)) continue
    if (/^(english|hindi|telugu|tamil|french|spanish|german)\s*:\s*(fluent|native|proficient|basic|intermediate)/i.test(item)) continue

    const credId = extractCredentialId(item)
    if (credId) {
      item = item.replace(/(?:credential\s*id|license(?:\s*no\.?|\s*id)?|verification(?:\s*id)?)\s*[:#-]?\s*[A-Za-z0-9_-]{5,40}/i, '').trim()
    }

    const dateEarned = parseDateToMonthYear(item)
    if (dateEarned) {
      item = item.replace(/\(?(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*\s*[,.'-]?\s*)?(?:20\d\d|19\d\d)\)?/ig, '').trim()
    }

    let name = ''
    let organization = ''

    // If item has '|', e.g. "Name | Organization"
    if (item.includes('|')) {
      const parts = item.split('|').map((p) => p.trim()).filter(Boolean)
      if (parts.length >= 2) {
        name = cleanCertName(parts[0])
        organization = cleanOrg(parts[1])
      } else {
        name = cleanCertName(parts[0])
      }
    }
    // Pattern: "Name: Organization" (e.g. "Full stack development: I And T hubs .")
    else if (item.includes(':')) {
      const parts = item.split(':')
      name = cleanCertName(parts[0])
      organization = cleanOrg(parts.slice(1).join(':'))
    }
    // Pattern: "Name by Organization" or "Name from Organization"
    else if (/\s+(?:by|from|via)\s+/i.test(item)) {
      const parts = item.split(/\s+(?:by|from|via)\s+/i)
      name = cleanCertName(parts[0])
      organization = cleanOrg(parts.slice(1).join(' '))
    }
    // Pattern: "Name - Organization" (with spaces around dash)
    else if (/\s+[-–—]\s+/.test(item)) {
      const parts = item.split(/\s+[-–—]\s+/)
      if (parts.length === 2) {
        name = cleanCertName(parts[0])
        organization = cleanOrg(parts[1])
      } else if (parts.length > 2) {
        const lastPart = cleanOrg(parts[parts.length - 1])
        const isLastIssuer = KNOWN_CERT_ISSUERS.some((iss) => iss.toLowerCase() === lastPart.toLowerCase())
        if (isLastIssuer) {
          name = cleanCertName(parts.slice(0, -1).join(' - '))
          organization = lastPart
        } else {
          name = cleanCertName(parts[0])
          organization = cleanOrg(parts.slice(1).join(' - '))
        }
      }
    }
    // Pattern: "Name (Organization)" at end of string
    else if (/^(.+?)\s*\(([^)]+)\)$/.test(item)) {
      const parenMatch = item.match(/^(.+?)\s*\(([^)]+)\)$/)
      if (parenMatch) {
        name = cleanCertName(parenMatch[1])
        organization = cleanOrg(parenMatch[2])
      }
    }

    // Fallback if organization is still empty: scan for known issuer
    if (!organization) {
      if (!name) name = cleanCertName(item)
      const matchedIssuer = KNOWN_CERT_ISSUERS.find((iss) =>
        new RegExp(`\\b${iss.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(item),
      )
      if (matchedIssuer) {
        organization = matchedIssuer
      }
    }

    name = name.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').replace(/[.,:;]+$/, '').trim()
    organization = organization.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').replace(/[.,:;]+$/, '').trim()

    if (name && name.length >= 2) {
      certs.push({
        id: crypto.randomUUID(),
        name: clip(name, 100),
        organization: clip(organization, 100),
        dateEarned,
        credentialId: clip(credId, 60),
      })
    }

    if (certs.length >= 5) break
  }

  return certs
}

export function parseResumeText(raw: string): ResumeExtract {
  const text = normalizeResumeText(raw.split('\0').join(' '))
  const lines = cleanLines(text)
  const joined = lines.join('\n')

  const fullName = pickName(lines)
  const workExperiences = pickWorkExperiences(joined)
  const latestTitle = workExperiences.find((w) => /engineer|developer|manager|designer|scientist|analyst|architect|consultant|lead|intern|associate|executive|specialist/i.test(w.jobTitle || ''))?.jobTitle
  const currentRole = (latestTitle ? canonicalRole(latestTitle) : '') || pickRole(joined)
  const currentLocation = pickLocation(joined)
  const skills = mergeSkills(pickSkillsFromSection(joined), pickSkills(joined))

  const summary =
    sectionBody(joined, ['professional summary', 'summary', 'profile', 'about me']) ||
    lines.slice(1, 6).join(' ')

  const objective =
    sectionBody(joined, ['objective', 'career objective', 'career goal']) ||
    ''

  const strengthsBody =
    sectionBody(joined, ['strengths', 'core competencies', 'key skills']) ||
    skills.slice(0, 6).join(', ')

  const whoAreYou = clip(
    [
      fullName && currentRole
        ? `I'm ${fullName}, ${/^[aeiou]/i.test(currentRole) ? 'an' : 'a'} ${currentRole}`
        : fullName
          ? `I'm ${fullName}`
          : currentRole
            ? `I'm ${/^[aeiou]/i.test(currentRole) ? 'an' : 'a'} ${currentRole}`
            : '',
      summary && !summary.toLowerCase().startsWith("i'm")
        ? summary
        : summary,
    ]
      .filter(Boolean)
      .join('. ')
      .replace(/\.\./g, '.'),
    300,
  )

  const whatDrivesYou = clip(
    objective ||
      (skills.length
        ? `I'm driven by building high-quality products with ${skills.slice(0, 3).join(', ')}, and growing through meaningful impact.`
        : ''),
    300,
  )

  const keyStrengths = clip(strengthsBody || skills.join(', '), 250)
  const experienceSummary = clip(summary || whoAreYou, 500)
  const achievements = pickAchievements(joined)
  const certifications = pickCertifications(joined)

  const extract: ResumeExtract = {}
  if (fullName) extract.fullName = fullName
  if (whoAreYou) extract.whoAreYou = whoAreYou
  if (whatDrivesYou) extract.whatDrivesYou = whatDrivesYou
  if (keyStrengths) extract.keyStrengths = keyStrengths
  if (currentRole && (ROLE_OPTIONS.includes(currentRole) || currentRole.length > 2)) {
    extract.currentRole = ROLE_OPTIONS.includes(currentRole)
      ? currentRole
      : ROLE_OPTIONS.find((r) =>
          currentRole.toLowerCase().includes(r.toLowerCase()),
        ) || currentRole
  }
  const hasExperienceSection = /^\s*(?:work\s+|professional\s+|industry\s+)?experience\b|^\s*employment\b|^\s*internships?\b/im.test(joined)
  const studentSignal = /\b(fresher|final[-\s]?year|student|undergraduate|pursuing|b\.?\s?tech|b\.?e\.?\b|bachelor|m\.?\s?tech|b\.?sc|bca|mca)\b/i.test(joined)
  const experience =
    pickExperience(joined) ||
    experienceFromWork(workExperiences) ||
    (!hasExperienceSection && !workExperiences.length && studentSignal ? 'Fresher / 0 years' : '')
  if (experience) extract.totalExperience = experience
  if (currentLocation) extract.currentLocation = currentLocation
  if (skills.length) extract.skills = skills
  if (experienceSummary) extract.experienceSummary = experienceSummary
  extract.workExperiences = workExperiences
  if (achievements.length) extract.achievements = achievements
  const metrics = pickMetrics(joined, workExperiences)
  extract.metrics = metrics
  if (certifications.length) extract.certifications = certifications
  extract.resumeText = clip(joined, 8000)

  return extract
}

export function cleanAndParseJson<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null
  // 1. Remove markdown fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  // 2. Extract outermost JSON object { ... }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return null
  let jsonString = match[0]

  // Try direct parse
  try {
    return JSON.parse(jsonString) as T
  } catch {
    // Attempt common LLM JSON repairs:
    // A. Remove trailing commas before } or ]
    jsonString = jsonString.replace(/,\s*([}\]])/g, '$1')
    // B. Replace unescaped literal newlines / carriage returns inside strings
    jsonString = jsonString.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m) =>
      m.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t'),
    )
    try {
      return JSON.parse(jsonString) as T
    } catch (finalErr) {
      console.warn('[ResumeParser] JSON repair parse error:', finalErr)
      return null
    }
  }
}

export function normalizeExperience(val: string): string {
  if (!val) return '2 – 3 Years'
  const trimmed = val.trim()
  const matched = [
    'Fresher / 0 years',
    '0 – 1 Years',
    '1 – 2 Years',
    '2 – 3 Years',
    '3 – 5 Years',
    '5 – 8 Years',
    '8 – 12 Years',
    '12+ Years',
  ].find(
    (opt) =>
      opt.toLowerCase() === trimmed.toLowerCase() ||
      opt.replace(/[–-]/g, '-').toLowerCase() === trimmed.replace(/[–-]/g, '-').toLowerCase(),
  )
  if (matched) return matched

  // Numeric detection
  const range = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:\+|to|–|-)\s*(\d+(?:\.\d+)?)\s*\+?\s*years?/i)
  const single = trimmed.match(/(\d+(?:\.\d+)?)\s*\+?\s*years?/i)
  const years = range
    ? (Number(range[1]) + Number(range[2])) / 2
    : single
      ? Number(single[1])
      : NaN

  if (Number.isNaN(years)) return trimmed
  if (years < 1) return 'Fresher / 0 years'
  if (years < 2) return '0 – 1 Years'
  if (years < 3) return '1 – 2 Years'
  if (years < 4) return '2 – 3 Years'
  if (years < 6) return '3 – 5 Years'
  if (years < 9) return '5 – 8 Years'
  if (years < 13) return '8 – 12 Years'
  return '12+ Years'
}

function formatAiExtract(parsed: Record<string, unknown>, rawText: string): ResumeExtract {
  let experiences: WorkExperience[] = []
  if (Array.isArray(parsed.workExperiences)) {
    experiences = parsed.workExperiences
      .map((w: Record<string, unknown>) => {
        const company = String(w.company || '').trim()
        const jobTitle = String(w.jobTitle || '').trim()
        // Anti-hallucination filter: ignore generic or placeholder company names
        if (
          !company ||
          /^(company|tech solutions|acme|unknown|n\/a|none|placeholder|not specified)$/i.test(company)
        ) {
          return null
        }
        const resumeLower = rawText.toLowerCase()
        if (/^techcitta$/i.test(company) && !resumeLower.includes('techcitta')) {
          return null
        }
        const compCompact = company.toLowerCase().replace(/[^a-z0-9]/g, '')
        const resumeCompact = resumeLower.replace(/[^a-z0-9]/g, '')
        const compClean = company.toLowerCase().replace(/[^a-z0-9]/g, ' ')
        const compWords = compClean.split(/\s+/).filter((word) => word.length > 2)
        const isPresentInText =
          (compCompact.length >= 4 && resumeCompact.includes(compCompact)) ||
          (compWords.length > 0 && compWords.some((word) => resumeLower.includes(word)))
        if (!isPresentInText) {
          return null
        }
        return {
          id: crypto.randomUUID(),
          jobTitle: clip(jobTitle || 'Software Engineer', 80),
          company: clip(company, 80),
          employmentType: 'Full-time' as const,
          startDate: String(w.startDate || ''),
          endDate: String(w.endDate || 'Present'),
          currentlyWorking: Boolean(
            w.currentlyWorking ?? /present|current|ongoing/i.test(String(w.endDate || '')),
          ),
          location: String(w.location || ''),
          responsibilities: clip(String(w.responsibilities || w.description || ''), 800),
        }
      })
      .filter(Boolean) as WorkExperience[]
  }
  if (!experiences.length) {
    experiences = pickWorkExperiences(rawText)
  }

  const aiSkills: string[] = Array.isArray(parsed.skills)
    ? parsed.skills.map(String).map((s: string) => s.trim()).filter(Boolean)
    : []
  const skills = aiSkills.length > 0 ? aiSkills : pickSkills(rawText)

  const aiAchievements: string[] = Array.isArray(parsed.achievements)
    ? parsed.achievements.map(String).map((a: string) => clip(a.trim(), 180)).filter(Boolean)
    : []
  const achievements = aiAchievements.length > 0 ? aiAchievements : pickAchievements(rawText)

  let certifications: Certification[] = []
  if (Array.isArray(parsed.certifications)) {
    certifications = parsed.certifications
      .map((c: Record<string, unknown>) => {
        const name = String(c.name || c.title || '').trim()
        const organization = String(c.organization || c.issuer || '').trim()
        if (!name || name.length < 2) return null
        const nameClean = name.toLowerCase().replace(/[^a-z0-9]/g, ' ')
        const nameWords = nameClean.split(/\s+/).filter((w) => w.length > 2)
        const isPresent = nameWords.some((w) => rawText.toLowerCase().includes(w))
        if (!isPresent) return null
        return {
          id: crypto.randomUUID(),
          name: clip(name, 100),
          organization: clip(organization, 100),
          dateEarned: parseDateToMonthYear(String(c.dateEarned || c.date || '')),
          credentialId: clip(String(c.credentialId || ''), 60),
        }
      })
      .filter(Boolean) as Certification[]
  }
  if (!certifications.length) {
    certifications = pickCertifications(rawText)
  }

  const rawName = String(parsed.fullName || '').trim()
  const isGeneric = !rawName || /^(candidate|name|full\s*name|resume|curriculum\s*vitae|not\s*specified)$/i.test(rawName)
  const fullName = !isGeneric ? rawName : (extractNameFromText(rawText) || undefined)

  const extract: ResumeExtract = {}
  if (fullName) extract.fullName = fullName
  if (parsed.whoAreYou) extract.whoAreYou = clip(String(parsed.whoAreYou).trim(), 300)
  if (parsed.whatDrivesYou) extract.whatDrivesYou = clip(String(parsed.whatDrivesYou).trim(), 300)
  if (parsed.keyStrengths) extract.keyStrengths = clip(String(parsed.keyStrengths).trim(), 250)

  if (parsed.currentRole) {
    const rawRole = String(parsed.currentRole).trim()
    extract.currentRole =
      ROLE_OPTIONS.find((r) => r.toLowerCase() === rawRole.toLowerCase()) ||
      ROLE_OPTIONS.find((r) => rawRole.toLowerCase().includes(r.toLowerCase())) ||
      rawRole
  } else {
    extract.currentRole = pickRole(rawText) || undefined
  }

  if (parsed.totalExperience) {
    extract.totalExperience = normalizeExperience(String(parsed.totalExperience))
  } else {
    // Never invent a value: an invented "2 – 3 Years" changes the interview difficulty for every fresher.
    extract.totalExperience = pickExperience(rawText) || experienceFromWork(experiences) || undefined
  }

  if (parsed.currentLocation) {
    const rawLoc = String(parsed.currentLocation).trim()
    extract.currentLocation =
      LOCATION_OPTIONS.find((l) => l.toLowerCase() === rawLoc.toLowerCase()) ||
      LOCATION_OPTIONS.find((l) => rawLoc.toLowerCase().includes(l.toLowerCase())) ||
      rawLoc
  } else {
    extract.currentLocation = pickLocation(rawText) || undefined
  }

  if (skills.length) extract.skills = skills
  if (parsed.experienceSummary) {
    extract.experienceSummary = clip(String(parsed.experienceSummary).trim(), 500)
  }
  if (experiences.length) extract.workExperiences = experiences
  if (achievements.length) extract.achievements = achievements
  extract.metrics = mapAiMetrics(parsed, rawText, experiences)
  if (certifications.length) extract.certifications = certifications
  extract.resumeText = clip(rawText, 12000)

  return extract
}

/**
 * High-accuracy AI Resume Parser powered by Google Gemini
 */
export async function parseResumeWithAI(text: string): Promise<ResumeExtract | null> {
  const apiKey = clientLlmAllowed()
    ? import.meta.env.VITE_GEMINI_API_KEY || ''
    : ''
  const isBrowser = typeof window !== 'undefined'

  const prompt = `You are an expert HR AI Resume Parser for HireRight powered by Google Gemini. Extract structured profile information from this resume text into strictly valid JSON only.

STRICT ANTI-HALLUCINATION RULES:
1. ONLY extract information that is explicitly stated in the resume text below.
2. If the candidate is a fresher, student, or has NO prior formal work experience/employment in the resume, "workExperiences" MUST be an empty array [].
3. DO NOT convert academic/personal projects or university coursework into professional work experiences unless explicitly listed under a "Work Experience" / "Employment" section.
4. NEVER invent or hallucinate company names or job titles. NEVER output placeholder companies like "TechCitta", "Tech Solutions", "Company", "Acme", etc.
5. If you cannot find any formal company employment, return "workExperiences": [].
6. Under "certifications", extract technical certifications, licenses, or courses explicitly stated. If none are present, return "certifications": [].
7. Under "metrics", extract quantified impact ONLY when the resume explicitly states numbers, percentages, or measurable outcomes (e.g. bullet points with %, revenue, latency, users). Do NOT invent KPIs. If none exist, return "metrics": [].

JSON Schema:
{
  "fullName": "Full name of candidate",
  "currentRole": "Standardized job title matching industry roles (e.g. Full Stack Developer, Frontend Developer, Backend Developer, Software Engineer)",
  "totalExperience": "Standardized range (e.g. '0-1 Years', '1-2 Years', '2-3 Years', '3-5 Years', '5-8 Years', '8-12 Years', '12+ Years')",
  "currentLocation": "City, Country or Remote (e.g. Bengaluru, Hyderabad, Pune, Mumbai, Remote)",
  "skills": ["Array", "of", "technical", "skills", "tools", "languages"],
  "whoAreYou": "A polished 2-3 sentence executive summary introducing the candidate and their engineering background",
  "whatDrivesYou": "A 1-2 sentence statement on what drives their engineering work and growth",
  "keyStrengths": "Top technical competencies and strengths",
  "experienceSummary": "Comprehensive summary of career accomplishments and engineering background",
  "workExperiences": [
    {
      "jobTitle": "Job Title",
      "company": "Company Name",
      "employmentType": "Full-time",
      "startDate": "YYYY-MM or Year",
      "endDate": "YYYY-MM or Present",
      "currentlyWorking": true,
      "location": "City, Country or Remote",
      "responsibilities": "Key impact and responsibilities formatted with bullet points"
    }
  ],
  "achievements": [
    "Key achievement 1 with metrics",
    "Key achievement 2"
  ],
  "metrics": [
    {
      "metric": "Short KPI or outcome label from the resume",
      "contribution": "What the candidate did",
      "impact": "Quantified result (e.g. 35%, $2M, 2x)",
      "timePeriod": "Date range if stated, else empty string"
    }
  ],
  "certifications": [
    {
      "name": "Certification or Course Name",
      "organization": "Issuing Organization or Platform",
      "dateEarned": "YYYY-MM or Year",
      "credentialId": "Credential ID if provided"
    }
  ]
}

Resume Text:
${text.slice(0, 12000)}`

  // 1. Node API (required in production — server holds LLM keys)
  if (isBrowser) {
    try {
      await ensureApiSession()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12_000)
      const res = await apiFetch('/api/resume/parse', {
        method: 'POST',
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) {
        const data = await res.json()
        if (data.ok && data.extract) {
          return formatAiExtract(data.extract, text)
        }
      }
    } catch (err) {
      console.warn('[ResumeParser] Backend /api/resume/parse error:', err)
    }
  }

  // 2. Direct call via /ai-proxy (local dev only)
  if (isBrowser && apiKey) {
    try {
      const res = await fetch('/ai-proxy/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model: CLIENT_GEMINI_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are a high-precision JSON-only resume extraction AI. Return ONLY valid JSON matching the requested schema with no markdown or explanation.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content || ''
        const parsed = cleanAndParseJson<Record<string, unknown>>(content)
        if (parsed) {
          return formatAiExtract(parsed, text)
        }
      }
    } catch (err) {
      console.warn('[ResumeParser] Direct /ai-proxy Google Gemini error, trying backend route:', err)
    }
  }

  // 3. Direct fetch to Gemini URL (local dev only)
  if (apiKey) {
    try {
      const directUrl = (
        import.meta.env.VITE_GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
      ).replace(/\/$/, '')
      const res = await fetch(`${directUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model: CLIENT_GEMINI_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a JSON-only resume parsing engine. Output ONLY valid JSON.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content || ''
        const parsed = cleanAndParseJson<Record<string, unknown>>(content)
        if (parsed) {
          return formatAiExtract(parsed, text)
        }
      }
    } catch (err) {
      console.warn('[ResumeParser] Direct API fallback failed:', err)
    }
  }

  return null
}

const RESUME_AI_PARSE_MS = 12_000

/**
 * Combine the deterministic parse with the AI parse.
 *
 * The deterministic parse is the base: it only reports what is literally on the page, so it is never overwritten
 * by an AI value (or an AI default). The AI fills fields the deterministic parse could not find, adds skills the
 * candidate listed, and supplies the polished narrative text.
 */
function mergeAiWithRegex(text: string, aiExtract: ResumeExtract, regexFallback: ResumeExtract): ResumeExtract {
  const has = (v: unknown) => (typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : Boolean(v))
  const firstJobOk = (regexFallback.workExperiences || []).some((w) => w.jobTitle && w.company)

  const merged: ResumeExtract = { ...aiExtract, ...regexFallback }
  for (const key of ['fullName', 'currentRole', 'totalExperience', 'currentLocation'] as const) {
    const value = has(regexFallback[key]) ? regexFallback[key] : aiExtract[key]
    if (has(value)) merged[key] = value
    else delete merged[key]
  }
  merged.skills = mergeSkills(regexFallback.skills || [], aiExtract.skills || [])
  merged.workExperiences = firstJobOk
    ? regexFallback.workExperiences
    : has(aiExtract.workExperiences)
      ? aiExtract.workExperiences
      : regexFallback.workExperiences
  merged.certifications = has(regexFallback.certifications) ? regexFallback.certifications : aiExtract.certifications
  merged.achievements = has(regexFallback.achievements) ? regexFallback.achievements : aiExtract.achievements
  merged.metrics = has(regexFallback.metrics) ? regexFallback.metrics : aiExtract.metrics
  for (const key of ['whoAreYou', 'whatDrivesYou', 'keyStrengths', 'experienceSummary'] as const) {
    const value = has(aiExtract[key]) ? aiExtract[key] : regexFallback[key]
    if (has(value)) merged[key] = value
  }
  merged.resumeText = clip(text, 12000)
  return merged
}

export async function parseResumeFile(file: File): Promise<ResumeExtract> {
  const text = await extractResumeText(file)
  if (!text.trim()) {
    throw new Error('Could not read text from this file. Please ensure the file contains selectable text, or try a DOCX/TXT.')
  }

  const regexFallback = parseResumeText(text)
  if (!regexFallback.resumeText) regexFallback.resumeText = clip(text, 8000)

  let aiExtract: ResumeExtract | null = null
  try {
    aiExtract = await Promise.race([
      parseResumeWithAI(text),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RESUME_AI_PARSE_MS)),
    ])
  } catch (err) {
    console.warn('[ResumeParser] AI parsing fallback to local regex:', err)
  }

  if (aiExtract && (aiExtract.fullName || (aiExtract.skills && aiExtract.skills.length > 0))) {
    return mergeAiWithRegex(text, aiExtract, regexFallback)
  }

  return regexFallback
}

