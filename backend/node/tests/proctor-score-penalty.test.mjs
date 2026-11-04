import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyFaceDeviationPenaltyToResult,
  countFaceProctorDeviations,
  FACE_DEVIATION_SCORE_PENALTY,
} from '../proctoring/proctorScorePenalty.mjs'

test('countFaceProctorDeviations uses flagged sections', () => {
  assert.equal(
    countFaceProctorDeviations({
      flaggedSections: [{ type: 'LOOKING_SIDE' }, { type: 'MULTI_FACE' }],
    }),
    2,
  )
})

test('applyFaceDeviationPenaltyToResult subtracts 5 per deviation', () => {
  const result = applyFaceDeviationPenaltyToResult({ overall: 82, improvements: [] }, 2)
  assert.equal(FACE_DEVIATION_SCORE_PENALTY, 5)
  assert.equal(result.overall, 72)
  assert.equal(result.proctorScorePenalty, 10)
})
