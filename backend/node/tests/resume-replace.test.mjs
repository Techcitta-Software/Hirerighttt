import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RESUME_SOURCED_PROFILE_KEYS,
  buildResumeReplacementProfile,
  purgePriorResumeAndInterviewArtifacts,
} from '../resume/replaceCandidateResume.mjs'

describe('resume replace', () => {
  it('buildResumeReplacementProfile clears old resume fields and applies new extract', () => {
    const prev = {
      resumeName: 'old.pdf',
      resumeText: 'old text',
      skills: ['Java'],
      linkedin: 'https://linkedin.com/in/keep-me',
      currentRole: 'Old Role',
    }
    const next = buildResumeReplacementProfile(prev, {
      extract: {
        resumeText: 'new resume body',
        skills: ['TypeScript', 'React'],
        currentRole: 'Frontend Developer',
        fullName: 'Alex Candidate',
      },
      upload: {
        resumeStoragePath: 'tenants/platform/resumes/x/resume_v2.pdf',
        resumeUrl: '/api/resume/download',
        resumeFileId: 'file-2',
        storageProvider: 's3',
      },
      filename: 'new-resume.pdf',
    })

    assert.equal(next.resumeName, 'new-resume.pdf')
    assert.equal(next.resumeText, 'new resume body')
    assert.deepEqual(next.skills, ['TypeScript', 'React'])
    assert.equal(next.currentRole, 'Frontend Developer')
    assert.equal(next.linkedin, 'https://linkedin.com/in/keep-me')
    assert.equal(next.resumeStoragePath, 'tenants/platform/resumes/x/resume_v2.pdf')
    assert.ok(next.updatedAt)
    assert.notEqual(next.resumeText, prev.resumeText)
    assert.ok(RESUME_SOURCED_PROFILE_KEYS.includes('resumeText'))
  })

  it('purgePriorResumeAndInterviewArtifacts clears in-memory interview state', async () => {
    const db = {
      users: [{ email: 'a@test.com' }],
      profiles: { 'a@test.com': { resumeStoragePath: 'old/key.pdf' } },
      interviews: { 'a@test.com': { overall: 80 } },
      interviewSessions: { s1: { email: 'a@test.com' }, s2: { email: 'other@test.com' } },
    }
    const purged = await purgePriorResumeAndInterviewArtifacts({
      pool: null,
      s3: null,
      email: 'a@test.com',
      prevProfile: db.profiles['a@test.com'],
      db,
    })
    assert.equal(purged.recordings, 0)
    assert.equal(db.interviews['a@test.com'], undefined)
    assert.equal(db.interviewSessions.s1, undefined)
    assert.ok(db.interviewSessions.s2)
  })
})
