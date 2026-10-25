import type { ProfileFormData } from '../data/wizard'
import { suggestRoleFromTitle } from '../data/jobRoles'
import { ROLE_SKILL_LIBRARY, skillsMatchingRoleText } from './roleSkillLibrary'

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

const RESUME_SCAN_LIMIT = 12_000

export function collectRoleHintsFromProfile(
  data: Pick<
    ProfileFormData,
    'currentRole' | 'preferredRoles' | 'workExperiences' | 'resumeText'
  >,
): string[] {
  const hints: string[] = []
  const push = (value: string) => {
    const trimmed = value.trim()
    if (trimmed) hints.push(trimmed)
  }

  push(data.currentRole)
  for (const role of data.preferredRoles || []) push(role)
  for (const row of data.workExperiences || []) push(row.jobTitle || '')

  for (const hint of [...hints]) {
    const mapped = suggestRoleFromTitle(hint)
    if (mapped) push(mapped)
  }

  return unique(hints)
}

export function profileHasRoleContextForSkills(
  data: Pick<
    ProfileFormData,
    'currentRole' | 'preferredRoles' | 'workExperiences' | 'resumeText'
  >,
): boolean {
  if (collectRoleHintsFromProfile(data).length > 0) return true
  const resume = (data.resumeText || '').trim().slice(0, RESUME_SCAN_LIMIT)
  if (!resume) return false
  return ROLE_SKILL_LIBRARY.some((entry) => entry.test.test(resume))
}

function filterToAllowedSkills(pool: string[], allowedSkills: readonly string[]): string[] {
  const allowed = new Set(allowedSkills.map((s) => s.toLowerCase()))
  return pool.filter((skill) => allowed.has(skill.toLowerCase()))
}

/** Suggested chips when the skills input is empty — driven by résumé and profile roles. */
export function suggestSkillsForProfile(
  data: Pick<
    ProfileFormData,
    'currentRole' | 'preferredRoles' | 'workExperiences' | 'resumeText' | 'skills'
  >,
  allowedSkills: readonly string[],
  limit = 14,
): string[] {
  const hints = collectRoleHintsFromProfile(data)
  const pool: string[] = []

  for (const hint of hints) {
    pool.push(...skillsMatchingRoleText(hint))
  }

  const resume = (data.resumeText || '').trim().slice(0, RESUME_SCAN_LIMIT)
  if (resume) {
    pool.push(...skillsMatchingRoleText(resume))
  }

  let ranked = filterToAllowedSkills(unique(pool), allowedSkills)

  if (resume && ranked.length) {
    const resumeLower = resume.toLowerCase()
    ranked = [...ranked].sort((a, b) => {
      const aHit = resumeLower.includes(a.toLowerCase()) ? 1 : 0
      const bHit = resumeLower.includes(b.toLowerCase()) ? 1 : 0
      return bHit - aHit
    })
  }

  const already = new Set((data.skills || []).map((s) => s.toLowerCase()))
  return ranked.filter((skill) => !already.has(skill.toLowerCase())).slice(0, limit)
}
