import { beforeEach, describe, expect, it, vi } from 'vitest'

// A job link -> sign-up / log-in -> candidate portal -> interview. The job and its JD must survive the redirect.
let completedSteps = 0
let user: { id: string; name: string; email: string; role: string; phone?: string } | null = null
vi.mock('./store', () => ({
  getProfile: () => ({ completedSteps, resumeText: 'Software Engineer at Acme Fintech. Built Django REST payout services.' }),
  getUser: () => user,
  logout: () => undefined,
}))
const applyToPublicJob = vi.fn()
vi.mock('./vendorApi', () => ({ applyToPublicJob: (...args: unknown[]) => applyToPublicJob(...args) }))
vi.mock('./apiSession', () => ({ ensureApiSession: async () => true }))

import { resolveAuthenticatedDestination } from './authSession'
import {
  PENDING_JOB_TTL_MS,
  clearPendingJob,
  ensureJobLinkApplication,
  getPendingJob,
  resolveInterviewJobContext,
  setPendingJob,
} from './pendingJobApply'
import { readTargetJob, writeTargetJob } from './targetJob'

const JD = 'Design and maintain REST APIs for the payments ledger in Python and FastAPI. Own PostgreSQL schema changes.'
const VENDOR_JOB = {
  id: 'job-42',
  shareableCode: 'PAY42',
  title: 'Backend Engineer',
  company: 'Payflow',
  roleTrack: 'Backend Engineer',
  experienceLevel: '3-5 years',
  jobDescription: JD,
  requiredSkills: ['Python', 'FastAPI', 'PostgreSQL'],
} as never

function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

let session = memoryStorage()
let local = memoryStorage()

beforeEach(() => {
  session = memoryStorage()
  local = memoryStorage()
  vi.stubGlobal('sessionStorage', session)
  vi.stubGlobal('localStorage', local)
  applyToPublicJob.mockReset()
  user = null
  completedSteps = 0
})

describe('job link carried through sign-up / log-in into the interview', () => {
  it('new sign-up: the job survives onboarding and is preloaded (JD) and applied to when the interview starts', async () => {
    setPendingJob(VENDOR_JOB, 'payflow') // JobInviteEntryPage
    user = { id: 'c1', name: 'Asha', email: 'asha@example.com', role: 'jobseeker', phone: '9999999999' }
    expect(resolveAuthenticatedDestination(user as never)).toBe('/onboarding?step=1')

    const ctx = resolveInterviewJobContext()
    expect(ctx).toMatchObject({ jobId: 'job-42', title: 'Backend Engineer', jd: JD, role: 'Backend Engineer' })

    completedSteps = 3
    applyToPublicJob.mockResolvedValue({
      applicationId: 'app-7',
      organizationId: 'org-1',
      job: { id: 'job-42' },
      ats: { atsScore: 71, jdMatchScore: 64, primarySkills: ['Python', 'FastAPI'] },
    })
    const started = await ensureJobLinkApplication()
    expect(applyToPublicJob).toHaveBeenCalledWith('PAY42', expect.objectContaining({ source: 'shared_link' }), 'payflow')
    expect(started).toMatchObject({ jobId: 'job-42', applicationId: 'app-7', organizationId: 'org-1', jd: JD })
    expect(readTargetJob()?.applicationId).toBe('app-7')
    expect(getPendingJob()).toBeNull() // applied: not applied twice
  })

  it('existing log-in in a new tab: the job is restored from the backup and preloaded, not a generic interview', () => {
    setPendingJob(VENDOR_JOB, 'payflow')
    // The candidate logs in from another tab / window: a fresh sessionStorage.
    session = memoryStorage()
    vi.stubGlobal('sessionStorage', session)
    user = { id: 'c2', name: 'Ravi', email: 'ravi@example.com', role: 'jobseeker' }
    completedSteps = 5
    expect(resolveAuthenticatedDestination(user as never)).toBe('/dashboard')

    const ctx = resolveInterviewJobContext()
    expect(ctx?.jobId).toBe('job-42')
    expect(ctx?.jd).toBe(JD)
    expect(session.getItem('hireright.pendingJob')).not.toBeNull() // copied back into this tab
  })

  it('existing log-in: if the application cannot be saved, the interview still uses the job and its JD', async () => {
    setPendingJob(VENDOR_JOB, 'payflow')
    user = { id: 'c2', name: 'Ravi', email: 'ravi@example.com', role: 'jobseeker' }
    completedSteps = 5
    applyToPublicJob.mockRejectedValue(new Error('network'))
    const started = await ensureJobLinkApplication()
    expect(started).toMatchObject({ jobId: 'job-42', jd: JD })
    expect(started?.applicationId).toBeUndefined()
  })

  it('a newer job link replaces an older job context', () => {
    writeTargetJob({ title: 'Old job', company: 'X', role: 'QA', level: '', jd: 'old', jobId: 'job-1', applicationId: 'app-1' })
    setPendingJob(VENDOR_JOB, 'payflow')
    expect(readTargetJob()).toBeNull()
    expect(resolveInterviewJobContext()?.jobId).toBe('job-42')
  })

  it('a stale backup (older than the TTL) is not carried into a new session', () => {
    setPendingJob(VENDOR_JOB, 'payflow')
    const raw = JSON.parse(local.getItem('hireright.pendingJob.backup')!)
    raw.savedAt = Date.now() - PENDING_JOB_TTL_MS - 1
    local.setItem('hireright.pendingJob.backup', JSON.stringify(raw))
    session = memoryStorage()
    vi.stubGlobal('sessionStorage', session)
    expect(getPendingJob()).toBeNull()
    expect(resolveInterviewJobContext()).toBeNull()
  })

  it('clearing removes both copies', () => {
    setPendingJob(VENDOR_JOB, 'payflow')
    clearPendingJob()
    expect(session.getItem('hireright.pendingJob')).toBeNull()
    expect(local.getItem('hireright.pendingJob.backup')).toBeNull()
  })
})
