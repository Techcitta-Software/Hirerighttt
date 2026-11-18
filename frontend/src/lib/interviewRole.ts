import { latestJob, type ExperienceJob } from './resumeExperience'

/** Only when the resume shows no job title at all. */
export const DEFAULT_INTERVIEW_ROLE = 'General Professional'

type RoleProfile = {
  currentRole?: string
  workExperiences?: ExperienceJob[]
} | null | undefined

function tidy(title: string | undefined): string {
  return String(title || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s|,;:–-]+|[\s|,;:–-]+$/g, '')
    .trim()
}

/**
 * The interview role is the candidate's most recent job title, exactly as written on the resume.
 *
 *  1. The latest real job (internships excluded). When the parser's currentRole is that same title without the
 *     city/country, the cleaned currentRole is used.
 *  2. No real job: currentRole (the parser takes the headline title under the name).
 *  3. Only internships: the latest internship title.
 *  4. Nothing on the resume: a neutral default. Never a guessed technical role.
 */
export function interviewRoleFromProfile(profile: RoleProfile): string {
  const jobs = Array.isArray(profile?.workExperiences) ? profile!.workExperiences : []
  const current = tidy(profile?.currentRole)
  const latest = tidy(latestJob(jobs, true)?.jobTitle)
  if (latest) {
    return current && latest.toLowerCase().startsWith(current.toLowerCase()) ? current : latest
  }
  if (current) return current
  return tidy(latestJob(jobs)?.jobTitle) || DEFAULT_INTERVIEW_ROLE
}
