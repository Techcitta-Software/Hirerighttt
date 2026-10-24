import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPool, ensurePool } from './store.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TALENT_SCHEMA = join(__dirname, 'schema-talent-search.sql')

async function getPool(databaseUrl) {
  await ensurePool(databaseUrl)
  return dbPool(databaseUrl)
}

export async function ensureTalentSchema(databaseUrl) {
  const sql = readFileSync(TALENT_SCHEMA, 'utf8')
  await (await getPool(databaseUrl)).query(sql)
}

/**
 * @param {{ id: string, email: string, name: string, role?: string }} user
 * @param {Record<string, unknown>} profile
 * @param {{ overall?: number } | null} [interview]
 */
export function buildTalentRecord(user, profile, interview = null) {
  const skillsRaw = profile.skills
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.map((s) => String(s).trim()).filter(Boolean).slice(0, 80)
    : String(profile.keyStrengths || '')
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 80)

  const resumeSnippet = String(
    profile.resumeText || profile.experienceSummary || profile.whoAreYou || '',
  ).slice(0, 12000)

  const visibility =
    profile.profileVisibility === 'private' || profile.profileVisibility === 'organization_only'
      ? profile.profileVisibility
      : 'marketplace'

  return {
    userId: user.id,
    email: user.email.toLowerCase(),
    fullName: String(profile.fullName || profile.name || user.name || user.email).trim(),
    currentRole: String(profile.currentRole || profile.whoAreYou || '').trim(),
    location: String(profile.currentLocation || profile.location || '').trim(),
    experienceYears: String(profile.totalExperience || profile.experienceYears || '').trim(),
    skills,
    summary: String(
      profile.whoAreYou || profile.experienceSummary || profile.whatDrivesYou || '',
    ).slice(0, 4000),
    resumeSnippet,
    interviewScore:
      typeof interview?.overall === 'number'
        ? interview.overall
        : typeof profile.interviewScore === 'number'
          ? profile.interviewScore
          : null,
    profileVisibility: visibility,
  }
}

export async function upsertCandidateTalent(databaseUrl, user, profile, interview = null) {
  if (!databaseUrl || !user?.id || user.role === 'employer') return
  await ensureTalentSchema(databaseUrl)
  const row = buildTalentRecord(user, profile || {}, interview)

  await (await getPool(databaseUrl)).query(
    `INSERT INTO candidate_talent_profiles (
       user_id, email, full_name, role_title, location, experience_years,
       skills, summary, resume_snippet, interview_score, profile_visibility, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       email = EXCLUDED.email,
       full_name = EXCLUDED.full_name,
       role_title = EXCLUDED.role_title,
       location = EXCLUDED.location,
       experience_years = EXCLUDED.experience_years,
       skills = EXCLUDED.skills,
       summary = EXCLUDED.summary,
       resume_snippet = EXCLUDED.resume_snippet,
       interview_score = COALESCE(EXCLUDED.interview_score, candidate_talent_profiles.interview_score),
       profile_visibility = EXCLUDED.profile_visibility,
       updated_at = NOW()`,
    [
      row.userId,
      row.email,
      row.fullName,
      row.currentRole || null,
      row.location || null,
      row.experienceYears || null,
      row.skills,
      row.summary || null,
      row.resumeSnippet || null,
      row.interviewScore,
      row.profileVisibility,
    ],
  )
}

export async function grantOrganizationTalentAccess(
  databaseUrl,
  organizationId,
  userId,
  accessType = 'application',
) {
  if (!databaseUrl || !organizationId || !userId) return
  await ensureTalentSchema(databaseUrl)
  await (await getPool(databaseUrl)).query(
    `INSERT INTO organization_talent_access (organization_id, user_id, access_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [organizationId, userId, accessType],
  )
}

/**
 * Employer talent search (Postgres FTS + filters).
 * @param {string} databaseUrl
 * @param {string} organizationId
 * @param {{ q?: string, skills?: string[], location?: string, minScore?: number, limit?: number, offset?: number }} filters
 */
export async function searchCandidateTalent(databaseUrl, organizationId, filters = {}) {
  await ensureTalentSchema(databaseUrl)
  const limit = Number.isFinite(filters.limit) ? Math.min(Math.max(Math.trunc(filters.limit), 1), 100) : 25
  const offset = Number.isFinite(filters.offset) ? Math.max(Math.trunc(filters.offset), 0) : 0
  const q = String(filters.q || '').trim()
  const location = String(filters.location || '').trim()
  const minScore =
    typeof filters.minScore === 'number' && !Number.isNaN(filters.minScore)
      ? filters.minScore
      : null
  const skills = (filters.skills || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
  const experienceYears = String(filters.experienceYears || '').trim()

  const params = [organizationId]
  let paramIdx = 2

  let visibilitySql = `(
    t.profile_visibility = 'marketplace'
    OR EXISTS (
      SELECT 1 FROM organization_talent_access a
      WHERE a.organization_id = $1 AND a.user_id = t.user_id
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE (u.id = t.user_id OR lower(u.email) = lower(t.email))
      AND COALESCE(u.role, 'jobseeker') = 'employer'
  )`

  let scoreSql = ''
  if (minScore != null) {
    scoreSql = ` AND t.interview_score IS NOT NULL AND t.interview_score >= $${paramIdx}`
    params.push(minScore)
    paramIdx++
  }

  let locationSql = ''
  if (location) {
    locationSql = ` AND t.location ILIKE $${paramIdx}`
    params.push(`%${location}%`)
    paramIdx++
  }

  let skillsSql = ''
  if (skills.length) {
    skillsSql = ` AND EXISTS (SELECT 1 FROM unnest(t.skills) skill WHERE lower(skill) = ANY($${paramIdx}::text[]))`
    params.push(skills)
    paramIdx++
  }

  let experienceSql = ''
  if (experienceYears) {
    experienceSql = ` AND t.experience_years ILIKE $${paramIdx}`
    params.push(`%${experienceYears}%`)
    paramIdx++
  }

  let rankSelect = '0::float AS rank'
  let orderSql = 't.interview_score DESC NULLS LAST, t.updated_at DESC'
  let textSql = ''

  if (q) {
    const andParts = q.split(/\s+AND\s+/i).map((p) => p.trim()).filter(Boolean)
    if (andParts.length > 1) {
      const clauses = []
      for (const part of andParts) {
        params.push(part)
        const p = `$${paramIdx++}`
        clauses.push(`(
          t.search_vector @@ plainto_tsquery('english', ${p})
          OR t.full_name ILIKE '%' || ${p} || '%'
          OR t.role_title ILIKE '%' || ${p} || '%'
          OR t.experience_years ILIKE '%' || ${p} || '%'
          OR t.resume_snippet ILIKE '%' || ${p} || '%'
          OR EXISTS (SELECT 1 FROM unnest(t.skills) s WHERE s ILIKE '%' || ${p} || '%')
        )`)
      }
      textSql = ` AND ${clauses.join(' AND ')}`
      orderSql = 't.interview_score DESC NULLS LAST, t.updated_at DESC'
    } else {
      params.push(q)
      const qParam = `$${paramIdx}`
      paramIdx++
      textSql = ` AND (
        t.search_vector @@ plainto_tsquery('english', ${qParam})
        OR t.full_name ILIKE '%' || ${qParam} || '%'
        OR t.role_title ILIKE '%' || ${qParam} || '%'
        OR t.email ILIKE '%' || ${qParam} || '%'
        OR t.experience_years ILIKE '%' || ${qParam} || '%'
        OR t.resume_snippet ILIKE '%' || ${qParam} || '%'
        OR EXISTS (SELECT 1 FROM unnest(t.skills) s WHERE s ILIKE '%' || ${qParam} || '%')
      )`
      rankSelect = `ts_rank(t.search_vector, plainto_tsquery('english', ${qParam})) AS rank`
      orderSql = 'rank DESC NULLS LAST, t.interview_score DESC NULLS LAST, t.updated_at DESC'
    }
  }

  params.push(limit, offset)
  const limitParam = `$${paramIdx}`
  const offsetParam = `$${paramIdx + 1}`

  const sql = `
    SELECT
      t.user_id,
      t.email,
      t.full_name,
      t.role_title,
      t.location,
      t.experience_years,
      t.skills,
      t.summary,
      LEFT(t.resume_snippet, 500) AS resume_preview,
      t.interview_score,
      t.profile_visibility,
      t.updated_at,
      ${rankSelect}
    FROM candidate_talent_profiles t
    WHERE ${visibilitySql}
      AND t.profile_visibility <> 'private'
      ${textSql}
      ${locationSql}
      ${skillsSql}
      ${experienceSql}
      ${scoreSql}
    ORDER BY ${orderSql}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM candidate_talent_profiles t
    WHERE ${visibilitySql}
      AND t.profile_visibility <> 'private'
      ${textSql}
      ${locationSql}
      ${skillsSql}
      ${experienceSql}
      ${scoreSql}
  `

  const poolRef = await getPool(databaseUrl)
  const [rows, countRes] = await Promise.all([
    poolRef.query(sql, params),
    poolRef.query(countSql, params.slice(0, params.length - 2)),
  ])

  return {
    total: countRes.rows[0]?.total ?? 0,
    candidates: rows.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      fullName: r.full_name,
      currentRole: r.role_title,
      location: r.location,
      experienceYears: r.experience_years,
      skills: r.skills || [],
      summary: r.summary,
      resumePreview: r.resume_preview,
      interviewScore: r.interview_score,
      profileVisibility: r.profile_visibility,
      updatedAt: r.updated_at,
      rank: r.rank,
    })),
  }
}

export async function getCandidateTalentById(databaseUrl, organizationId, userId) {
  await ensureTalentSchema(databaseUrl)
  const res = await (await getPool(databaseUrl)).query(
    `SELECT t.*
     FROM candidate_talent_profiles t
     WHERE t.user_id = $2
       AND t.profile_visibility <> 'private'
       AND (
         t.profile_visibility = 'marketplace'
         OR EXISTS (
           SELECT 1 FROM organization_talent_access a
           WHERE a.organization_id = $1 AND a.user_id = t.user_id
         )
       )`,
    [organizationId, userId],
  )
  const r = res.rows[0]
  if (!r) return null
  return {
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    currentRole: r.role_title,
    location: r.location,
    experienceYears: r.experience_years,
    skills: r.skills || [],
    summary: r.summary,
    resumeSnippet: r.resume_snippet,
    interviewScore: r.interview_score,
    profileVisibility: r.profile_visibility,
    updatedAt: r.updated_at,
  }
}

/** Sync all jobseekers from in-memory db snapshot (boot / admin). */
export async function listOrganizationTalentUserIds(databaseUrl, organizationId) {
  if (!databaseUrl || !organizationId) return []
  await ensureTalentSchema(databaseUrl)
  const res = await (await getPool(databaseUrl)).query(
    `SELECT user_id FROM organization_talent_access WHERE organization_id = $1`,
    [organizationId],
  )
  return res.rows.map((r) => r.user_id)
}

export async function reindexTalentFromDb(databaseUrl, db) {
  if (!databaseUrl) return { indexed: 0 }
  let indexed = 0
  for (const user of db.users || []) {
    if (user.role === 'employer') continue
    const profile = db.profiles?.[user.email] || {}
    const interview = db.interviews?.[user.email] || null
    await upsertCandidateTalent(databaseUrl, user, profile, interview)
    indexed++
  }
  return { indexed }
}
