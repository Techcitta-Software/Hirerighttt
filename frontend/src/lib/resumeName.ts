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

/**
 * "PRIYA" / "priya" -> "Priya", "D'SOUZA" -> "D'Souza". A name that already mixes cases ("McDonald",
 * "DeSouza", "K.") is exactly what the person wrote, so it is left alone.
 */
function fixNameCase(word: string): string {
  const letters = word.replace(/[^A-Za-z]/g, '')
  if (letters.length <= 1) return word
  const mixed = letters !== letters.toUpperCase() && letters !== letters.toLowerCase()
  if (mixed) return word
  return word
    .toLowerCase()
    .replace(/(^|['\-.])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}
