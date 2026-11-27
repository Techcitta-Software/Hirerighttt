import { latestJob, type ExperienceJob } from './resumeExperience'
import type { EducationEntry } from './store'

/** Latest work experience as "title, company" (a present job wins). Empty when there is no titled job. */
export function deriveCompanyTitle(works: readonly ExperienceJob[] | null | undefined): string {
  const job = latestJob([...(works || [])])
  if (!job) return ''
  const title = (job.jobTitle || '').trim()
  const company = (job.company || '').trim()
  if (title && company) return `${title}, ${company}`
  return title || company
}

/** First education entry as "degree, institution". */
export function deriveHighestEducation(
  education: readonly Pick<EducationEntry, 'degree' | 'institution'>[] | null | undefined,
): string {
  const first = (education || []).find((entry) => (entry.degree || '').trim() || (entry.institution || '').trim())
  if (!first) return ''
  const degree = (first.degree || '').trim()
  const institution = (first.institution || '').trim()
  if (degree && institution) return `${degree}, ${institution}`
  return degree || institution
}
