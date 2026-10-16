import { mergeQaPair, applyEvaluation, computeFinalScore } from './logic.mjs'

/** @param {import('pg').Pool} pool @param {ReturnType<import('./logic.mjs').candidateRowFromUserAndProfile>} row */
export async function upsertCandidate(pool, row) {
  await pool.query(
    `INSERT INTO candidates (
      id, email, username, full_name, phone, password_hash, job_title, total_experience,
      location, resume_skills, resume_name, resume_text, experience_summary,
      work_experiences, certifications, preferred_roles, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      username = EXCLUDED.username,
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      password_hash = EXCLUDED.password_hash,
      job_title = EXCLUDED.job_title,
      total_experience = EXCLUDED.total_experience,
      location = EXCLUDED.location,
      resume_skills = EXCLUDED.resume_skills,
      resume_name = EXCLUDED.resume_name,
      resume_text = EXCLUDED.resume_text,
      experience_summary = EXCLUDED.experience_summary,
      work_experiences = EXCLUDED.work_experiences,
      certifications = EXCLUDED.certifications,
      preferred_roles = EXCLUDED.preferred_roles,
      updated_at = NOW()`,
    [
      row.id,
      row.email,
      row.username,
      row.full_name,
      row.phone,
      row.password_hash,
      row.job_title,
      row.total_experience,
      row.location,
      row.resume_skills,
      row.resume_name,
      row.resume_text,
      row.experience_summary,
      JSON.stringify(row.work_experiences),
      JSON.stringify(row.certifications),
      row.preferred_roles,
    ],
  )
}

export async function updateCandidatePasswordHash(pool, userId, passwordHash) {
  await pool.query(
    `UPDATE candidates SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash],
  )
}

function mapCandidateRow(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    fullName: row.full_name,
    phone: row.phone,
    jobTitle: row.job_title,
    totalExperience: row.total_experience,
    location: row.location,
    resumeSkills: row.resume_skills || [],
    resumeName: row.resume_name,
    resumeText: row.resume_text,
    experienceSummary: row.experience_summary,
    workExperiences: row.work_experiences,
    certifications: row.certifications,
    preferredRoles: row.preferred_roles || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getCandidate(pool, userId) {
  const res = await pool.query(
    `SELECT id, email, username, full_name, phone, job_title, total_experience, location,
            resume_skills, resume_name, resume_text, experience_summary, work_experiences,
            certifications, preferred_roles, created_at, updated_at
     FROM candidates WHERE id = $1`,
    [userId],
  )
  return mapCandidateRow(res.rows[0])
}

export async function createInterviewResult(pool, { id, candidateId, candidateName, candidateEmail, role, level }) {
  await pool.query(
    `INSERT INTO candidate_interview_results (
      id, candidate_id, candidate_name, candidate_email, role, level
    ) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (id) DO NOTHING`,
    [id, candidateId, candidateName || '', candidateEmail, role || '', level || ''],
  )
}

function mapResultRow(row, { includeQa = true } = {}) {
  if (!row) return null
  const base = {
    id: row.id,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    role: row.role,
    level: row.level,
    finalScore: row.final_score,
    scoredCount: row.scored_count,
    answerCount: row.answer_count,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }
  if (includeQa) base.qaPairs = row.qa_pairs || []
  return base
}

async function withLockedRow(pool, sessionId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, candidate_id, qa_pairs, status FROM candidate_interview_results WHERE id = $1 FOR UPDATE`,
      [sessionId],
    )
    const row = rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      throw Object.assign(new Error('Interview result not found.'), { status: 404 })
    }
    const outcome = await fn(client, row)
    await client.query('COMMIT')
    return outcome
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function recordQaPair(pool, sessionId, candidateId, pair) {
  return withLockedRow(pool, sessionId, async (client, row) => {
    if (row.candidate_id !== candidateId) {
      throw Object.assign(new Error('Interview result not found.'), { status: 404 })
    }
    if (row.status !== 'in_progress') {
      throw Object.assign(new Error('Interview is no longer in progress.'), { status: 409 })
    }
    const qaPairs = mergeQaPair(row.qa_pairs || [], pair)
    const { finalScore, scoredCount, answerCount } = computeFinalScore(qaPairs)
    await client.query(
      `UPDATE candidate_interview_results
         SET qa_pairs = $2::jsonb, final_score = $3, scored_count = $4, answer_count = $5, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, JSON.stringify(qaPairs), finalScore, scoredCount, answerCount],
    )
    return { qaPairs, finalScore, scoredCount, answerCount }
  })
}

export async function saveEvaluation(pool, sessionId, questionIndex, evaluation) {
  return withLockedRow(pool, sessionId, async (client, row) => {
    const qaPairs = row.qa_pairs || []
    const idx = qaPairs.findIndex((p) => p.questionIndex === questionIndex)
    if (idx < 0) return null
    const currentAnswer = String(qaPairs[idx].answer || '')
    if (evaluation.answer != null && String(evaluation.answer) !== currentAnswer) {
      return null
    }
    const { answer: _a, ...ev } = evaluation
    const next = applyEvaluation(qaPairs, questionIndex, {
      ...ev,
      evaluatedAt: ev.evaluatedAt || new Date().toISOString(),
    })
    const { finalScore, scoredCount, answerCount } = computeFinalScore(next)
    await client.query(
      `UPDATE candidate_interview_results
         SET qa_pairs = $2::jsonb, final_score = $3, scored_count = $4, answer_count = $5, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, JSON.stringify(next), finalScore, scoredCount, answerCount],
    )
    return { qaPairs: next, finalScore, scoredCount, answerCount }
  })
}

export async function finalizeInterviewResult(pool, sessionId, { status = 'completed' } = {}) {
  return withLockedRow(pool, sessionId, async (client, row) => {
    const { finalScore, scoredCount, answerCount } = computeFinalScore(row.qa_pairs || [])
    await client.query(
      `UPDATE candidate_interview_results
         SET status = $2, completed_at = NOW(), final_score = $3, scored_count = $4, answer_count = $5, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, status, finalScore, scoredCount, answerCount],
    )
    return { status, finalScore, scoredCount, answerCount }
  })
}

export async function getInterviewResult(pool, sessionId, candidateId) {
  const res = await pool.query(`SELECT * FROM candidate_interview_results WHERE id = $1`, [sessionId])
  const row = res.rows[0]
  if (!row || row.candidate_id !== candidateId) return null
  return mapResultRow(row, { includeQa: true })
}

export async function listInterviewResults(pool, candidateId, { limit = 20 } = {}) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20))
  const res = await pool.query(
    `SELECT id, candidate_id, candidate_name, candidate_email, role, level, final_score,
            scored_count, answer_count, status, started_at, completed_at, updated_at
     FROM candidate_interview_results
     WHERE candidate_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [candidateId, lim],
  )
  return res.rows.map((r) => mapResultRow(r, { includeQa: false }))
}
