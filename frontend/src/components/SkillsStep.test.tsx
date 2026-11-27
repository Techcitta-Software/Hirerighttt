import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SKILLS, SKILL_OPTIONS, initialFormData, type ProfileFormData } from '../data/wizard'
import { suggestSkillsForProfile } from '../lib/roleSkillSuggestions'
import { SkillsStep } from './SkillsStep'

// BUG-008: the suggestion memos now depend on the exact fields they read. The chips must stay the same.
function render(data: ProfileFormData) {
  return renderToStaticMarkup(createElement(SkillsStep, { data, onChange: vi.fn() }))
}

describe('SkillsStep suggestions', () => {
  it('shows the role-based suggestions for a profile with a role', () => {
    const data: ProfileFormData = { ...initialFormData, currentRole: 'Software Engineer', skills: [] }
    const expected = suggestSkillsForProfile(data, SKILL_OPTIONS, 14)
    expect(expected.length).toBeGreaterThan(0)
    const out = render(data)
    for (const skill of expected) expect(out).toContain(skill)
  })

  it('leaves already-added skills out of the role-based suggestions', () => {
    const base: ProfileFormData = { ...initialFormData, currentRole: 'Software Engineer', skills: [] }
    const first = suggestSkillsForProfile(base, SKILL_OPTIONS, 14)[0]
    const data = { ...base, skills: [first] }
    expect(suggestSkillsForProfile(data, SKILL_OPTIONS, 14)).not.toContain(first)
    // The added skill still renders once, as a selected chip, not again as a suggestion.
    const out = render(data)
    expect(out.split(`>${first}<`).length - 1).toBeLessThanOrEqual(1)
  })

  it('falls back to the popular skills when there is no role context', () => {
    const data: ProfileFormData = { ...initialFormData, currentRole: '', preferredRoles: [], workExperiences: [], resumeText: '', skills: [] }
    const out = render(data)
    expect(out).toContain(DEFAULT_SKILLS[0])
  })
})
