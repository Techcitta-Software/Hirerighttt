import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { applySchema, EXPECTED_TABLES } from '../db/applySchema.mjs'

const url = process.env.SCHEMA_V2_TEST_DATABASE_URL
test('v2 design: tenant relationships, history, events and rollback', { skip: !url }, async () => {
  const parsed = new URL(url)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname))
  assert.match(parsed.pathname, /^\/hireright_schema_design_test$/,
    'Only the dedicated disposable test database is permitted')
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  await db.query('BEGIN')
  try {
    await applySchema(db)
    await db.query(await readFile(new URL('../db/design/schema-v2.sql', import.meta.url), 'utf8'))
    const original = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
    for (const table of EXPECTED_TABLES) assert.ok(original.rows.some(r => r.tablename === table))
    await db.query("INSERT INTO organizations(id,name,slug) VALUES ('v2-a','A','v2-a'),('v2-b','B','v2-b')")
    await db.query("INSERT INTO users(id,email,name,password_hash) VALUES ('v2-c','v2-c@example.test','C','unused'),('v2-d','v2-d@example.test','D','unused')")
    await db.query("INSERT INTO jobs(id,organization_id,title,company,shareable_code) VALUES ('v2-j','v2-a','Engineer','A','v2-j')")
    await db.query("INSERT INTO employer_applications(id,organization_id,job_id,candidate_user_id,candidate_email) VALUES ('v2-app','v2-a','v2-j','v2-c','v2-c@example.test')")
    const insertInterview = `INSERT INTO hiring.interviews(organization_id,candidate_id,job_id,application_id,workflow,source_session_id,status)
      VALUES($1,$2,$3,$4,'main',$5,'completed') RETURNING id`
    async function rejects(sql, params, code) {
      await db.query('SAVEPOINT invalid_case')
      await assert.rejects(db.query(sql, params), error => error.code === code)
      await db.query('ROLLBACK TO SAVEPOINT invalid_case')
      await db.query('RELEASE SAVEPOINT invalid_case')
    }
    await rejects(insertInterview, ['v2-b','v2-c','v2-j',null,'foreign-tenant'], '23503')
    await rejects(insertInterview, ['v2-a','v2-d','v2-j','v2-app','foreign-candidate'], '23503')
    const interview = (await db.query(insertInterview, ['v2-a','v2-c','v2-j','v2-app','main-1'])).rows[0].id
    const personal = (await db.query(insertInterview, [null,'v2-c',null,null,'personal-1'])).rows[0].id
    await db.query(insertInterview, ['v2-a','v2-c','v2-j','v2-app','main-2'])
    await rejects(insertInterview, ['v2-a','v2-c','v2-j','v2-app','main-1'], '23505')
    const fileInsert = `INSERT INTO hiring.file_objects(organization_id,candidate_id,interview_id,category,provider,bucket,object_key,content_type)
      VALUES($1,$2,$3,'recording','s3','private-bucket',$4,'video/webm')`
    await rejects(fileInsert, ['v2-b','v2-c',interview,'wrong-tenant'], '23503')
    await rejects(fileInsert, [null,'v2-d',personal,'wrong-candidate'], '23503')
    await db.query(fileInsert, ['v2-a','v2-c',interview,'recording-1'])
    await db.query(fileInsert, [null,'v2-c',personal,'recording-personal'])
    await rejects("UPDATE hiring.file_objects SET object_key='replacement' WHERE object_key='recording-1'", [], '23514')
    await rejects(`INSERT INTO hiring.resume_parses(file_id,parser,status)
      SELECT id,'paddleocr','queued' FROM hiring.file_objects WHERE object_key='recording-1'`, [], '23514')
    await rejects('UPDATE hiring.interviews SET organization_id=$1 WHERE id=$2', ['v2-b', personal], '23514')
    await db.query(`INSERT INTO hiring.scorecards(interview_id,version,overall,report_snapshot)
      VALUES($1,1,80,'{"exactReport":"preserved"}'),($1,2,82,'{"exactReport":"revised"}')`, [interview])
    await rejects('UPDATE hiring.scorecards SET overall=0 WHERE interview_id=$1', [interview], '23514')
    const report = (await db.query(`INSERT INTO hiring.file_objects
      (organization_id,candidate_id,interview_id,category,provider,bucket,object_key,content_type)
      VALUES('v2-a','v2-c',$1,'report','s3','private-bucket','report-v1','application/pdf') RETURNING id`, [interview])).rows[0].id
    const scorecard = (await db.query('SELECT id FROM hiring.scorecards WHERE interview_id=$1 AND version=1', [interview])).rows[0].id
    await db.query('INSERT INTO hiring.scorecard_files(scorecard_id,interview_id,file_id) VALUES($1,$2,$3)', [scorecard,interview,report])
    await rejects('UPDATE hiring.scorecard_files SET interview_id=$1 WHERE file_id=$2', [personal,report], '23503')
    const recording = (await db.query("SELECT id FROM hiring.file_objects WHERE object_key='recording-1'")).rows[0].id
    await rejects('INSERT INTO hiring.scorecard_files(scorecard_id,interview_id,file_id) VALUES($1,$2,$3)', [scorecard,interview,recording], '23503')
    const resume = (await db.query(`INSERT INTO hiring.file_objects
      (candidate_id,category,provider,bucket,object_key,content_type)
      VALUES('v2-c','resume','s3','private-bucket','resume-v1','application/pdf') RETURNING id`)).rows[0].id
    const parseInsert = "INSERT INTO hiring.resume_parses(file_id,parser,status) VALUES($1,'paddleocr','queued')"
    await db.query(parseInsert, [resume])
    await rejects(parseInsert, [resume], '23505')
    const question = (await db.query(`INSERT INTO hiring.interview_questions(interview_id,position,category,question_text)
      VALUES($1,0,'technical','Explain transactions') RETURNING id`, [interview])).rows[0].id
    const answer = (await db.query(`INSERT INTO hiring.interview_answers(interview_id,question_id,request_id,answer_text,status)
      VALUES($1,$2,'answer-1','A transaction is atomic','submitted') RETURNING id`, [interview,question])).rows[0].id
    const evaluation = (await db.query(`INSERT INTO hiring.answer_evaluations(answer_id,version,score,maximum_score)
      VALUES($1,1,4,5) RETURNING id`, [answer])).rows[0].id
    await rejects('UPDATE hiring.answer_evaluations SET maximum_score=3 WHERE id=$1', [evaluation], '23514')
    await rejects(`INSERT INTO hiring.evaluation_reviews(evaluation_id,reviewer_id,score,reason)
      VALUES($1,'v2-d',6,'Outside scale')`, [evaluation], '23514')
    await db.query(`INSERT INTO hiring.evaluation_reviews(evaluation_id,reviewer_id,score,reason)
      VALUES($1,'v2-d',5,'Human correction')`, [evaluation])
    const eventInsert = `INSERT INTO hiring.review_events(interview_id,event_id,event_type,occurred_at,start_offset_ms,duration_ms)
      VALUES($1,$2,$3,now(),$4,$5)`
    await db.query(eventInsert, [interview,'event-1','UNABLE_TO_ASSESS',5000,3000])
    await rejects(eventInsert, [interview,'event-2','NO_FACE_SEEN',-1,3000], '23514')
    await rejects(eventInsert, [interview,'event-3','CHEATING',5000,3000], '23514')
    await rejects(`INSERT INTO hiring.event_explanations(interview_id,event_id,candidate_id,explanation)
      VALUES($1,'event-1','v2-d','Not my interview')`, [interview], '23503')
    assert.equal((await db.query('SELECT overall FROM hiring.scorecards WHERE interview_id=$1 ORDER BY version DESC', [interview])).rows[0].overall, '82')
    await db.query(await readFile(new URL('../db/design/preflight.sql', import.meta.url), 'utf8'))
    const security = await db.query("SELECT count(*)::int AS total, count(*) FILTER(WHERE rowsecurity)::int AS secured FROM pg_tables WHERE schemaname='hiring'")
    assert.equal(security.rows[0].total, security.rows[0].secured)
    assert.equal(security.rows[0].total, 23)
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
})
