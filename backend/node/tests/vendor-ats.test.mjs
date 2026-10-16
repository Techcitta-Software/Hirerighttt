import test from 'node:test'
import assert from 'node:assert/strict'
import { computeAtsScore, extractPrimarySkillsFromJd } from '../vendor/atsScore.mjs'

test('extractPrimarySkillsFromJd finds role skills', () => {
  const skills = extractPrimarySkillsFromJd('Senior React TypeScript engineer with PostgreSQL experience', [
    'Redux',
  ])
  assert.ok(skills.some((s) => s.toLowerCase().includes('react')))
  assert.ok(skills.some((s) => s.toLowerCase().includes('redux')))
})

test('computeAtsScore increases when resume matches JD skills', () => {
  const jd = 'We need React, TypeScript, Node.js, and PostgreSQL.'
  const weak = computeAtsScore({ jobDescription: jd, resumeText: 'Sales and marketing background only.' })
  const strong = computeAtsScore({
    jobDescription: jd,
    resumeText: 'Built apps with React, TypeScript, Node.js, PostgreSQL for 5 years.',
  })
  assert.ok(strong.atsScore > weak.atsScore)
  assert.ok(strong.matchedSkills.length >= 2)
})
