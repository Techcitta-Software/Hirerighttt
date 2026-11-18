import { describe, expect, it } from 'vitest'
import { isOwnOrgCandidate } from './employerCandidateUtils'

describe('isOwnOrgCandidate', () => {
  it('counts applicants, shared interviews and the talent vault as the organisation’s own', () => {
    expect(isOwnOrgCandidate({ source: 'application' })).toBe(true)
    expect(isOwnOrgCandidate({ source: 'vault' })).toBe(true)
    expect(isOwnOrgCandidate({ source: undefined })).toBe(true)
  })

  it('keeps platform-wide job seekers out of the pipeline', () => {
    expect(isOwnOrgCandidate({ source: 'platform' })).toBe(false)
    expect(isOwnOrgCandidate({ source: 'talent' })).toBe(false)
  })
})
