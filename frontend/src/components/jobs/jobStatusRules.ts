import type { VendorJobStatus } from '../../lib/vendorApi'

/** What the recruiter reads for each status (badge text). */
export const JOB_STATUS_LABEL: Record<VendorJobStatus, string> = {
  draft: 'Unpublished',
  published: 'Accepting applications',
  closed: 'Closed',
  archived: 'Archived',
}

export type JobStatusAction = {
  key: 'close' | 'reopen' | 'unpublish' | 'publish'
  to: VendorJobStatus
  label: string
  /** Confirm dialog copy. */
  title: (jobTitle: string) => string
  body: string
  confirmLabel: string
  busyLabel: string
  danger: boolean
  done: (jobTitle: string) => string
}

const CLOSE: JobStatusAction = {
  key: 'close',
  to: 'closed',
  label: 'Close job',
  title: (t) => `Close “${t}”?`,
  body:
    'The job leaves the job board and its apply link shows “This job is no longer accepting applications”. ' +
    'Current applicants, their interviews and reports stay here. You can reopen it at any time.',
  confirmLabel: 'Close job',
  busyLabel: 'Closing…',
  danger: true,
  done: (t) => `“${t}” is closed. It no longer accepts applications.`,
}

const REOPEN: JobStatusAction = {
  key: 'reopen',
  to: 'published',
  label: 'Reopen',
  title: (t) => `Reopen “${t}”?`,
  body: 'The job goes back on the job board and its apply link accepts applications again.',
  confirmLabel: 'Reopen job',
  busyLabel: 'Reopening…',
  danger: false,
  done: (t) => `“${t}” is open again and accepting applications.`,
}

const UNPUBLISH: JobStatusAction = {
  key: 'unpublish',
  to: 'draft',
  label: 'Unpublish',
  title: (t) => `Unpublish “${t}”?`,
  body:
    'The job is taken off the job board and its apply link stops accepting applications while you rework it. ' +
    'Applicants and reports stay here. Publish it again when it is ready.',
  confirmLabel: 'Unpublish',
  busyLabel: 'Unpublishing…',
  danger: false,
  done: (t) => `“${t}” is unpublished. Publish it again when it is ready.`,
}

const PUBLISH: JobStatusAction = {
  key: 'publish',
  to: 'published',
  label: 'Publish',
  title: (t) => `Publish “${t}”?`,
  body: 'The job appears on the job board and its apply link starts accepting applications.',
  confirmLabel: 'Publish',
  busyLabel: 'Publishing…',
  danger: false,
  done: (t) => `“${t}” is published and accepting applications.`,
}

/** Status moves offered for a job, most likely first. Mirrors the API's allowed transitions. */
export function jobStatusActions(status: VendorJobStatus): JobStatusAction[] {
  switch (status) {
    case 'published':
      return [CLOSE, UNPUBLISH]
    case 'closed':
      return [REOPEN]
    case 'draft':
      return [PUBLISH]
    default:
      return []
  }
}

export type JobEditDraft = {
  title: string
  roleTrack: string
  experienceLevel: string
  location: string
  jobDescription: string
  skills: string
}

/** Client-side checks with the same limits as the API; returns the first problem, or ''. */
export function validateJobEdit(d: JobEditDraft): string {
  if (!d.title.trim()) return 'Enter a job title.'
  if (d.title.trim().length > 200) return 'The title can be at most 200 characters.'
  if (!d.roleTrack.trim()) return 'Choose a role.'
  if (!d.experienceLevel.trim()) return 'Choose the years of experience.'
  if (!d.location.trim()) return 'Enter a location.'
  const jd = d.jobDescription.trim().length
  if (jd < 30) return `The job description needs at least 30 characters (${jd}/30).`
  if (jd > 20000) return 'The job description can be at most 20,000 characters.'
  const skills = splitSkills(d.skills)
  if (!skills.length) return 'Add at least one skill.'
  if (skills.length > 40) return 'Add at most 40 skills.'
  return ''
}

export function splitSkills(raw: string): string[] {
  return Array.from(new Set(raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)))
}

/** Only the fields that changed, so an unchanged form sends nothing. */
export function jobEditPatch(
  job: { title: string; roleTrack: string; experienceLevel: string; location: string; jobDescription: string; requiredSkills: string[] },
  d: JobEditDraft,
) {
  const patch: Record<string, unknown> = {}
  if (d.title.trim() !== job.title) patch.title = d.title.trim()
  if (d.roleTrack.trim() !== job.roleTrack) patch.roleTrack = d.roleTrack.trim()
  if (d.experienceLevel.trim() !== job.experienceLevel) patch.experienceLevel = d.experienceLevel.trim()
  if (d.location.trim() !== job.location) patch.location = d.location.trim()
  if (d.jobDescription.trim() !== job.jobDescription.trim()) patch.jobDescription = d.jobDescription.trim()
  const skills = splitSkills(d.skills)
  if (skills.join('\n') !== job.requiredSkills.join('\n')) patch.requiredSkills = skills
  return patch
}
