import { ROLE_OPTIONS } from '../data/wizard'

/**
 * Name / role helpers from the resume parser that have no heavy dependencies. store.ts needs
 * extractNameFromText on every page; keeping it here means the full parser (and the PDF / DOCX
 * libraries it loads) is not part of the initial bundle. resumeParser.ts re-exports these.
 */

export function pickRole(text: string): string {
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

const NOT_NAME_WORDS =
  /^(?:engineers?|developers?|managers?|analysts?|designers?|architects?|consultants?|scientists?|interns?|specialists?|administrators?|executives?|programmers?|testers?|recruiters?|associates?|senior|junior|lead|principal|software|frontend|backend|full|stack|fullstack|devops|cloud|web|mobile|data|python|java|javascript|typescript|react|node|aws|sql|ai|ml|llms?|rag|resume|curriculum|vitae|profile|summary|objective|skills|education|experience|apis?|sdks?|gemini|google|bedrock|amazon|openai|gpt|chatgpt|claude|anthropic|nlp|crewai|langchain|fastapi|django|flask|spring|postgres(?:ql)?|mysql|mongodb|redis|docker|kubernetes|azure|gcp|linux|git|github|gitlab|html|css|streamlit|opencv|tensorflow|pytorch|keras|pandas|numpy|microsoft|excel|tableau|powerbi|generative|agentic|machine|learning|vision|computer|lambda|serverless|kafka|graphql|rest|json|jwt|oauth|figma|jira|salesforce|oracle|bachelor|master|technology|university|institute|college|school|india|hyderabad|bengaluru|bangalore|chennai|mumbai|pune|delhi|kolkata|noida|gurgaon|gurugram|certifications?|projects?|languages?|strengths?|core|contact|location|present|looking)$/i

const EMAIL = /([A-Za-z0-9._%+-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const CAP_WORD = /\b([A-Z][a-z]{2,}|[A-Z]{3,})\b/g

/**
 * Capitalised words of the resume that are also part of an email address's local part, in text order. Email
 * addresses almost always contain the person's name ("pachimatlabharath28@..."), so these words confirm a surname on
 * its own line, or locate the name when a two-column PDF is read out of order. Mirrors backend candidate_name.py.
 */
function emailNameWords(text: string, scope: string = text): string[] {
  const locals = [...text.matchAll(EMAIL)].map((m) => m[1].toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean)
  if (!locals.length) return []
  const found: string[] = []
  for (const m of scope.slice(0, 6000).matchAll(CAP_WORD)) {
    const word = m[1]
    const low = word.toLowerCase()
    if (NOT_NAME_WORDS.test(low) || found.some((f) => f.toLowerCase() === low)) continue
    if (locals.some((loc) => loc.includes(low))) found.push(word)
  }
  return found
}

/** "Souza" is already part of "D'Souza": a word inside an existing name word is not a new name part. */
function alreadyInName(words: string[], extra: string): boolean {
  const e = extra.toLowerCase()
  return words.some((w) => w.toLowerCase().replace(/[^a-z]/g, '').includes(e))
}

function nameFromEmailHint(text: string): string | null {
  const hints = emailNameWords(text)
  if (!hints.length) return null
  const tokens = text.slice(0, 6000).match(/[A-Za-z][A-Za-z.'-]*|\S/g) ?? []
  const start = tokens.findIndex((t) => t.toLowerCase() === hints[0].toLowerCase())
  if (start < 0) return null
  const run = [tokens[start]]
  for (let j = start + 1; j < tokens.length && run.length < 4; j += 1) {
    const next = tokens[j]
    const follower = tokens[j + 1] ?? ''
    if (!/^(?:[A-Z][a-z]+|[A-Z]{2,})$/.test(next) || NOT_NAME_WORDS.test(next)) break
    if (/^[a-z]+$/.test(follower)) break // "Looking to build": a sentence starts here, not a name
    run.push(next)
  }
  for (const extra of hints.slice(1)) {
    if (run.length >= 4) break
    if (!alreadyInName(run, extra)) run.push(extra)
  }
  const candidate = run.join(' ')
  return run.length >= 2 && looksLikePersonName(candidate) ? normalizePersonName(candidate) : null
}

function extendWithEmailHint(name: string, text: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  const head = text.replace(/\r/g, '\n').split('\n').slice(0, 15).join('\n')
  for (const extra of emailNameWords(text, head)) {
    if (words.length >= 4) break
    if (!alreadyInName(words, extra)) words.push(extra)
  }
  return normalizePersonName(words.join(' '))
}

/**
 * The name at the top of a resume, or null. A surname on its own line, or a two-column resume read out of order
 * ("Google Gemini API" before the name), is recovered with the email address.
 */
export function extractNameFromText(text: string): string | null {
  if (!text || typeof text !== 'string') return null
  const top = nameFromTopLines(text)
  if (top) return extendWithEmailHint(top, text)
  return nameFromEmailHint(text)
}

function nameFromTopLines(text: string): string | null {
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  for (const rawLine of lines.slice(0, 10)) {
    // 1. Check if line explicitly has "Name: John Doe" or "Full Name: John Doe"
    const namePrefixMatch = rawLine.match(/(?:^|\b)(?:full\s*name|name)\s*[:-]\s*([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){1,3})/i)
    if (namePrefixMatch && !namePrefixMatch[1].split(/\s+/).some((w) => NOT_NAME_WORDS.test(w))) {
      return normalizePersonName(namePrefixMatch[1])
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
      words.length <= 5 &&
      words.every((w) => /^[A-Za-z.'-]+$/.test(w) && (w.length >= 2 || /^[A-Z]$/.test(w))) &&
      words.filter((w) => w.length >= 2).length >= 1
    ) {
      return words.map(fixNameCase).join(' ')
    }

    // Also accept 1 capitalized name if next line is a role/title
    if (
      words.length === 1 &&
      /^[A-Za-z]{3,}$/.test(words[0]) &&
      !/^(engineer|developer|manager|resume|contact|profile|summary|skills|projects)$/i.test(words[0]) &&
      lines.length > 1 &&
      pickRole(lines[1])
    ) {
      return fixNameCase(words[0])
    }
  }
  return null
}

/** "KAVYA  IYER" -> "Kavya Iyer"; names that already mix cases ("McDonald", "K. Rao") stay as written. */
export function normalizePersonName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(fixNameCase)
    .join(' ')
}

/** True for a short run of name-like words that is not a job title, a technology or a section heading. */
export function looksLikePersonName(value: string | null | undefined): boolean {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 5) return false
  if (!words.every((w) => /^[A-Za-z.'-]+$/.test(w))) return false
  if (words.some((w) => NOT_NAME_WORDS.test(w.replace(/\./g, '')))) return false
  if (/summary|objective|profile|experience|education|skills|projects|contact|declaration|email|phone/i.test(words.join(' '))) return false
  return words.some((w) => w.replace(/[^A-Za-z]/g, '').length >= 2)
}

/**
 * "PRIYA" / "priya" -> "Priya", "D'SOUZA" -> "D'Souza". A name that already mixes cases ("McDonald",
 * "DeSouza", "K.") is exactly what the person wrote, so it is left alone.
 */
function fixNameCase(word: string): string {
  const letters = word.replace(/[^A-Za-z]/g, '')
  if (letters.length <= 1) return word.length === 1 ? word.toUpperCase() : word
  const mixed = letters !== letters.toUpperCase() && letters !== letters.toLowerCase()
  if (mixed) return word
  return word
    .toLowerCase()
    .replace(/(^|['\-.])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}
