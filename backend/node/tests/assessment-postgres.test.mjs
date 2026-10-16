import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { applySchema } from '../db/applySchema.mjs'
import { createRepository, actorForEmail } from '../assessment/repository.mjs'
import { createAssessmentService } from '../assessment/service.mjs'
import { loadDb, saveDb, closeStore } from '../db/store.mjs'

// Deliberately never defaults to DATABASE_URL: tests must not touch the user's database.
const url = process.env.ASSESSMENT_TEST_DATABASE_URL
test('PostgreSQL assessment lifecycle, ownership, recovery, idempotency and history preservation', { skip: !url }, async () => {
  const parsed = new URL(url)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'Use a disposable local PostgreSQL instance')
  const schema = `test_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  parsed.searchParams.set('options', `-c search_path=${schema}`)
  const testUrl = parsed.toString()
  const repo = createRepository(testUrl)
  try {
    await applySchema(repo)
    await applySchema(repo)
    await repo.query("INSERT INTO organizations(id,name,slug) VALUES ('org-a','A','a'),('org-b','B','b')")
    await repo.query(`INSERT INTO users(id,email,name,password_hash,role) VALUES
      ('candidate','candidate@example.test','Candidate','unused','jobseeker'),
      ('other','other@example.test','Other','unused','jobseeker'),
      ('recruiter','recruiter@example.test','Recruiter','unused','employer'),
      ('foreign','foreign@example.test','Foreign','unused','employer'),
      ('viewer','viewer@example.test','Viewer','unused','employer')`)
    await repo.query("INSERT INTO organization_members(id,organization_id,user_id,role) VALUES ('ma','org-a','recruiter','recruiter'),('mb','org-b','foreign','owner'),('mv','org-a','viewer','viewer')")
    const candidate = await actorForEmail(repo, 'candidate@example.test')
    const other = await actorForEmail(repo, 'other@example.test')
    const recruiter = await actorForEmail(repo, 'recruiter@example.test')
    const foreign = await actorForEmail(repo, 'foreign@example.test')
    const viewer = await actorForEmail(repo, 'viewer@example.test')
    const competencies = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Skill ${i}`, requirement: `Requirement ${i}`, weight: i === 6 ? 10 : 15 }))
    let aiCalls = 0
    let failEvaluation = false
    const fakeAI = async ({ purpose, payload, validate }) => {
      aiCalls++
      if (purpose === 'evaluation' && failEvaluation) throw new Error('simulated outage')
      const value = purpose === 'plan' ? { questions: competencies.map((c, i) => ({ question_id: `q${i}`, question_text: `How do you approach scenario ${i}?`, competency: c.id, difficulty: 'basic', question_type: 'scenario', selection_reason: 'Job requirement', resume_or_job_evidence: c.requirement, expected_answer_points: ['Explain reasoning'], scoring_rubric: { 0: 'No evidence', 1: 'Limited', 2: 'Developing', 3: 'Proficient', 4: 'Advanced' }, suggested_follow_up: 'Why?', max_score: 4 })) } : { score: 3, evidence: [payload.answer], strengths: ['Reasoning'], gaps: [], reasoning: 'Supported answer', confidence: 0.8, needs_human_review: false, review_reason: '' }
      return { data: validate(value), model: 'test-provider', tokens: 10, latency_ms: 1 }
    }
    const service = createAssessmentService(repo, fakeAI)
    const { job } = await service.createJob(recruiter, { organization_id: 'org-a', title: 'Support', description: 'Support customers', experience_level: 'Junior', competencies })
    await assert.rejects(service.createJob(foreign, { organization_id: 'org-a' }), /denied/)
    const resume = await service.saveResume(candidate, 'resume.txt', 'Support experience')
    await assert.rejects(service.generate(other, { job_id: job.id, resume_id: resume.resume_id, consent: true }), /resume/)
    let session = await service.generate(candidate, { job_id: job.id, resume_id: resume.resume_id, consent: true })
    const id = session.session_id
    await assert.rejects(service.get(other, id), /Recruiter/)
    await assert.rejects(service.plan(foreign, id), /denied/)
    await assert.rejects(service.plan(viewer, id), /denied/)
    await assert.rejects(service.plan(candidate, id), /Recruiter/)
    await assert.rejects(service.transition(candidate, id, 'start', { version: 1 }), /approval/)
    session = await service.approve(recruiter, id, { version: 1 })
    session = await service.transition(candidate, id, 'start', { version: session.version })
    const callsBeforeQuick = aiCalls
    const repeated = await service.message(candidate, id, { message: 'repeat the question' })
    assert.equal(repeated.version, session.version)
    assert.equal(repeated.current_question.question_text, session.current_question.question_text)
    assert.equal(repeated.current_question.scoring_rubric, undefined)
    assert.equal(aiCalls, callsBeforeQuick)
    await assert.rejects(service.approve(recruiter, id, { version: session.version }), /cannot change/)
    await assert.rejects(service.message(candidate, id, { message: 'My answer', request_id: 'stale', question_id: 'q0', version: 1 }), /changed/)
    await assert.rejects(service.message(candidate, id, { message: 'Broken transcript', transcription_failed: true }), /transcript/)
    failEvaluation = true
    const firstBody = { message: 'I verify results', request_id: 'req0', question_id: 'q0', version: session.version }
    session = await service.message(candidate, id, firstBody)
    assert.equal(session.evaluation_status, 'pending_retry')
    const recovery = await createAssessmentService(repo, fakeAI).get(candidate, id)
    assert.equal(recovery.answers[0].answer_text, firstBody.message)
    assert.equal(recovery.current_question.question_id, 'q1')
    failEvaluation = false
    const duplicate = await service.message(candidate, id, firstBody)
    assert.equal(duplicate.duplicate, true)
    assert.equal(duplicate.evaluation_status, 'evaluated')
    await assert.rejects(service.message(candidate, id, { ...firstBody, message: 'Changed answer' }), /different content/)
    for (let i = 1; i < 7; i++) session = await service.message(candidate, id, { message: `Answer ${i} with reasoning`, request_id: `req${i}`, question_id: `q${i}`, version: session.version })
    assert.equal(session.status, 'completed')
    await assert.rejects(service.report(candidate, id), /Recruiter/)
    let report = await service.report(recruiter, id)
    assert.equal(report.overall, 75)
    await assert.rejects(service.review(foreign, report.evaluations[0].id, { score: 4, reason: 'Good' }), /denied/)
    await assert.rejects(service.review(recruiter, report.evaluations[0].id, { score: 4, reason: '' }), /reason/)
    await service.review(recruiter, report.evaluations[0].id, { score: 4, reason: 'Validated alternative approach' })
    report = await service.report(recruiter, id)
    assert.equal(report.reviews.length, 1)
    assert.ok(report.overall > 75)
    assert.equal(report.evaluations[0].data.score, 3, 'AI result remains immutable')
    // Re-saving the legacy cache must preserve retained job foreign keys and new assessment rows.
    await repo.query("INSERT INTO jobs(id,organization_id,title,company,shareable_code) VALUES('retained','org-a','Title','Company','code')")
    await repo.query("INSERT INTO interview_result_history(email,job_id,data) VALUES('candidate@example.test','retained','{}')")
    const snapshot = await loadDb(testUrl)
    await saveDb(snapshot, testUrl)
    assert.equal((await repo.query('SELECT job_id FROM interview_result_history')).rows[0].job_id, 'retained')
    assert.equal((await service.get(candidate, id)).status, 'completed')
    // Concurrent submissions can consume the active question only once.
    let concurrent = await service.generate(candidate, { job_id: job.id, resume_id: resume.resume_id, consent: true })
    const concurrentId = concurrent.session_id
    concurrent = await service.approve(recruiter, concurrentId, { version: concurrent.version })
    concurrent = await service.transition(candidate, concurrentId, 'start', { version: concurrent.version })
    const outcomes = await Promise.allSettled(['one', 'two'].map(request_id => service.message(candidate, concurrentId, { message: 'Concurrent answer', question_id: 'q0', request_id, version: concurrent.version })))
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1)
    assert.equal(outcomes.filter(o => o.status === 'rejected' && o.reason.status === 409).length, 1)
    concurrent = await service.get(candidate, concurrentId)
    assert.equal(concurrent.answers.length, 1)
    concurrent = await service.transition(candidate, concurrentId, 'pause', { version: concurrent.version })
    await assert.rejects(service.message(candidate, concurrentId, { message: 'Paused answer', question_id: 'q1', request_id: 'paused', version: concurrent.version }), /not in progress/)
    concurrent = await service.transition(candidate, concurrentId, 'start', { version: concurrent.version })
    const callsBeforeSkip = aiCalls
    concurrent = await service.message(candidate, concurrentId, { confirm: true, question_id: 'q1', request_id: 'skip', version: concurrent.version }, true)
    assert.equal(concurrent.evaluation_status, 'not_assessed')
    assert.equal(aiCalls, callsBeforeSkip)
    concurrent = await service.transition(candidate, concurrentId, 'complete', { version: concurrent.version, confirm: true })
    assert.equal((await service.report(recruiter, concurrentId)).overall, null)
  } finally {
    await closeStore()
    await repo.close()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})

test('legacy relational schema upgrades before creating new-column indexes', { skip: !url }, async () => {
  const parsed = new URL(url)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname))
  const schema = `upgrade_${randomUUID().replaceAll('-', '')}`
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  try {
    await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`)
    await db.query(`
      CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT,company_name TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE profiles(email TEXT PRIMARY KEY,data JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE interview_results(email TEXT PRIMARY KEY,overall INT,data JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE interview_sessions(session_id TEXT PRIMARY KEY,email TEXT,data JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE confidential_candidates(id TEXT PRIMARY KEY,data JSONB,sort_order INT,created_at TIMESTAMPTZ DEFAULT NOW());
      INSERT INTO confidential_candidates VALUES('legacy','{}',0,NOW());
    `)
    await applySchema(db)
    await applySchema(db)
    assert.equal((await db.query("SELECT organization_id FROM confidential_candidates WHERE id='legacy'")).rows[0].organization_id, 'org-platform')
    const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='users'", [schema])
    assert.ok(columns.rows.some(r => r.column_name === 'primary_organization_id'))
  } finally {
    await db.query(`DROP SCHEMA ${schema} CASCADE`)
    await db.end()
  }
})
