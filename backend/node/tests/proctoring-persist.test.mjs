import test from 'node:test'
import assert from 'node:assert/strict'
import { persistProctoringFlags } from '../proctoring/persistProctoringFlags.mjs'

test('persistProctoringFlags strips snapshotDataUrl and computes summary', async () => {
  const out = await persistProctoringFlags({
    tenantId: 'org_test',
    sessionId: 'sess_1',
    flaggedSections: [
      {
        id: 'flag_1_10',
        type: 'LOOKING_SIDE',
        severity: 'medium',
        turnIndex: 1,
        questionText: 'Q1',
        startSec: 10,
        endSec: 14,
        durationSec: 4,
        reason: 'Looked right',
        snapshotDataUrl: 'data:image/jpeg;base64,abc',
      },
      {
        id: 'flag_2_20',
        type: 'MULTI_FACE',
        severity: 'high',
        turnIndex: 2,
        questionText: 'Q2',
        startSec: 20,
        endSec: 26,
        durationSec: 6,
        reason: '2 people',
      },
    ],
  })

  assert.equal(out.counts.total, 2)
  assert.equal(out.counts.lookingSide, 1)
  assert.equal(out.counts.multiplePeople, 1)
  assert.equal(out.status, 'FLAGGED')
  assert.equal(out.flaggedSections.length, 2)
  assert.equal(out.flaggedSections[0].snapshotDataUrl, undefined)
})
