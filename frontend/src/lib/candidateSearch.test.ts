import { describe, expect, it } from 'vitest'
import {
  candidateMatchScore,
  highlightSegments,
  searchCandidates,
  tokenizeQuery,
  type CandidateQuickFilter,
} from './candidateSearch'

type C = Parameters<typeof searchCandidates>[0][number]

const base = { candidatePhone: '', role: '', jobTitle: '', company: '', experienceYears: '', resumeText: '', status: 'New', appliedAt: '2026-01-01' } as const

const priya = { ...base, id: '1', candidateName: 'Priya Nair', candidateEmail: 'priya@example.com', candidatePhone: '+91 98450 11223', role: 'Full Stack Engineer', jobTitle: 'Senior Engineer', company: 'Acme', resumeText: 'Built dashboards in React and TypeScript in Bengaluru. React hooks, React Query.', appliedAt: '2026-03-01', aiScore: 92, interviewResult: { overall: 92 } } as unknown as C
const ravi = { ...base, id: '2', candidateName: 'Ravi Kumar', candidateEmail: 'ravi@example.com', role: 'Data Analyst', resumeText: 'Worked with react dashboards occasionally', appliedAt: '2026-02-01', aiScore: 55, interviewResult: { overall: 55 } } as unknown as C
const meena = { ...base, id: '3', candidateName: 'Meena Rao', candidateEmail: 'meena@example.com', role: 'Java Developer', resumeText: 'Spring Boot microservices and Hibernate', appliedAt: '2026-04-01' } as unknown as C

const all = [priya, ravi, meena]
const run = (query: string, quick: CandidateQuickFilter = 'all', sort: 'best_match' | 'newest' | 'score' | 'name' = 'best_match') =>
  searchCandidates(all, { query, quick, sort }).map((c) => (c as unknown as { candidateName: string }).candidateName)

describe('candidate search', () => {
  it('shows everyone when the box is empty (newest first)', () => {
    expect(run('')).toEqual(['Meena Rao', 'Priya Nair', 'Ravi Kumar'])
  })

  it('finds people by name, email and phone', () => {
    expect(run('priya')).toEqual(['Priya Nair'])
    expect(run('ravi@example')).toEqual(['Ravi Kumar'])
    expect(run('98450')).toEqual(['Priya Nair'])
    expect(run('+91 98450 11223')).toEqual(['Priya Nair'])
  })

  it('finds people by role and by words in their resume', () => {
    expect(run('java')).toEqual(['Meena Rao'])
    expect(run('spring')).toEqual(['Meena Rao'])
    expect(run('analyst')).toEqual(['Ravi Kumar'])
  })

  it('finds people by words in the resume text', () => {
    expect(run('bengaluru')).toEqual(['Priya Nair'])
  })

  it('ranks heavy resume matches above a passing mention', () => {
    // Priya's resume is full of React; Ravi mentions it once
    expect(run('react')).toEqual(['Priya Nair', 'Ravi Kumar'])
  })

  it('requires every word to match, in any order', () => {
    expect(run('react bengaluru')).toEqual(['Priya Nair'])
    expect(run('bengaluru react')).toEqual(['Priya Nair'])
    expect(run('react java')).toEqual([])
  })

  it('is case-insensitive and ignores extra spaces', () => {
    expect(run('  PRIYA   nair ')).toEqual(['Priya Nair'])
  })

  it('returns nothing sensible for gibberish', () => {
    expect(run('zzzzqqq')).toEqual([])
  })

  it('quick filters narrow the list', () => {
    expect(run('', 'interviewed')).toEqual(['Priya Nair', 'Ravi Kumar'])
    expect(run('', 'not_interviewed')).toEqual(['Meena Rao'])
    expect(run('', 'score_70')).toEqual(['Priya Nair'])
    expect(run('react', 'score_70')).toEqual(['Priya Nair'])
  })

  it('sorts by score and by name', () => {
    expect(run('', 'all', 'score')).toEqual(['Priya Nair', 'Ravi Kumar', 'Meena Rao'])
    expect(run('', 'all', 'name')).toEqual(['Meena Rao', 'Priya Nair', 'Ravi Kumar'])
  })

  it('scores are zero when a word is missing', () => {
    expect(candidateMatchScore(priya, 'priya java')).toBe(0)
    expect(candidateMatchScore(priya, 'priya')).toBeGreaterThan(0)
  })

  it('tokenizes sensibly', () => {
    expect(tokenizeQuery('React, Node.js  react')).toEqual(['react', 'node.js'])
  })
})

describe('job skills are not candidate skills', () => {
  it('does not match on the skills of the job they applied to', () => {
    const jobSkillsOnly = { ...base, id: '9', candidateName: 'Sam Lee', candidateEmail: 'sam@example.com', role: 'Accountant', resumeText: 'Bookkeeping and tax filing', primarySkills: ['React', 'Node.js'] } as unknown as C
    expect(searchCandidates([jobSkillsOnly], { query: 'react', quick: 'all', sort: 'best_match' })).toEqual([])
  })
})

describe('highlight', () => {
  it('marks the searched words, case-insensitively', () => {
    expect(highlightSegments('Priya Nair', 'nair')).toEqual([
      { text: 'Priya ', match: false },
      { text: 'Nair', match: true },
    ])
  })

  it('handles special characters in the query safely', () => {
    expect(() => highlightSegments('C++ developer', 'c++')).not.toThrow()
    expect(highlightSegments('C++ developer', 'c++')[0]).toEqual({ text: 'C++', match: true })
  })

  it('returns the text untouched without a query', () => {
    expect(highlightSegments('Priya', '')).toEqual([{ text: 'Priya', match: false }])
  })
})
