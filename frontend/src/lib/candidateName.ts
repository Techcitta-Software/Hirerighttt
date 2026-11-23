import { extractNameFromText, looksLikePersonName, normalizePersonName } from './resumeName'

/**
 * The candidate's display name. One rule for the whole site, identical to the backend
 * (backend/app/services/candidate_name.py):
 *
 *  1. The name written on the candidate's resume ALWAYS wins (over the signup name or a name typed elsewhere):
 *     the parsed resume name (`resumeFullName`) when it is really written on the resume, else the name read from the
 *     top of the resume text, else a saved name that is written on the resume.
 *  2. Only without a resume name: the signup (account) name, then a saved profile name, then a name guessed from
 *     the resume file name, then "Candidate".
 *
 * All-caps resume names are Title-Cased ("KAVYA IYER" -> "Kavya Iyer").
 */

export const DEMO_DISPLAY_NAME = 'Arjun Sharma'
export const CANDIDATE_FALLBACK = 'Candidate'

export type NameProfile = {
  fullName?: string | null
  name?: string | null
  resumeFullName?: string | null
  resumeText?: string | null
  resumeName?: string | null
  resumeUrl?: string | null
  resumeStoragePath?: string | null
} | null | undefined

function clean(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

export function isDemoName(value: unknown): boolean {
  return clean(value).toLowerCase() === DEMO_DISPLAY_NAME.toLowerCase()
}

/** Lower-cased name words, ignoring punctuation. "Bharath Krishna  P." -> ["bharath","krishna"]. */
export function nameWords(value: unknown): string[] {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
}

/** True when every word of `name` is written near the top of the resume. */
export function nameInResume(name: unknown, text: unknown): boolean {
  const words = nameWords(name)
  if (!words.length) return false
  const head = new Set(nameWords(String(text ?? '').split(/\r?\n/).slice(0, 15).join('\n')))
  return words.every((w) => head.has(w))
}

function hasResumeFile(p: NonNullable<NameProfile>): boolean {
  return Boolean(clean(p.resumeName) || clean(p.resumeUrl) || clean(p.resumeStoragePath))
}

/** The name on the candidate's current resume, or '' when there is no resume or no readable name on it. */
export function resumeNameOf(profile: NameProfile): string {
  const p = profile ?? {}
  const text = String(p.resumeText ?? '')
  const parsed = clean(p.resumeFullName)
  if (text.trim()) {
    if (parsed && looksLikePersonName(parsed) && nameInResume(parsed, text)) return normalizePersonName(parsed)
    const fromText = clean(extractNameFromText(text))
    if (fromText) return normalizePersonName(fromText)
    for (const saved of [p.fullName, p.name]) {
      const s = clean(saved)
      if (s && !isDemoName(s) && looksLikePersonName(s) && nameInResume(s, text)) return normalizePersonName(s)
    }
    return ''
  }
  if (parsed && looksLikePersonName(parsed) && hasResumeFile(p)) return normalizePersonName(parsed)
  return ''
}

function nameFromResumeFile(fileName: unknown): string {
  const words = clean(fileName)
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]/g, ' ')
    .replace(/\b(resume|cv|biodata|profile|fullstack|frontend|backend|engineer|developer)\b/gi, '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2 && /^[A-Za-z]+$/.test(w))
  if (words.length >= 2 && words.length <= 4) {
    return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  }
  return ''
}

/** The candidate's name everywhere: the resume name, else the signup name, else a saved name, else 'Candidate'. */
export function resolveCandidateNameFrom(
  profile: NameProfile,
  account: { name?: string | null } | string | null | undefined,
): string {
  const fromResume = resumeNameOf(profile)
  if (fromResume) return fromResume
  const acct = clean(typeof account === 'string' ? account : account?.name)
  if (acct && acct !== CANDIDATE_FALLBACK) return acct
  const saved = clean(profile?.fullName) || clean(profile?.name)
  if (saved && saved !== CANDIDATE_FALLBACK) return saved
  return nameFromResumeFile(profile?.resumeName) || CANDIDATE_FALLBACK
}

/** First word of a display name, or 'there' when there is no real name. */
export function firstWordOf(full: string): string {
  const n = clean(full)
  if (!n || n === CANDIDATE_FALLBACK || n === 'there') return 'there'
  return n.split(' ')[0]
}
