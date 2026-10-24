import type { SavedProfile, User } from './store'
import { getInterviewResult } from './store'

export type ProfileSectionId =
  | 'basics'
  | 'role'
  | 'skills'
  | 'resume'
  | 'preferences'
  | 'about'
  | 'experience'
  | 'performance'
  | 'interview'

export type ProfileFieldCheck = {
  label: string
  done: boolean
  /** Counts toward the completion % and “items to go”. */
  required: boolean
  section: ProfileSectionId
  hint: string
  icon: 'user' | 'map-pin' | 'briefcase' | 'chart' | 'sparkle' | 'document' | 'calendar'
  /** Deep link when section is not on /profile alone. */
  href?: string
}

function isFresherExperienceLabel(total?: string): boolean {
  const t = (total || '').trim().toLowerCase()
  return (
    t.includes('fresher') ||
    /\b0\s*[-–]\s*1\b/.test(t) ||
    /\b0\s*years?\b/.test(t)
  )
}

function hasFilledWorkExperience(
  profile: SavedProfile | null | undefined,
): boolean {
  const rows = profile?.workExperiences ?? []
  return rows.some(
    (w) =>
      Boolean(w.jobTitle?.trim()) ||
      Boolean(w.company?.trim()) ||
      Boolean(w.responsibilities?.trim()),
  )
}

function workExperienceComplete(profile: SavedProfile | null | undefined): boolean {
  if (!profile) return false
  if (profile.noPriorWorkExperience === true) return true
  if (isFresherExperienceLabel(profile.totalExperience) && !hasFilledWorkExperience(profile)) {
    return true
  }
  return hasFilledWorkExperience(profile)
}

function workExperienceHint(profile: SavedProfile | null | undefined): string {
  if (!profile?.resumeText?.trim()) {
    return 'Add employers and roles in onboarding, or mark yourself as fresher.'
  }
  const resume = profile.resumeText
  const mentionsJobs =
    /\b(work\s+experience|professional\s+experience|employment|internship)/i.test(resume) &&
    /\b(19|20)\d{2}\b/.test(resume)
  if (mentionsJobs && !hasFilledWorkExperience(profile) && !profile.noPriorWorkExperience) {
    return 'Your resume mentions jobs — add work history in onboarding (auto-fill may have missed a section).'
  }
  return 'Add at least one role with company and title, or confirm you have no prior employment.'
}

export function profileFieldChecks(
  profile: SavedProfile | null | undefined,
  user?: User | null,
): ProfileFieldCheck[] {
  const phone = user?.phone?.trim() || (profile as { contactPhone?: string } | null)?.contactPhone?.trim()
  const interview = getInterviewResult()
  const interviewDone =
    interview?.overall != null && Number.isFinite(interview.overall)
  const hasCert = (profile?.certifications ?? []).some((c) => c.name?.trim())

  return [
    {
      label: 'Display name',
      done: !!(profile?.fullName?.trim() || user?.name?.trim()),
      required: true,
      section: 'basics',
      hint: 'Add how employers should address you.',
      icon: 'user',
    },
    {
      label: 'Current city',
      done: !!profile?.currentLocation?.trim(),
      required: true,
      section: 'basics',
      hint: 'Add the city you are based in.',
      icon: 'map-pin',
    },
    {
      label: 'Phone number',
      done: !!phone,
      required: false,
      section: 'basics',
      hint: 'Optional — helps recruiters reach you faster.',
      icon: 'user',
    },
    {
      label: 'Target role',
      done: !!profile?.currentRole?.trim(),
      required: true,
      section: 'role',
      hint: 'Add the role you want to explore.',
      icon: 'briefcase',
    },
    {
      label: 'Years of experience',
      done: !!profile?.totalExperience?.trim(),
      required: true,
      section: 'role',
      hint: 'Share your experience band (e.g. 2–3 years).',
      icon: 'chart',
    },
    {
      label: 'Professional summary',
      done: (profile?.whoAreYou?.trim().length ?? 0) >= 30,
      required: true,
      section: 'about',
      hint: 'A short “who you are” intro from onboarding step 1.',
      icon: 'user',
      href: '/onboarding?step=1',
    },
    {
      label: 'Skills',
      done: (profile?.skills?.filter((s) => s.trim()).length ?? 0) >= 3,
      required: true,
      section: 'skills',
      hint: 'Add at least three skills that match your target roles.',
      icon: 'sparkle',
    },
    {
      label: 'Work experience',
      done: workExperienceComplete(profile),
      required: true,
      section: 'experience',
      hint: workExperienceHint(profile),
      icon: 'briefcase',
      href: '/onboarding?step=2',
    },
    {
      label: 'Resume file',
      done: !!(profile?.resumeName?.trim() || profile?.resumeUrl?.trim()),
      required: true,
      section: 'resume',
      hint: 'Upload a PDF or DOCX so employers can review your background.',
      icon: 'document',
    },
    {
      label: 'Notice period / availability',
      done: !!profile?.noticePeriod?.trim(),
      required: true,
      section: 'preferences',
      hint: 'Add when you can start a new role.',
      icon: 'calendar',
    },
    {
      label: 'AI interview score',
      done: interviewDone,
      required: true,
      section: 'interview',
      hint: 'Complete the AI interview so employers see your HireRighttt report.',
      icon: 'chart',
      href: '/interview',
    },
    {
      label: 'Certifications',
      done: hasCert,
      required: false,
      section: 'performance',
      hint: 'Optional — add certificates or courses from onboarding step 3.',
      icon: 'document',
      href: '/onboarding?step=3',
    },
  ]
}

export function profileCheckHref(check: ProfileFieldCheck): string {
  return check.href ?? `/profile#${check.section}`
}

export function missingProfileFields(
  profile: SavedProfile | null | undefined,
  user?: User | null,
  options?: { requiredOnly?: boolean },
) {
  const checks = profileFieldChecks(profile, user)
  return checks.filter((item) => {
    if (item.done) return false
    if (options?.requiredOnly) return item.required
    return true
  })
}

export function missingRequiredProfileFields(
  profile: SavedProfile | null | undefined,
  user?: User | null,
) {
  return missingProfileFields(profile, user, { requiredOnly: true })
}

export function profileCompletionPercent(
  profile: SavedProfile | null | undefined,
  user?: User | null,
) {
  const checks = profileFieldChecks(profile, user).filter((c) => c.required)
  if (!checks.length) return 0
  const done = checks.filter((c) => c.done).length
  return Math.round((done / checks.length) * 100)
}

/** Human-readable list of what is still missing (required first, then optional). */
export function profileMissingLabels(
  profile: SavedProfile | null | undefined,
  user?: User | null,
): string[] {
  const checks = profileFieldChecks(profile, user)
  const required = checks.filter((c) => c.required && !c.done).map((c) => c.label)
  const optional = checks.filter((c) => !c.required && !c.done).map((c) => c.label)
  return [...required, ...optional]
}
