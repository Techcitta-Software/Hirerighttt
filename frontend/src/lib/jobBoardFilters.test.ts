import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANY,
  filterJobBoard,
  hasActiveJobFilters,
  jobLocationOptions,
  jobWorkMode,
  readHiddenJobIds,
  readSavedJobIds,
  writeHiddenJobIds,
  writeSavedJobIds,
  type JobBoardItem,
} from './jobBoardFilters'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const job = (over: Partial<JobBoardItem>): JobBoardItem => ({
  id: 'j',
  title: 'Senior Frontend Developer',
  company: 'Acme',
  location: 'Chennai',
  mode: '',
  skillTags: ['React', 'TypeScript'],
  ...over,
})

const NO_FILTERS = { search: '', location: ANY, mode: ANY }

describe('job board filters', () => {
  it('has no hidden match threshold: every role the server returned is listed', () => {
    // Regression: a hidden 70% "min match" filter emptied "For you" with a "Clear filters" button that did nothing.
    const jobs = [job({ id: 'a' }), job({ id: 'b', title: 'Backend Engineer' })]
    expect(filterJobBoard(jobs, NO_FILTERS).map((j) => j.id)).toEqual(['a', 'b'])
    expect(hasActiveJobFilters(NO_FILTERS)).toBe(false)
  })

  it('applies location, remote and search filters', () => {
    const jobs = [
      job({ id: 'chn' }),
      job({ id: 'blr', location: 'Bengaluru', skillTags: ['Python'] }),
      job({ id: 'rem', location: 'Remote', mode: 'Remote' }),
    ]
    expect(filterJobBoard(jobs, { ...NO_FILTERS, location: 'Bengaluru' }).map((j) => j.id)).toEqual(['blr', 'rem'])
    expect(filterJobBoard(jobs, { ...NO_FILTERS, location: 'Remote' }).map((j) => j.id)).toEqual(['rem'])
    expect(filterJobBoard(jobs, { ...NO_FILTERS, mode: 'Remote' }).map((j) => j.id)).toEqual(['rem'])
    expect(filterJobBoard(jobs, { ...NO_FILTERS, search: 'python' }).map((j) => j.id)).toEqual(['blr'])
    expect(hasActiveJobFilters({ ...NO_FILTERS, search: ' x ' })).toBe(true)
  })

  it('drops roles the candidate marked "Not for me"', () => {
    const jobs = [job({ id: 'a' }), job({ id: 'b' })]
    expect(filterJobBoard(jobs, NO_FILTERS, new Set(['a'])).map((j) => j.id)).toEqual(['b'])
  })

  it('builds location options from the roles (not a fixed city list)', () => {
    const opts = jobLocationOptions([{ location: 'Chennai' }, { location: 'Bengaluru, Remote' }, { location: 'chennai' }])
    expect(opts).toEqual(['Bengaluru', 'Chennai', 'Remote'])
  })

  it('never invents a work mode', () => {
    expect(jobWorkMode('Chennai')).toBe('')
    expect(jobWorkMode('Remote (India)')).toBe('Remote')
  })
})

describe('saved and hidden roles persist per candidate', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('round-trips and keeps candidates separate', () => {
    writeSavedJobIds('a@example.com', new Set(['j1', 'j2']))
    writeHiddenJobIds('a@example.com', new Set(['j3']))
    expect([...readSavedJobIds('a@example.com')]).toEqual(['j1', 'j2'])
    expect([...readHiddenJobIds('a@example.com')]).toEqual(['j3'])
    expect(readSavedJobIds('b@example.com').size).toBe(0)
    expect(readSavedJobIds(undefined).size).toBe(0)
  })

  it('ignores corrupt storage', () => {
    localStorage.setItem('hireright.savedJobs.a@example.com', '{not json')
    expect(readSavedJobIds('a@example.com').size).toBe(0)
  })
})
