import pg from 'pg'
import { check } from './contracts.mjs'

export function createRepository(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10000 })
  return {
    query: (sql, params) => pool.query(sql, params),
    close: () => pool.end(),
    async transaction(work) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally { client.release() }
    },
  }
}
export async function actorForEmail(db, email) {
  const { rows } = await db.query('SELECT id, email, role, status FROM users WHERE email=$1', [email])
  check(rows[0]?.status === 'active', 'Unauthorized', 401)
  return rows[0]
}
export async function requireRecruiter(db, actor, organizationId) {
  check(actor.role === 'employer', 'Recruiter account required', 403)
  const { rows } = await db.query(`SELECT m.role FROM organization_members m JOIN organizations o ON o.id=m.organization_id
    WHERE m.user_id=$1 AND m.organization_id=$2 AND o.status='active'`, [actor.id, organizationId])
  check(rows.length && ['owner', 'admin', 'recruiter'].includes(rows[0].role), 'Organization access denied', 403)
}
export async function loadSession(db, id, actor, { lock = false, candidateOnly = false, recruiterOnly = false } = {}) {
  const { rows } = await db.query(`SELECT * FROM assessment_sessions WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])
  const session = rows[0]
  check(session, 'Interview not found', 404)
  if (candidateOnly) check(session.candidate_id === actor.id, 'Interview not found', 404)
  else if (recruiterOnly || session.candidate_id !== actor.id) await requireRecruiter(db, actor, session.organization_id)
  return session
}
export async function sessionDetails(db, session) {
  const { rows: questions } = await db.query('SELECT data FROM interview_questions WHERE plan_id=$1 ORDER BY position', [session.plan_id])
  const { rows: jobs } = await db.query(`SELECT j.* FROM assessment_jobs j JOIN interview_plans p ON p.job_id=j.id WHERE p.id=$1`, [session.plan_id])
  return { questions: questions.map(q => q.data), job: jobs[0] }
}
export async function audit(db, actor, organizationId, sessionId, action, meta = {}) {
  await db.query('INSERT INTO assessment_events(organization_id,actor_id,session_id,action,meta) VALUES($1,$2,$3,$4,$5::jsonb)', [organizationId, actor.id, sessionId, action, JSON.stringify(meta)])
}
export async function usage(db, organizationId, purpose, result) {
  await db.query('INSERT INTO assessment_usage(organization_id,purpose,model,tokens,latency_ms,source) VALUES($1,$2,$3,$4,$5,$6)', [organizationId, purpose, result.model || null, result.tokens || 0, result.latency_ms || 0, result.source || 'llm'])
}
