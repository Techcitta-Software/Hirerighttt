import type { SavedProfile, User } from './store'

export type ProfileFieldCheck = {
  label: string
  done: boolean
  section: 'basics' | 'role' | 'skills' | 'resume' | 'preferences'
  hint: string
  icon: 'user' | 'map-pin' | 'briefcase' | 'chart' | 'sparkle' | 'document' | 'calendar'
}

export function profileFieldChecks(
  profile: SavedProfile | null | undefined,
  user?: User | null,
): ProfileFieldCheck[] {
  const phone = user?.phone?.trim() || (profile as { contactPhone?: string } | null)?.contactPhone?.trim()
  return [
    {
      label: 'Your name',
      done: !!(profile?.fullName?.trim() || user?.name?.trim()),
      section: 'basics',
      hint: 'Add how employers should address you.',
      icon: 'user',
    },
    {
      label: 'Current location',
      done: !!profile?.currentLocation?.trim(),
      section: 'basics',
      hint: 'Add the city you are based in.',
      icon: 'map-pin',
    },
    {
      label: 'Phone number',
      done: !!phone,
      section: 'basics',
      hint: 'Optional — helps recruiters reach you faster.',
      icon: 'user',
    },
    {
      label: 'Career interests',
      done: !!profile?.currentRole?.trim(),
      section: 'role',
      hint: 'Add the role you want to explore.',
      icon: 'briefcase',
    },
    {
      label: 'Experience',
      done: !!profile?.totalExperience?.trim(),
      section: 'role',
      hint: 'Share your years of experience.',
      icon: 'chart',
    },
    {
      label: 'Skills',
      done: !!profile?.skills?.some((s) => s.trim()),
      section: 'skills',
      hint: 'List skills that match your target roles.',
      icon: 'sparkle',
    },
    {
      label: 'Resume',
      done: !!profile?.resumeName,
      section: 'resume',
      hint: 'Upload a PDF so employers can review your background.',
      icon: 'document',
    },
    {
      label: 'Availability to join',
      done: !!profile?.noticePeriod?.trim(),
      section: 'preferences',
      hint: 'Add when you can start a new role.',
      icon: 'calendar',
    },
  ]
}

export function missingProfileFields(
  profile: SavedProfile | null | undefined,
  user?: User | null,
) {
  return profileFieldChecks(profile, user).filter((item) => !item.done)
}

export function profileCompletionPercent(
  profile: SavedProfile | null | undefined,
  user?: User | null,
) {
  const checks = profileFieldChecks(profile, user)
  const done = checks.filter((c) => c.done).length
  return checks.length ? Math.round((done / checks.length) * 100) : 0
}
