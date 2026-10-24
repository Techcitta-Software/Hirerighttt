/**
 * Match open job postings to a candidate profile (no extra tables).
 * Uses profile.currentRole, preferredRoles, and skills vs job.roleTrack + title.
 */

const ROLE_FAMILIES = [
  {
    id: 'ml',
    pattern: /machine learning|\bml\b|mlops|deep learning|\bnlp\b|computer vision|generative ai|\bllm\b|data scientist|ai engineer|research scientist/i,
    tags: ['machine', 'learning', 'ml', 'ai', 'data', 'scientist', 'nlp', 'vision', 'llm', 'mlops'],
  },
  {
    id: 'data',
    pattern: /data engineer|analytics engineer|data analyst|business intelligence|\bbi developer\b/i,
    tags: ['data', 'engineer', 'analyst', 'analytics', 'warehouse', 'pipeline', 'etl'],
  },
  {
    id: 'frontend',
    pattern: /frontend|front-end|react|\bui developer\b|web developer/i,
    tags: ['frontend', 'front', 'react', 'vue', 'angular', 'ui', 'web'],
  },
  {
    id: 'backend',
    pattern: /backend|back-end|api engineer|java developer|golang|\bgo developer\b/i,
    tags: ['backend', 'back', 'api', 'server', 'java', 'node', 'golang'],
  },
  {
    id: 'fullstack',
    pattern: /full stack|fullstack/i,
    tags: ['full', 'stack', 'fullstack'],
  },
  {
    id: 'devops',
    pattern: /devops|\bsre\b|site reliability|platform engineer|cloud engineer|kubernetes/i,
    tags: ['devops', 'sre', 'cloud', 'platform', 'kubernetes', 'infra'],
  },
  {
    id: 'qa',
    pattern: /\bqa\b|quality assurance|sdet|test engineer|automation engineer/i,
    tags: ['qa', 'quality', 'test', 'sdet', 'automation'],
  },
  {
    id: 'mobile',
    pattern: /mobile|\bios developer\b|\bandroid developer\b|flutter|react native/i,
    tags: ['mobile', 'ios', 'android', 'flutter'],
  },
  {
    id: 'product',
    pattern: /product manager|\bpm\b|product owner|technical product manager/i,
    tags: ['product', 'manager', 'owner'],
  },
  {
    id: 'security',
    pattern: /security engineer|appsec|cybersecurity/i,
    tags: ['security', 'appsec', 'cyber'],
  },
]

const GENERIC_ROLE_TOKENS = new Set([
  'engineer',
  'developer',
  'dev',
  'senior',
  'staff',
  'lead',
  'manager',
  'software',
  'specialist',
  'consultant',
  'analyst',
  'intern',
  'associate',
  'platform',
])

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./-\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
}

function familyForText(text) {
  const blob = String(text || '')
  for (const family of ROLE_FAMILIES) {
    if (family.pattern.test(blob)) return family
  }
  return null
}

/** @param {Record<string, unknown> | null | undefined} profile */
export function resolveCandidateRoleHints(profile) {
  const hints = []
  const current = profile?.currentRole ?? profile?.current_role
  if (typeof current === 'string' && current.trim()) hints.push(current.trim())
  const preferred = profile?.preferredRoles ?? profile?.preferred_roles
  if (Array.isArray(preferred)) {
    for (const r of preferred) {
      if (typeof r === 'string' && r.trim()) hints.push(r.trim())
    }
  }
  const skills = profile?.skills
  if (Array.isArray(skills)) {
    for (const s of skills.slice(0, 8)) {
      if (typeof s === 'string' && s.trim().length >= 4) hints.push(s.trim())
    }
  }
  return [...new Set(hints)]
}

/**
 * @param {{ roleTrack?: string, title?: string }} job
 * @param {string[]} hints
 */
export function scoreJobRoleAlignment(job, hints) {
  const blob = `${job.roleTrack || ''} ${job.title || ''}`.trim()
  if (!blob || !hints.length) return 0

  let best = 0
  const jobLower = blob.toLowerCase()
  const jobTokens = new Set(tokenize(blob))

  for (const hint of hints) {
    const h = hint.toLowerCase()
    if (!h) continue

    if (jobLower.includes(h) || h.includes(jobLower.slice(0, Math.min(24, jobLower.length)))) {
      best = Math.max(best, 100)
    }

    const hintFamily = familyForText(h)
    const jobFamily = familyForText(blob)
    if (hintFamily && jobFamily && hintFamily.id === jobFamily.id) {
      best = Math.max(best, 92)
    }

    const hintTokens = tokenize(h)
    let overlap = 0
    for (const t of hintTokens) {
      if (t.length < 3 || GENERIC_ROLE_TOKENS.has(t)) continue
      for (const jt of jobTokens) {
        if (GENERIC_ROLE_TOKENS.has(jt)) continue
        if (jt.includes(t) || t.includes(jt)) {
          overlap++
          break
        }
      }
    }
    if (overlap >= 2) best = Math.max(best, 78)
    else if (overlap >= 1) best = Math.max(best, 55)
  }

  return best
}

const DEFAULT_MIN_SCORE = 50

/**
 * @param {Array<{ roleTrack?: string, title?: string }>} jobs
 * @param {Record<string, unknown> | null | undefined} profile
 */
export function filterOpenJobsForCandidate(jobs, profile, options = {}) {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE
  const hints = resolveCandidateRoleHints(profile)
  const totalOpen = jobs.length

  if (!hints.length) {
    return {
      jobs,
      hints: [],
      totalOpen,
      personalized: false,
      minScore,
    }
  }

  const scored = jobs
    .map((job) => ({ job, score: scoreJobRoleAlignment(job, hints) }))
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || String(b.job.createdAt || '').localeCompare(String(a.job.createdAt || '')))

  return {
    jobs: scored.map((row) => row.job),
    hints,
    totalOpen,
    personalized: true,
    minScore,
  }
}

/**
 * @param {import('../db/store.mjs').DbShape} db
 * @param {string} email
 * @param {Array<Record<string, unknown>>} jobs
 * @param {'matched' | 'all'} scope
 */
export function applyCandidateJobScope(db, email, jobs, scope) {
  const normalizedScope = scope === 'all' ? 'all' : 'matched'
  const totalOpen = jobs.length

  if (normalizedScope === 'all') {
    return {
      jobs,
      meta: { scope: 'all', totalOpen, matchedCount: totalOpen, candidateRoleHints: [] },
    }
  }

  const user = (db.users || []).find((u) => u.email === email)
  if (user?.role === 'employer') {
    return {
      jobs,
      meta: { scope: 'all', totalOpen, matchedCount: totalOpen, candidateRoleHints: [] },
    }
  }

  const profile = db.profiles?.[email] || {}
  const filtered = filterOpenJobsForCandidate(jobs, profile)

  if (!filtered.personalized) {
    return {
      jobs,
      meta: {
        scope: 'matched',
        totalOpen,
        matchedCount: totalOpen,
        candidateRoleHints: [],
        personalized: false,
        message: 'Add your current role on your profile to see tailored job matches.',
      },
    }
  }

  return {
    jobs: filtered.jobs,
    meta: {
      scope: 'matched',
      totalOpen,
      matchedCount: filtered.jobs.length,
      candidateRoleHints: filtered.hints,
      personalized: true,
      minMatchScore: filtered.minScore,
    },
  }
}
