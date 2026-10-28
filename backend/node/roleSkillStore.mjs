import { normalizeRoleKey, findRoleSkills } from './roleSkillLookup.mjs'
export { normalizeRoleKey } from './roleSkillLookup.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.mjs'
import { dbPool } from './db/store.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const JSON_PATH = join(__dirname, 'data', 'roleSkills.json')
/** Top skills stored and used per role (see roleSkills.json). */
export const MAX_SKILLS_PER_ROLE = 3

/** @type {Map<string, { displayRole: string, skills: string[] }>} */
let cache = new Map()
let cacheReady = null
let jsonLoadedIntoCache = false

function ensureJsonLoadedIntoCache() {
  if (jsonLoadedIntoCache) return
  loadFromJsonIntoCache()
  jsonLoadedIntoCache = true
}

const clean = (s) => String(s ?? '').trim()



function readJsonFile() {
  try {
    const raw = readFileSync(JSON_PATH, 'utf8')
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function writeJsonFile(obj) {
  writeFileSync(JSON_PATH, `${JSON.stringify(obj, null, 2)}\n`, 'utf8')
}

function skillsFromRegexLibrary(exactRole) {
  const ROLE_SKILL_LIBRARY = [
    { test: /python.*(?:developer|engineer)|django|fastapi/i, skills: ['Python', 'SQL', 'REST APIs', 'Git', 'Testing', 'Docker'] },
    { test: /java\b.*(?:developer|engineer)|spring/i, skills: ['Java', 'SQL', 'Spring', 'REST APIs', 'Git', 'System Design'] },
    { test: /\bfull[\s-]?stack|mern|mean\b/i, skills: ['React.js', 'Node.js', 'TypeScript', 'REST APIs', 'SQL', 'MongoDB', 'System Design', 'Git'] },
    { test: /\bfront[\s-]?end|frontend\b/i, skills: ['React.js', 'TypeScript', 'JavaScript', 'HTML5 & CSS3', 'TailwindCSS', 'Next.js', 'Redux', 'REST APIs'] },
    { test: /\bback[\s-]?end|backend\b/i, skills: ['Node.js', 'Python', 'Java', 'PostgreSQL', 'REST APIs', 'System Design', 'Docker', 'Redis'] },
    { test: /\bsoftware engineer|software developer\b/i, skills: ['JavaScript', 'Python', 'Git', 'SQL', 'REST APIs', 'System Design', 'Agile', 'Problem Solving'] },
    { test: /\bdata scientist|machine learning|ml engineer|ai engineer\b/i, skills: ['Python', 'AI / ML', 'SQL', 'Statistics', 'Data Structures', 'TensorFlow', 'Pandas', 'Communication'] },
    { test: /\bdevops|sre|platform engineer\b/i, skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD', 'Linux', 'Terraform', 'Monitoring', 'Git'] },
    { test: /\bmobile|android|ios|flutter\b/i, skills: ['Flutter', 'React Native', 'Kotlin', 'Swift', 'REST APIs', 'Git', 'UI/UX', 'Firebase'] },
    { test: /\bqa|quality assurance|test engineer\b/i, skills: ['Selenium', 'Test Automation', 'API Testing', 'Agile', 'Git', 'SQL', 'Communication', 'Problem Solving'] },
    { test: /\bproduct manager|product owner\b/i, skills: ['Agile', 'Communication', 'Leadership', 'Analytics', 'Roadmapping', 'Stakeholder Management', 'SQL', 'Problem Solving'] },
    { test: /design|ux|ui\b/i, skills: ['User research', 'Interaction design', 'Figma', 'Accessibility', 'Prototyping', 'Visual design', 'Usability testing', 'Design systems'] },
  ]
  const hit = ROLE_SKILL_LIBRARY.find((entry) => entry.test.test(exactRole))
  return hit?.skills?.length ? [...hit.skills] : null
}

function mergeIntoCache(displayRole, skills, source = 'seed') {
  const key = normalizeRoleKey(displayRole)
  if (!key || !skills?.length) return
  const unique = [...new Set(skills.map(clean).filter(Boolean))].slice(0, MAX_SKILLS_PER_ROLE)
  cache.set(key, { displayRole: clean(displayRole), skills: unique, source })
}

async function loadFromDatabase() {
  if (!config.databaseUrl) return
  try {
    const res = await dbPool(config.databaseUrl).query(
      `SELECT role_key, display_role, skills FROM role_skill_library`,
    )
    for (const row of res.rows || []) {
      const skills = Array.isArray(row.skills) ? row.skills.map(String) : []
      mergeIntoCache(row.display_role || row.role_key, skills, 'db')
    }
  } catch (err) {
    console.warn('[roleSkillStore] DB load skipped:', err?.message || err)
  }
}

function loadFromJsonIntoCache() {
  const file = readJsonFile()
  for (const [role, skills] of Object.entries(file)) {
    if (!Array.isArray(skills)) continue
    mergeIntoCache(role, skills.map(String), 'json')
  }
}

async function syncJsonSeedToDatabase() {
  if (!config.databaseUrl) return
  const file = readJsonFile()
  const pool = dbPool(config.databaseUrl)
  for (const [role, skills] of Object.entries(file)) {
    if (!Array.isArray(skills) || !skills.length) continue
    const key = normalizeRoleKey(role)
    try {
      await pool.query(
        `INSERT INTO role_skill_library (role_key, display_role, skills, source, updated_at)
         VALUES ($1, $2, $3::jsonb, 'seed', now())
         ON CONFLICT (role_key) DO UPDATE SET
           display_role = EXCLUDED.display_role,
           skills = EXCLUDED.skills,
           source = 'seed',
           updated_at = now()`,
        [key, clean(role), JSON.stringify(skills.map(String))],
      )
    } catch {
      // schema may not be applied yet in local tests
    }
  }
}

export async function initRoleSkillStore() {
  if (cacheReady) return cacheReady
  cacheReady = (async () => {
    cache = new Map()
    jsonLoadedIntoCache = false
    ensureJsonLoadedIntoCache()
    await syncJsonSeedToDatabase()
    await loadFromDatabase()
  })()
  return cacheReady
}

function findInCache(exactRole) {
  return findRoleSkills(exactRole, Object.fromEntries([...cache.values()].map(entry => [entry.displayRole, entry.skills])));
}

/** @param {string} exactRole */
export function getSkillsForRole(exactRole) {
  ensureJsonLoadedIntoCache()
  const role = clean(exactRole)
  if (!role) return []
  const hit = findInCache(role)
  return hit?.length ? [...hit] : []
}

async function persistRoleSkills(displayRole, skills, source) {
  const role = clean(displayRole)
  const key = normalizeRoleKey(role)
  const unique = [...new Set(skills.map(clean).filter(Boolean))].slice(0, MAX_SKILLS_PER_ROLE)
  mergeIntoCache(role, unique, source)

  const file = readJsonFile()
  file[role] = unique
  try {
    writeJsonFile(file)
  } catch (err) {
    console.warn('[roleSkillStore] JSON write failed:', err?.message || err)
  }

  if (!config.databaseUrl) return unique
  try {
    await dbPool(config.databaseUrl).query(
      `INSERT INTO role_skill_library (role_key, display_role, skills, source, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (role_key) DO UPDATE SET
         display_role = EXCLUDED.display_role,
         skills = EXCLUDED.skills,
         source = EXCLUDED.source,
         updated_at = now()`,
      [key, role, JSON.stringify(unique), source],
    )
  } catch (err) {
    console.warn('[roleSkillStore] DB upsert failed:', err?.message || err)
  }
  return unique
}

async function generateSkillsWithLlm(exactRole, callLlm) {
  const role = clean(exactRole)
  const system = `You assign interview skills for a job role. Return ONLY JSON: {"skills":["skill1","skill2","skill3"]} with exactly 3 distinct, interview-worthy skills for the role. No prose.`
  const user = JSON.stringify({ role })
  const llm = await callLlm({ system, user, temperature: 0.35, tier: 'fast' })
  if (!llm?.text) return null
  try {
    const match = llm.text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    const skills = Array.isArray(parsed.skills) ? [...new Set(parsed.skills.filter(s => typeof s === 'string').map(clean).filter(Boolean))] : []
    return skills.length >= 3 ? skills.slice(0, MAX_SKILLS_PER_ROLE) : null
  } catch {
    return null
  }
}

/**
 * Resolve skills for a role: JSON/DB → regex library → LLM (persisted to JSON + Neon).
 * @param {string} exactRole
 * @param {{ callLlm?: (args: object) => Promise<{ text?: string } | null> }} [opts]
 */
export async function ensureRoleSkillsForRole(exactRole, opts = {}) {
  await initRoleSkillStore()
  const role = clean(exactRole) || 'Software Engineer'
  const existing = getSkillsForRole(role)
  if (existing.length >= MAX_SKILLS_PER_ROLE) return existing.slice(0, MAX_SKILLS_PER_ROLE)

  const fromRegex = skillsFromRegexLibrary(role)
  if (fromRegex?.length) {
    return persistRoleSkills(role, fromRegex, 'pattern')
  }

  const callLlm = opts.callLlm
  let generated = null
  if (callLlm) {
    try {
      generated = await generateSkillsWithLlm(role, callLlm)
    } catch (err) {
      console.warn('[roleSkillStore] LLM skill generation failed:', err?.message || err)
    }
  }
  const fallback = generated?.length
    ? generated
    : [`${role} fundamentals`, `${role} best practices`, 'Problem Solving']
  return persistRoleSkills(role, fallback, generated?.length ? 'ai' : 'fallback')
}
