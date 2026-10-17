import test from 'node:test'
import assert from 'node:assert/strict'

/** Mirrors frontend parseScheduledFromNotes for onboarding step 4. */
function parseScheduledFromNotes(notes) {
  if (!notes?.startsWith('Scheduled: ')) return null
  const d = new Date(notes.slice('Scheduled: '.length).trim())
  return Number.isNaN(d.getTime()) ? null : d
}

test('parseScheduledFromNotes reads ISO from interviewNotes', () => {
  const iso = '2026-12-01T08:00:00.000Z'
  const d = parseScheduledFromNotes(`Scheduled: ${iso}`)
  assert.ok(d)
  assert.equal(d.toISOString(), iso)
  assert.equal(parseScheduledFromNotes(''), null)
  assert.equal(parseScheduledFromNotes('Scheduled: not-a-date'), null)
})
