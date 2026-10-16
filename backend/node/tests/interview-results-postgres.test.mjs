import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { applySchema } from '../db/applySchema.mjs'
import { hashPassword } from '../authPasswords.mjs'
import {
  upsertCandidate,
  createInterviewResult,
  recordQaPair,
  saveEvaluation,
  finalizeInterviewResult,
  getInterviewResult,
} from '../interviewResults/repository.mjs'
import { buildQaPair, candidateRowFromUserAndProfile } from '../interviewResults/logic.mjs'

const url = process.env.ASSESSMENT_TEST_DATABASE_URL

test('candidate and interview results repository', { skip: !url, timeout: 30000 }, async () => {
  const parsed = new URL(url)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname))
  const schema = `cir_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  parsed.searchParams.set('options', `-c search_path=${schema}`)
  const pool = new pg.Pool({ connectionString: parsed.toString() })
  try {
    const client = await pool.connect()
    await applySchema(client)
    client.release()

    const hash = await hashPassword('secret-pass')
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, role, phone) VALUES ($1,$2,$3,$4,'jobseeker',$5)`,
      ['user1', 'cand@test.local', 'Cand One', hash, '+919876543210'],
    )
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,'jobseeker')`,
      ['user2', 'other@test.local', 'Other', hash],
    )

    const row = candidateRowFromUserAndProfile(
      { id: 'user1', email: 'cand@test.local', name: 'Cand One', passwordHash: hash, phone: '+919876543210' },
      { skills: ['Go', 'Postgres'], currentRole: 'Engineer' },
    )
    await upsertCandidate(pool, row)
    await upsertCandidate(pool, { ...row, resume_skills: ['TypeScript'] })
    const { rows: candRows } = await pool.query('SELECT resume_skills, password_hash FROM candidates WHERE id = $1', [
      'user1',
    ])
    assert.equal(candRows.length, 1)
    assert.deepEqual(candRows[0].resume_skills, ['TypeScript'])
    assert.ok(String(candRows[0].password_hash).startsWith('scrypt$'))

    const sessionId = randomUUID().replaceAll('-', '').slice(0, 24)
    await createInterviewResult(pool, {
      id: sessionId,
      candidateId: 'user1',
      candidateName: 'Cand One',
      candidateEmail: 'cand@test.local',
      role: 'Dev',
      level: '1–3 years',
    })
    await createInterviewResult(pool, {
      id: sessionId,
      candidateId: 'user1',
      candidateName: 'Cand One',
      candidateEmail: 'cand@test.local',
      role: 'Dev',
      level: '1–3 years',
    })
    const { rows: oneRow } = await pool.query('SELECT COUNT(*)::int AS c FROM candidate_interview_results WHERE id = $1', [
      sessionId,
    ])
    assert.equal(oneRow[0].c, 1)

    const mk = (i, ans) =>
      buildQaPair({
        questionIndex: i,
        question: { text: `Question ${i}?`, category: 'Technical' },
        answer: ans,
        skipped: false,
      })

    await Promise.all([
      recordQaPair(pool, sessionId, 'user1', mk(0, 'answer zero')),
      recordQaPair(pool, sessionId, 'user1', mk(1, 'answer one')),
      recordQaPair(pool, sessionId, 'user1', mk(2, 'answer two')),
    ])
    let result = await getInterviewResult(pool, sessionId, 'user1')
    assert.equal(result.answerCount, 3)

    await Promise.all([
      saveEvaluation(pool, sessionId, 0, {
        status: 'scored',
        score: 80,
        criteria: { relevance: 8, accuracy: 8, clarity: 8, depth: 8 },
        feedback: 'Good',
        source: 'llm',
        answer: 'answer zero',
      }),
      saveEvaluation(pool, sessionId, 1, {
        status: 'scored',
        score: 60,
        criteria: { relevance: 6, accuracy: 6, clarity: 6, depth: 6 },
        feedback: 'Ok',
        source: 'llm',
        answer: 'answer one',
      }),
      recordQaPair(pool, sessionId, 'user1', mk(3, 'answer three')),
    ])
    result = await getInterviewResult(pool, sessionId, 'user1')
    assert.equal(result.answerCount, 4)
    assert.equal(result.scoredCount, 2)
    assert.equal(result.finalScore, 70)

    await assert.rejects(
      () => recordQaPair(pool, sessionId, 'user2', mk(9, 'nope')),
      (err) => err.status === 404,
    )

    await saveEvaluation(pool, sessionId, 2, {
      status: 'scored',
      score: 99,
      criteria: { relevance: 10, accuracy: 10, clarity: 10, depth: 10 },
      feedback: 'stale',
      source: 'llm',
      answer: 'wrong answer text',
    })
    result = await getInterviewResult(pool, sessionId, 'user1')
    const p2 = result.qaPairs.find((p) => p.questionIndex === 2)
    assert.equal(p2.evaluation.status, 'pending')

    await finalizeInterviewResult(pool, sessionId, { status: 'completed' })
    await assert.rejects(
      () => recordQaPair(pool, sessionId, 'user1', mk(5, 'late')),
      (err) => err.status === 409,
    )
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
