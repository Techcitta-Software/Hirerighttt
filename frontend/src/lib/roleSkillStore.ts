import roleSkillsJson from '../data/roleSkills.json'
import { findRoleSkills } from './roleSkillLookup'
export { normalizeRoleKey } from './roleSkillLookup'
export type RoleSkillsMap = Record<string, string[]>
export function getSkillsForRole(role: string): string[] {
  return findRoleSkills(role, roleSkillsJson)
}
