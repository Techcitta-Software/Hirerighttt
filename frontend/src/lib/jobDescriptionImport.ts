import { extractResumeText } from './resumeParser'

export const JOB_EXPERIENCE_LEVELS = ['0-2 years', '3-5 years', '6+ years'] as const
export type JobExperienceLevel = (typeof JOB_EXPERIENCE_LEVELS)[number]

export type ParsedJobDescription = {
  title: string
  location: string
  experienceLevel: JobExperienceLevel | ''
  skills: string[]
  description: string
}

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_DESCRIPTION = 12_000

const TITLE_LABEL = /^(?:job\s*title|position(?:\s*title)?|role(?:\s*title)?|opening)\s*[:\-–]\s*(.+)$/i
const LOCATION_LABEL = /^(?:location|work location|office|based in)\s*[:\-–]\s*(.+)$/i
const EXPERIENCE_LABEL = /^(?:experience|years of experience|exp\.?)\s*[:\-–]\s*(.+)$/i
const SKILLS_LABEL = /^(?:required skills|key skills|skills|tech stack|must[- ]haves?)\s*[:\-–]\s*(.*)$/i
const SECTION_HEADER =
  /^(?:job description|about the role|about this role|overview|responsibilities|requirements|qualifications|what you(?:'|’)ll do|who you are|about us|benefits)\b[:\-–]?\s*$/i

function cleanLine(line: string): string {
  return line.replace(/^[\s>*•\-–]+/, '').replace(/\s+/g, ' ').trim()
}

function bucketYears(years: number): JobExperienceLevel {
  if (years < 3) return '0-2 years'
  if (years <= 5) return '3-5 years'
  return '6+ years'
}

export function experienceFromText(raw: string): JobExperienceLevel | '' {
  const text = raw.toLowerCase()
  const range = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/)
  if (range) return bucketYears((Number(range[1]) + Number(range[2])) / 2)
  const plus = text.match(/(\d+)\s*\+/)
  if (plus) {
    const years = Number(plus[1])
    // "5+ years" is the senior band; the mid-level choice stops at 5.
    if (years >= 5) return '6+ years'
    return bucketYears(years)
  }
  const years = text.match(/(\d+)\s*(?:years|yrs)/)
  if (years) return bucketYears(Number(years[1]))
  if (/\b(senior|lead|principal|staff)\b/.test(text)) return '6+ years'
  if (/\b(junior|fresher|entry|intern|graduate)\b/.test(text)) return '0-2 years'
  if (/\bmid[- ]?level\b/.test(text)) return '3-5 years'
  return ''
}

function splitSkills(raw: string): string[] {
  return raw
    .split(/[,;|/•]+|\band\b/i)
    .map((part) => part.replace(/^[\s>*•\-–]+/, '').trim())
    .filter((part) => part.length >= 2 && part.length <= 40 && !/[.!?]$/.test(part))
    .slice(0, 16)
}

function isSkillBullet(line: string): boolean {
  const text = cleanLine(line)
  return text.length >= 2 && text.length <= 40 && !/[.!?]$/.test(text) && !SECTION_HEADER.test(text)
}

/** Pull title, location, experience, skills and the full text out of a job description. */
export function parseJobDescription(raw: string): ParsedJobDescription {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1].length > 0))

  let title = ''
  let location = ''
  let experienceLevel: JobExperienceLevel | '' = ''
  const skills: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    const titleMatch = line.match(TITLE_LABEL)
    if (titleMatch && !title) {
      title = cleanLine(titleMatch[1])
      continue
    }
    const locationMatch = line.match(LOCATION_LABEL)
    if (locationMatch && !location) {
      location = cleanLine(locationMatch[1])
      continue
    }
    const experienceMatch = line.match(EXPERIENCE_LABEL)
    if (experienceMatch && !experienceLevel) {
      experienceLevel = experienceFromText(experienceMatch[1])
      continue
    }
    const skillsMatch = line.match(SKILLS_LABEL)
    if (skillsMatch && skills.length === 0) {
      skills.push(...splitSkills(skillsMatch[1]))
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j]
        if (!next || SECTION_HEADER.test(next) || TITLE_LABEL.test(next) || LOCATION_LABEL.test(next)) break
        if (!/^[\s>*•\-–]/.test(next) && !isSkillBullet(next)) break
        if (!isSkillBullet(next)) break
        skills.push(cleanLine(next))
        i = j
      }
    }
  }

  if (!title) {
    const first = lines.find((line) => line && !SECTION_HEADER.test(line) && line.length <= 80)
    title = first ? cleanLine(first).replace(/[:\-–]\s*$/, '') : ''
  }
  if (!experienceLevel) experienceLevel = experienceFromText(raw.slice(0, 1500))

  const description = raw.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

  return {
    title,
    location,
    experienceLevel,
    skills: Array.from(new Set(skills.map((skill) => skill.trim()))).filter(Boolean).slice(0, 16),
    description: description.length > MAX_DESCRIPTION ? description.slice(0, MAX_DESCRIPTION) : description,
  }
}

export function isJobDescriptionFile(file: Pick<File, 'name' | 'type'>): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase()
  return (
    ext === 'pdf' ||
    ext === 'docx' ||
    file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

/** Read a PDF or Word job description and turn it into form fields. */
export async function readJobDescriptionFile(file: File): Promise<ParsedJobDescription> {
  if (!isJobDescriptionFile(file)) {
    throw new Error('Upload a PDF or Word (.docx) file.')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Use a PDF or Word file under 8 MB.')
  }
  const text = (await extractResumeText(file)).replace(/\u0000/g, '').trim()
  if (text.length < 30) {
    throw new Error('Could not read enough text. Use a PDF or Word file with selectable text, not a scanned image.')
  }
  return parseJobDescription(text)
}
