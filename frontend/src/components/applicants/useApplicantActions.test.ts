import { describe, expect, it } from 'vitest'
import { noticeAfterSearchQueryChange, type Notice } from './useApplicantActions'

const shortlist: Notice = { tone: 'success', text: 'Ada shortlisted.' }

describe('noticeAfterSearchQueryChange', () => {
  it('keeps the shortlist notice while the search query stays the same', () => {
    expect(noticeAfterSearchQueryChange('react', 'react', shortlist)).toBe(shortlist)
    expect(noticeAfterSearchQueryChange('', '', null)).toBeNull()
  })

  it('clears the shortlist notice when the search query changes', () => {
    expect(noticeAfterSearchQueryChange('react', 'vue', shortlist)).toBeNull()
    expect(noticeAfterSearchQueryChange('', 'react', shortlist)).toBeNull()
  })
})
