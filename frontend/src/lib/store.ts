import type { ProfileFormData } from '../data/wizard'
import { normalizeMetrics } from '../data/wizard'
import { extractNameFromText } from './resumeParser'

export type UserRole = 'jobseeker' | 'employer'

export type User = {
  id: string
  name: string
  email: string
  password: string
  role?: UserRole
  companyName?: string
  phone?: string
  /** Neon org scope for employer accounts (API session sync). */
  primaryOrganizationId?: string
  createdAt: string
}


/** Profile without File objects — safe for localStorage. */
export type SavedProfile = Omit<ProfileFormData, 'resumeFile'> & {
  fullName?: string
  name?: string
  resumeName: string | null
  /** Raw extracted resume text for Ava's resume-accurate questions. */
  resumeText?: string
  resumeUrl?: string | null
  resumeStoragePath?: string | null
  resumeFileId?: string | null
  storageProvider?: 's3' | 'supabase' | null
  updatedAt: string
  completedSteps: number
}

export type AnswerAnalysis = {
  question: string
  answer: string
  score: number
  wordCount: number
  keywordsHit: string[]
  feedback: string
  topic?: string
  performance?: string
  rubrics?: { id: string; label: string; score: number; weight?: number }[]
}

export type IntegrityLogEvent = {
  id: string
  startOffsetSec?: number
  durationSec?: number
  reviewOnly?: boolean
  candidateExplanation?: string
  timestamp: string
  formattedTime: string
  eventType:
    | 'UNABLE_TO_ASSESS'
    | 'NO_FACE_SEEN'
    | 'MULTIPLE_FACES_DETECTED'
    | 'SIDE_GAZE_LOOKING_AWAY'
    | 'EXCESSIVE_MOVEMENT'
    | 'INTERVIEW_BANNED'
  severity: 'warn' | 'block' | 'ban'
  message: string
  questionIndex?: number
}

export type CareerScorecard = {
  careerScore: number
  industryAlignment: number
  donuts: { label: string; score: number; tag: string; color: string }[]
  healthMetrics: { label: string; icon: string; score: number; tag: string; color: string }[]
  qaRows: {
    index: number
    topic: string
    question: string
    accuracy: number
    clarity: number
    understanding: number
    depth: number
    total30?: number
    total40: number
    stars: string
    feedback: string
    performance?: string
  }[]
  bandInterpretation?: string
  scoreSubHint?: string
  industryAlignmentCaption?: string
  positioningRecommendations?: string[]
  positioningFooter?: string
  recommendedRoles?: string[]
  nextRecommendedStep?: string
  finalCareerStatus?: string
  radarAxes: { label: string; val: number }[]
  careerPaths: { role: string; match: number }[]
  starPatterns: { name: string; stars: string; level: string }[]
  priorities: { num: number; title: string; text: string }[]
  coachNotes: string
  sessionStats: {
    durationMinutes: number
    questionCount: number
    overallInterviewScore: number
    interviewType: string
  }
}

export type InterviewResult = {
  sessionId?: string
  role: string
  level: string
  date: string
  overall: number
  categories: { label: string; score: number }[]
  strengths: string[]
  improvements: string[]
  answers: AnswerAnalysis[]
  resumeFitScore?: number
  agent?: string
  scorecard?: CareerScorecard
  integrity?: {
    faceViolations: number
    singlePersonOk: boolean
    maxFacesSeen: number
    banned?: boolean
    banReason?: string
    sideLookWarnings?: number
    tooFarWarnings?: number
    logs?: IntegrityLogEvent[]
  }
}

export type Application = {
  id: string
  title: string
  company: string
  location: string
  match: number
  status: 'Applied' | 'In Review' | 'Interview' | 'Offer'
  appliedAt: string
  jobId?: string
  employerApplicationId?: string
  roleTrack?: string
  experienceLevel?: string
  shareableCode?: string
  companySlug?: string | null
  atsScore?: number
  interviewScore?: number | null
  jobStatus?: 'active' | 'deleted'
  jobDeletedAt?: string
  jobDeletedMessage?: string
}

export type EmployerJob = {
  id: string
  title: string
  company: string
  companySlug?: string
  roleTrack: string
  experienceLevel: string
  location: string
  jobDescription: string
  requiredSkills: string[]
  createdByEmail: string
  createdAt: string
  shareableCode: string
}

export type EmployerApplicant = {
  id: string
  jobId: string
  jobTitle: string
  company: string
  candidateName: string
  candidateEmail: string
  candidatePhone: string
  role?: string
  experienceYears: string
  resumeName: string | null
  resumeText?: string
  interviewResult?: InterviewResult
  appliedAt: string
  status: 'New' | 'Shortlisted' | 'In Review' | 'Interviewing' | 'Rejected'
  integrityStatus?: 'verified' | 'pending' | 'unverified'
  interviewRecordingAvailable?: boolean
  aiScore?: number
  atsScore?: number
  jdMatchScore?: number
  primarySkills?: string[]
}

const USERS_KEY = 'hireright.users'
const SESSION_KEY = 'hireright.session'
const PROFILE_KEY = 'hireright.profile'
const RESULT_KEY = 'hireright.interviewResult'
const APPS_KEY = 'hireright.applications'
const EMPLOYER_JOBS_KEY = 'hireright.employerJobs'
const EMPLOYER_APPLICANTS_KEY = 'hireright.employerApplicants'
const STORAGE_VERSION_KEY = 'hireright.storageVersion'
/** Bump when employer roster / DB shape changes — clears stale local demo data once. */
const CLIENT_STORAGE_VERSION = '2026-10-16-clean-roster-v1'

const LEGACY_DEMO_EMAILS = new Set([
  'demo@hireright.com',
  'employer@hireright.com',
  'admin@hireright.com',
])

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** One-time cleanup so browsers stop showing seeded demo rows after a DB reset. */
export function applyClientStorageMigration(): void {
  try {
    if (localStorage.getItem(STORAGE_VERSION_KEY) === CLIENT_STORAGE_VERSION) return

    clearEmployerPortalCache()
    localStorage.removeItem(APPS_KEY)
    localStorage.removeItem(EMPLOYER_JOBS_KEY)

    const raw = localStorage.getItem(USERS_KEY)
    if (raw) {
      const users = (JSON.parse(raw) as User[]).filter(
        (u) => !LEGACY_DEMO_EMAILS.has(u.email.trim().toLowerCase()),
      )
      writeUsers(users)
    }

    const sessionEmail = localStorage.getItem(SESSION_KEY)?.trim().toLowerCase()
    if (sessionEmail && LEGACY_DEMO_EMAILS.has(sessionEmail)) {
      localStorage.removeItem(SESSION_KEY)
    }

    localStorage.setItem(STORAGE_VERSION_KEY, CLIENT_STORAGE_VERSION)
    window.dispatchEvent(new Event('hireright-auth'))
  } catch {
    localStorage.setItem(STORAGE_VERSION_KEY, CLIENT_STORAGE_VERSION)
  }
}

function readUsers(): User[] {
  try {
    applyClientStorageMigration()
    const raw = localStorage.getItem(USERS_KEY)
    if (!raw) {
      const legacy = localStorage.getItem('hireright.user')
      if (legacy) {
        const user = JSON.parse(legacy) as User
        if (!user.id) user.id = uid()
        if (LEGACY_DEMO_EMAILS.has(user.email.trim().toLowerCase())) {
          localStorage.removeItem('hireright.user')
          return []
        }
        writeUsers([user])
        localStorage.removeItem('hireright.user')
        return [user]
      }
      return []
    }
    const users = JSON.parse(raw) as User[]
    if (users.length === 0) return []
    const next: User[] = users.map((u) => ({
      ...u,
      role:
        u.role ??
        (u.email.includes('employer') ? ('employer' as const) : ('jobseeker' as const)),
      companyName: u.companyName,
    }))
    const changed = next.some(
      (u, i) => u.role !== users[i]?.role || u.companyName !== users[i]?.companyName,
    )
    if (changed) writeUsers(next)
    return next
  } catch {
    return []
  }
}

function writeUsers(users: User[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

export function saveUser(
  input: Omit<User, 'id' | 'createdAt'> & { createdAt?: string },
  allowOverwrite = false,
  autoSignIn = true,
): User {
  const users = readUsers()
  const email = input.email.trim().toLowerCase()
  const existingIdx = users.findIndex((u) => u.email === email)

  if (existingIdx >= 0) {
    if (!allowOverwrite) {
      throw new Error('An account with this email already exists.')
    }
    users[existingIdx] = {
      ...users[existingIdx],
      name: input.name.trim() || users[existingIdx].name,
      password: input.password || users[existingIdx].password,
      role: input.role ?? users[existingIdx].role,
      companyName: input.companyName ?? users[existingIdx].companyName,
      phone: input.phone ?? users[existingIdx].phone,
    }
    writeUsers(users)
    if (autoSignIn) {
      localStorage.setItem(SESSION_KEY, email)
      window.dispatchEvent(new Event('hireright-auth'))
    }
    return users[existingIdx]
  }

  const user: User = {
    id: uid(),
    name: input.name.trim(),
    email,
    password: input.password,
    role: input.role ?? 'jobseeker',
    companyName: input.companyName,
    phone: input.phone,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
  users.push(user)
  writeUsers(users)
  if (autoSignIn) {
    localStorage.setItem(SESSION_KEY, user.email)
    window.dispatchEvent(new Event('hireright-auth'))
  }
  return user
}

export function findUserByEmail(email: string): User | undefined {
  return readUsers().find((u) => u.email === email.trim().toLowerCase())
}

export function getUser(): User | null {
  const email = localStorage.getItem(SESSION_KEY)
  if (!email) return null
  return readUsers().find((u) => u.email === email) ?? null
}

export function isLoggedIn(): boolean {
  return Boolean(getUser())
}

export function login(email: string, password: string): User | null {
  const user = readUsers().find(
    (u) => u.email === email.trim().toLowerCase() && u.password === password,
  )
  if (!user) return null
  localStorage.setItem(SESSION_KEY, user.email)
  window.dispatchEvent(new Event('hireright-auth'))
  return user
}

export function logout() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem('hireright.apiToken')
  window.dispatchEvent(new Event('hireright-auth'))
}

/** Drop cached employer lists when the active org changes (API is source of truth). */
export function clearEmployerPortalCache(): void {
  localStorage.removeItem(EMPLOYER_JOBS_KEY)
  localStorage.removeItem(EMPLOYER_APPLICANTS_KEY)
  window.dispatchEvent(new Event('hireright-employer-cache'))
}

/** Merge API `/me` user into local session (Neon / cookie auth). */
export function persistLoggedInUser(
  input: Pick<User, 'id' | 'name' | 'email'> &
    Partial<Pick<User, 'role' | 'companyName' | 'phone' | 'primaryOrganizationId'>>,
): User {
  const email = input.email.trim().toLowerCase()
  const users = readUsers()
  const idx = users.findIndex((u) => u.email === email)
  const role = input.role ?? users[idx]?.role ?? 'jobseeker'
  if (role === 'employer') clearEmployerPortalCache()

  if (idx >= 0) {
    users[idx] = {
      ...users[idx],
      id: input.id || users[idx].id,
      name: input.name.trim() || users[idx].name,
      role,
      companyName: input.companyName ?? users[idx].companyName,
      phone: input.phone ?? users[idx].phone,
      primaryOrganizationId:
        input.primaryOrganizationId ?? users[idx].primaryOrganizationId,
    }
    writeUsers(users)
    localStorage.setItem(SESSION_KEY, email)
    window.dispatchEvent(new Event('hireright-auth'))
    return users[idx]
  }

  const user: User = {
    id: input.id || uid(),
    name: input.name.trim() || email.split('@')[0],
    email,
    password: '',
    role,
    companyName: input.companyName,
    phone: input.phone,
    primaryOrganizationId: input.primaryOrganizationId,
    createdAt: new Date().toISOString(),
  }
  users.push(user)
  writeUsers(users)
  localStorage.setItem(SESSION_KEY, email)
  window.dispatchEvent(new Event('hireright-auth'))
  return user
}

export function updateUserName(name: string): User | null {
  const next = name.trim()
  if (!next) return getUser()
  sessionStorage.setItem('hireright.candidateName', next)
  localStorage.setItem('hireright.candidateName', next)

  const user = getUser()
  if (!user) return null
  const users = readUsers().map((entry) =>
    entry.email === user.email ? { ...entry, name: next } : entry,
  )
  writeUsers(users)
  window.dispatchEvent(new Event('hireright-auth'))
  return users.find((entry) => entry.email === user.email) ?? null
}

export function updateUserPassword(
  currentPassword: string,
  nextPassword: string,
): { ok: true } | { ok: false; error: string } {
  const user = getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  if (user.password !== currentPassword) {
    return { ok: false, error: 'Current password is incorrect.' }
  }
  if (nextPassword.length < 6) {
    return { ok: false, error: 'New password must be at least 6 characters.' }
  }
  const users = readUsers().map((entry) =>
    entry.email === user.email ? { ...entry, password: nextPassword } : entry,
  )
  writeUsers(users)
  return { ok: true }
}

export function updateUserEmail(
  nextEmail: string,
  password: string,
): { ok: true; email: string } | { ok: false; error: string } {
  const user = getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  if (user.password !== password) {
    return { ok: false, error: 'Password is incorrect.' }
  }
  const email = nextEmail.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' }
  }
  if (readUsers().some((u) => u.email === email && u.email !== user.email)) {
    return { ok: false, error: 'That email is already in use.' }
  }
  const users = readUsers().map((entry) =>
    entry.email === user.email ? { ...entry, email } : entry,
  )
  writeUsers(users)
  localStorage.setItem(SESSION_KEY, email)
  // Migrate profile key if present
  const oldKey = `${PROFILE_KEY}.${user.email}`
  const newKey = `${PROFILE_KEY}.${email}`
  const profileRaw = localStorage.getItem(oldKey)
  if (profileRaw) {
    localStorage.setItem(newKey, profileRaw)
    localStorage.removeItem(oldKey)
  }
  window.dispatchEvent(new Event('hireright-auth'))
  return { ok: true, email }
}

export type AccountPrefs = {
  emailMatchAlerts: boolean
  interviewReminders: boolean
  productTips: boolean
  profileVisibleToEmployers: boolean
  shareScoreOnApplications: boolean
  showOnlineStatus: boolean
}

const PREFS_KEY = 'hireright.prefs'

const DEFAULT_PREFS: AccountPrefs = {
  emailMatchAlerts: true,
  interviewReminders: true,
  productTips: false,
  profileVisibleToEmployers: true,
  shareScoreOnApplications: true,
  showOnlineStatus: false,
}

export function getAccountPrefs(): AccountPrefs {
  const user = getUser()
  if (!user) return { ...DEFAULT_PREFS }
  try {
    const raw = localStorage.getItem(`${PREFS_KEY}.${user.email}`)
    if (!raw) return { ...DEFAULT_PREFS }
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<AccountPrefs>) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function saveAccountPrefs(prefs: AccountPrefs): AccountPrefs {
  const user = getUser()
  if (!user) return prefs
  localStorage.setItem(`${PREFS_KEY}.${user.email}`, JSON.stringify(prefs))
  return prefs
}

export function profileKey(email?: string) {
  const e = email ?? getUser()?.email
  return e ? `${PROFILE_KEY}.${e}` : PROFILE_KEY
}

/** Drop cached wizard profile for an email (e.g. fresh signup). */
export function clearProfileForEmail(email: string) {
  localStorage.removeItem(profileKey(email.trim().toLowerCase()))
}

export function saveProfile(data: ProfileFormData, completedSteps = 0): SavedProfile {
  const user = getUser()
  const saved: SavedProfile = {
    whoAreYou: data.whoAreYou,
    whatDrivesYou: data.whatDrivesYou,
    keyStrengths: data.keyStrengths,
    currentRole: data.currentRole,
    totalExperience: data.totalExperience,
    currentLocation: data.currentLocation,
    noticePeriod: data.noticePeriod,
    skills: data.skills,
    experienceSummary: data.experienceSummary,
    workExperiences: data.workExperiences,
    noPriorWorkExperience: Boolean(data.noPriorWorkExperience),
    achievements: data.achievements,
    metrics: data.metrics,
    awards: data.awards,
    certifications: data.certifications,
    selfRating: data.selfRating,
    preferredRoles: data.preferredRoles,
    preferredLocations: data.preferredLocations,
    workMode: data.workMode,
    salaryExpectation: data.salaryExpectation,
    interviewNotes: data.interviewNotes,
    resumeName: data.resumeFile?.name ?? data.resumeName ?? getProfile()?.resumeName ?? null,
    resumeText: data.resumeText || getProfile()?.resumeText || '',
    resumeUrl: data.resumeUrl ?? getProfile()?.resumeUrl ?? null,
    resumeStoragePath: data.resumeStoragePath ?? getProfile()?.resumeStoragePath ?? null,
    resumeFileId: data.resumeFileId ?? getProfile()?.resumeFileId ?? null,
    storageProvider: data.storageProvider ?? getProfile()?.storageProvider ?? null,
    updatedAt: new Date().toISOString(),
    completedSteps: Math.max(completedSteps, getProfile()?.completedSteps ?? 0),
  }
  localStorage.setItem(profileKey(user?.email), JSON.stringify(saved))
  void import('./authConfig').then(({ requireApiForAuth }) => {
    if (!requireApiForAuth()) {
      void import('./supabaseSync').then((m) => m.syncProfileToSupabase(saved))
    }
  })
  return saved
}

function normalizeProfile(p: SavedProfile): SavedProfile {
  return {
    ...p,
    fullName: p.fullName || p.name || '',
    name: p.name || p.fullName || '',
    whoAreYou: p.whoAreYou ?? '',
    whatDrivesYou: p.whatDrivesYou ?? '',
    keyStrengths: p.keyStrengths ?? '',
    currentRole: p.currentRole ?? '',
    totalExperience: p.totalExperience ?? '',
    currentLocation: p.currentLocation ?? '',
    noticePeriod: p.noticePeriod ?? '',
    skills: Array.isArray(p.skills) ? p.skills : [],
    workExperiences: (Array.isArray(p.workExperiences) ? p.workExperiences : []).filter((w) => {
      // Discard legacy mock TechCitta unless candidate's resume actually mentions TechCitta
      const compLower = (w.company || '').toLowerCase()
      if (compLower.includes('techcitta') && !(p.resumeText || '').toLowerCase().includes('techcitta')) {
        return false
      }
      return Boolean(
        w.jobTitle?.trim() || w.company?.trim() || w.responsibilities?.trim(),
      )
    }),
    noPriorWorkExperience:
      p.noPriorWorkExperience === true &&
      !(Array.isArray(p.workExperiences) && p.workExperiences.some(
        (w) => w.jobTitle?.trim() || w.company?.trim(),
      )),
    metrics: normalizeMetrics(Array.isArray(p.metrics) ? p.metrics : undefined),
    awards: Array.isArray(p.awards) ? p.awards : [],
    certifications: Array.isArray(p.certifications) ? p.certifications : [],
    preferredRoles: Array.isArray(p.preferredRoles) ? p.preferredRoles : [],
    preferredLocations: Array.isArray(p.preferredLocations) ? p.preferredLocations : [],
    selfRating: typeof p.selfRating === 'number' ? p.selfRating : 0,
    workMode: p.workMode ?? '',
    salaryExpectation: p.salaryExpectation ?? '',
    interviewNotes: p.interviewNotes ?? '',
    resumeName: p.resumeName ?? null,
    resumeText: p.resumeText ?? '',
    completedSteps: p.completedSteps ?? 0,
  }
}

export function getProfile(): SavedProfile | null {
  const user = getUser()
  const raw =
    localStorage.getItem(profileKey(user?.email))
  if (!raw) return null
  try {
    return normalizeProfile(JSON.parse(raw) as SavedProfile)
  } catch {
    return null
  }
}

export function calcProfileStrength(profile: SavedProfile | null): number {
  if (!profile) {
    const interviewOnly = getInterviewResult()
    return interviewOnly ? Math.min(100, 28 + Math.round(interviewOnly.overall * 0.35)) : 8
  }
  let score = 6
  if (profile.resumeName) score += 6
  if (profile.whoAreYou.length > 40) score += 5
  if (profile.whatDrivesYou.length > 20) score += 4
  if (profile.keyStrengths.length > 10) score += 4
  if (profile.currentRole) score += 4
  if (profile.totalExperience) score += 3
  if (profile.currentLocation) score += 3
  if (profile.skills.length >= 3) score += 6
  if (profile.skills.length >= 8) score += 3
  if (profile.workExperiences.some((w) => w.jobTitle && w.company)) score += 6
  if (profile.achievements.filter(Boolean).length > 0) score += 4
  if (profile.metrics.some((m) => m.metric)) score += 3
  if (profile.certifications.some((c) => c.name)) score += 3
  if (profile.selfRating > 0) score += 2
  if (profile.preferredRoles.length > 0) score += 3
  const interview = getInterviewResult()
  if (interview) score += 20 + Math.round(interview.overall * 0.25)
  return Math.min(100, score)
}

/** Minimum 0–100 interview overall to apply (0 = disabled for testing). */
export const MIN_APPLY_SCORE = 0

/** 0–100 interview overall used for apply gates and job match (not career scorecard scale). */
export function resolveInterviewOverall(interview: InterviewResult | null | undefined): number | null {
  if (!interview) return null
  if (typeof interview.overall === 'number' && Number.isFinite(interview.overall)) {
    return interview.overall
  }
  const fromSession = interview.scorecard?.sessionStats?.overallInterviewScore
  if (typeof fromSession === 'number' && Number.isFinite(fromSession)) {
    return fromSession
  }
  const career = interview.scorecard?.careerScore
  if (typeof career === 'number' && Number.isFinite(career)) {
    return Math.round(Math.min(100, Math.max(0, career / 10)))
  }
  return null
}

export function normalizeInterviewResult(result: InterviewResult): InterviewResult {
  const overall = resolveInterviewOverall(result)
  if (overall === null) return result
  if (result.overall === overall) return result
  return { ...result, overall }
}

export function interviewResultKey(email?: string) {
  const e = (email ?? getUser()?.email)?.trim().toLowerCase()
  return e ? `${RESULT_KEY}.${e}` : RESULT_KEY
}

export function hasInterviewScore(): boolean {
  return resolveInterviewOverall(getInterviewResult()) !== null
}

/** Scorecard career score (e.g. 530 on a ~980 scale), not the 0–100 interview overall. */
export function getCareerDisplayScore(interview?: InterviewResult | null): number | null {
  if (!interview) return null
  const sc = interview.scorecard
  const overall = resolveInterviewOverall(interview)
  if (sc?.careerScore != null) return sc.careerScore
  if (overall != null) return Math.min(980, Math.max(50, Math.round(overall * 10)))
  return null
}

export function canApplyToJobs(): boolean {
  const overall = resolveInterviewOverall(getInterviewResult())
  return overall !== null && overall >= MIN_APPLY_SCORE
}

export type RankedJob = {
  id?: string
  title: string
  company: string
  location: string
  match: number
  locked: boolean
  shareableCode?: string
  companySlug?: string
  jobDescription?: string
  roleTrack?: string
  experienceLevel?: string
}

/** Job match % is derived from your real AI interview overall (1–99), not a static catalog score. */
export function jobMatchFromInterview(
  interviewOverall: number,
  jobTitle: string,
  roleHint: string,
  profileSkills: string[] = [],
): number {
  let match = interviewOverall
  const title = jobTitle.toLowerCase()
  const hint = roleHint.toLowerCase().trim()
  const hintToken = hint.split(/[\s/]+/).find((t) => t.length > 3) ?? ''

  if (hintToken && title.includes(hintToken)) {
    match += 2
  }
  if (profileSkills.some((s) => {
    const token = s.trim().toLowerCase()
    return token.length >= 3 && title.includes(token.slice(0, Math.min(6, token.length)))
  })) {
    match += 1
  }

  const jitter =
    (Math.abs(jobTitle.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % 5) - 2
  match += jitter

  return Math.max(1, Math.min(99, Math.round(match)))
}

export function rankPostedJobs(
  jobs: {
    id?: string
    title: string
    company: string
    location?: string
    shareableCode?: string
    companySlug?: string
    jobDescription?: string
    roleTrack?: string
    experienceLevel?: string
  }[],
): RankedJob[] {
  const interview = getInterviewResult()
  const interviewOverall = resolveInterviewOverall(interview)
  const profile = getProfile()
  const unlocked = interviewOverall !== null
  const roleHint =
    interview?.role ||
    profile?.currentRole ||
    profile?.preferredRoles?.[0] ||
    ''

  return jobs
    .filter((job) => job.title && job.company)
    .map((job) => {
      let match = 0
      if (unlocked && interviewOverall !== null) {
        match = jobMatchFromInterview(
          interviewOverall,
          job.title,
          roleHint,
          profile?.skills ?? [],
        )
      } else {
        match = 12
      }
      return {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location || 'Remote',
        match,
        locked: !unlocked,
        shareableCode: job.shareableCode,
        companySlug: job.companySlug,
        jobDescription: job.jobDescription,
        roleTrack: job.roleTrack,
        experienceLevel: job.experienceLevel,
      }
    })
    .sort((a, b) => b.match - a.match)
}

export function getRankedJobs(): RankedJob[] {
  return rankPostedJobs(
    getEmployerJobs().map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      shareableCode: job.shareableCode,
      companySlug: job.companySlug,
      jobDescription: job.jobDescription,
      roleTrack: job.roleTrack,
      experienceLevel: job.experienceLevel,
    })),
  )
}

export function saveInterviewResult(result: InterviewResult) {
  const normalized = normalizeInterviewResult(result)
  const key = interviewResultKey()
  localStorage.setItem(key, JSON.stringify(normalized))
  void import('./supabaseSync').then((m) => m.syncInterviewResultToSupabase(normalized))
  void import('./apiSync').then((m) => m.syncInterviewResultToApi(normalized))
}

export function getInterviewResult(): InterviewResult | null {
  const user = getUser()
  const keys: string[] = []
  if (user?.email) {
    const lower = user.email.trim().toLowerCase()
    keys.push(`${RESULT_KEY}.${lower}`)
    if (user.email !== lower) keys.push(`${RESULT_KEY}.${user.email}`)
  }
  // Unscoped legacy results have no verified owner. Never attach one to a signed-in account.
  if (!user?.email) keys.push(RESULT_KEY)

  for (const key of keys) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    try {
      const parsed = normalizeInterviewResult(JSON.parse(raw) as InterviewResult)
      return parsed
    } catch {
      continue
    }
  }
  return null
}

function appsKey() {
  const user = getUser()
  return user ? `${APPS_KEY}.${user.email}` : APPS_KEY
}

export function getApplications(): Application[] {
  try {
    const raw = localStorage.getItem(appsKey())
    return raw ? (JSON.parse(raw) as Application[]) : []
  } catch {
    return []
  }
}

export function saveApplications(apps: Application[]) {
  localStorage.setItem(appsKey(), JSON.stringify(apps))
}

export function applyToJob(job: {
  title: string
  company: string
  location: string
  match: number
}): Application {
  if (!canApplyToJobs()) {
    throw new Error(
      MIN_APPLY_SCORE > 0
        ? `Complete an AI interview scoring at least ${MIN_APPLY_SCORE} to apply.`
        : 'Complete an AI interview before applying.',
    )
  }
  const apps = getApplications()
  if (apps.some((a) => a.title === job.title && a.company === job.company)) {
    return apps.find((a) => a.title === job.title && a.company === job.company)!
  }
  const app: Application = {
    id: uid(),
    ...job,
    status: 'Applied',
    appliedAt: new Date().toISOString(),
  }
  apps.unshift(app)
  localStorage.setItem(appsKey(), JSON.stringify(apps))

  const user = getUser()
  const employerJobs = getEmployerJobs()
  const match =
    employerJobs.find(
      (j) =>
        j.title.toLowerCase() === job.title.toLowerCase() &&
        j.company.toLowerCase() === job.company.toLowerCase(),
    ) || employerJobs.find((j) => j.company.toLowerCase() === job.company.toLowerCase())

  if (user && match) {
    const already = getEmployerApplicants().some(
      (a) => a.jobId === match.id && a.candidateEmail === user.email,
    )
    if (!already) {
      saveEmployerApplicant({
        jobId: match.id,
        jobTitle: match.title,
        company: match.company,
        candidateName: user.name,
        candidateEmail: user.email,
        candidatePhone: '',
        experienceYears: getProfile()?.totalExperience || '',
        resumeName: getProfile()?.resumeName ?? null,
        resumeText: getProfile()?.resumeText,
        interviewResult: getInterviewResult() ?? undefined,
      })
    }
  }

  addNotification({
    kind: 'application',
    title: `Applied to ${job.title}`,
    body: `${job.company} received your application and AI score.`,
    href: '/applications',
  })
  return app
}

export function withdrawApplication(id: string) {
  const apps = getApplications().filter((a) => a.id !== id)
  localStorage.setItem(appsKey(), JSON.stringify(apps))
}

export function updateApplicationStatus(
  id: string,
  status: Application['status'],
) {
  const apps = getApplications().map((a) => (a.id === id ? { ...a, status } : a))
  localStorage.setItem(appsKey(), JSON.stringify(apps))
}

export function applicationStats() {
  const apps = getApplications()
  return {
    applied: apps.length,
    inReview: apps.filter((a) => a.status === 'In Review').length || Math.min(apps.length, Math.floor(apps.length * 0.4)),
    interviews: apps.filter((a) => a.status === 'Interview').length || (getInterviewResult() ? 1 : 0),
    offers: apps.filter((a) => a.status === 'Offer').length,
  }
}

const DEMO_DISPLAY_NAME = 'Arjun Sharma'

export function candidateFullName(): string {
  const profile = getProfile()

  // 1. Explicit session or local storage candidate name override
  const sessionName =
    sessionStorage.getItem('hireright.candidateName') ||
    localStorage.getItem('hireright.candidateName')
  if (sessionName && sessionName.trim() && sessionName.trim() !== DEMO_DISPLAY_NAME) {
    return sessionName.trim()
  }

  // 2. Profile saved name
  if (profile?.fullName && profile.fullName.trim() && profile.fullName.trim() !== DEMO_DISPLAY_NAME) {
    return profile.fullName.trim()
  }
  if (profile?.name && profile.name.trim() && profile.name.trim() !== DEMO_DISPLAY_NAME) {
    return profile.name.trim()
  }

  // 3. Name extracted from uploaded resume text (works for demo account + resume upload)
  if (profile?.resumeText) {
    const extracted = extractNameFromText(profile.resumeText)
    if (extracted && extracted.trim()) {
      sessionStorage.setItem('hireright.candidateName', extracted.trim())
      return extracted.trim()
    }
  }

  // 4. Name inferred from uploaded resume file name (e.g. "Deepak_Kumbhar_Resume.pdf")
  if (profile?.resumeName) {
    const cleanFileName = profile.resumeName
      .replace(/\.[^/.]+$/, '')
      .replace(/[_-]/g, ' ')
      .replace(/\b(resume|cv|biodata|profile|fullstack|frontend|backend|engineer|developer)\b/gi, '')
      .trim()
    const words = cleanFileName.split(/\s+/).filter((w) => w.length >= 2 && /^[A-Za-z]+$/.test(w))
    if (words.length >= 2 && words.length <= 4) {
      const extracted = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
      sessionStorage.setItem('hireright.candidateName', extracted)
      return extracted
    }
  }

  // 5. User record (if not generic demo label)
  const user = getUser()
  if (user?.name?.trim() && user.name.trim() !== DEMO_DISPLAY_NAME) {
    return user.name.trim()
  }

  if (sessionName?.trim()) {
    return sessionName.trim()
  }

  // Demo login without resume yet — neutral greeting, not seeded demo persona
  if (user?.email === 'demo@hireright.com') {
    return 'Candidate'
  }

  return user?.name?.trim() || 'Candidate'
}

export function firstName(): string {
  const full = candidateFullName()
  if (!full || full === 'Candidate' || full === 'there') return 'there'
  return full.split(' ')[0]
}

export const JOB_MATCHES = [
  {
    title: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    location: 'Hyderabad, India',
    match: 98,
  },
  {
    title: 'Full Stack Engineer',
    company: 'InnovatTech',
    location: 'Bengaluru, India',
    match: 95,
  },
  {
    title: 'Software Engineer (AI/ML)',
    company: 'MindCraft AI',
    location: 'Hyderabad, India',
    match: 92,
  },
  {
    title: 'Backend Engineer',
    company: 'CloudNest',
    location: 'Pune, India',
    match: 89,
  },
  {
    title: 'Product Analyst',
    company: 'Pulse Labs',
    location: 'Remote',
    match: 86,
  },
]

/* ---------- EMPLOYER ATS STORE ---------- */

export const DEFAULT_14_CANDIDATES: EmployerApplicant[] = [
  {
    id: 'cand-1',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Aarav Sharma',
    candidateEmail: 'aarav.sharma92@gmail.com',
    candidatePhone: '+91 90000 00101',
    role: 'Frontend Developer',
    experienceYears: '6 years',
    aiScore: 92,
    integrityStatus: 'verified',
    status: 'New',
    resumeName: 'Aarav_Sharma_Resume.pdf',
    resumeText: 'Senior Frontend Developer with 6 years experience in React, TypeScript, Next.js, Redux Toolkit, Web Performance & Micro-frontends. Led front-end architecture for high-traffic SaaS products.',
    appliedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    interviewResult: {
      role: 'Frontend Developer',
      level: '6+ years',
      date: new Date(Date.now() - 86400000 * 1).toISOString(),
      overall: 92,
      categories: [
        { label: 'Technical Accuracy', score: 94 },
        { label: 'Code Architecture', score: 92 },
        { label: 'Problem Solving', score: 90 },
        { label: 'Communication', score: 92 },
      ],
      strengths: ['Deep expertise in React internals, Virtual DOM, and Concurrent Mode', 'Clear breakdown of state management strategies'],
      improvements: ['Could elaborate more on automated visual regression testing'],
      answers: [
        { question: 'Explain how React Concurrent Mode improves UX', answer: 'Concurrent Mode allows React to interrupt long renders to handle user interactions smoothly...', score: 94, wordCount: 82, keywordsHit: ['fiber', 'interruptible', 'transitions'], feedback: 'Excellent technical depth.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-2',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Ananya Reddy',
    candidateEmail: 'ananya.reddy.ux@gmail.com',
    candidatePhone: '+91 90000 00102',
    role: 'UI/UX Designer',
    experienceYears: '5 years',
    aiScore: 88,
    integrityStatus: 'verified',
    status: 'Shortlisted',
    resumeName: 'Ananya_Reddy_Portfolio.pdf',
    resumeText: 'UI/UX Designer and Design Systems Architect with 5 years experience creating intuitive B2B and consumer web platforms. Expert in Figma, Tailwind, and Design Tokens.',
    appliedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    interviewResult: {
      role: 'UI/UX Designer',
      level: '5 years',
      date: new Date(Date.now() - 86400000 * 2).toISOString(),
      overall: 88,
      categories: [
        { label: 'Visual Design', score: 92 },
        { label: 'User Empathy', score: 90 },
        { label: 'Prototyping', score: 86 },
        { label: 'Design Systems', score: 84 },
      ],
      strengths: ['Strong portfolio of component systems and interaction design', 'Excellent cross-functional alignment with developers'],
      improvements: ['Could deepen knowledge of automated accessibility testing tools'],
      answers: [
        { question: 'Describe your approach to designing complex data tables', answer: 'I prioritize information hierarchy, clear column scannability, fixed headers, and inline action triggers...', score: 90, wordCount: 75, keywordsHit: ['hierarchy', 'scannability', 'density'], feedback: 'Very practical and user-centric approach.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-3',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Arjun Kapoor',
    candidateEmail: 'arjun.kapoor07@gmail.com',
    candidatePhone: '+91 90000 00103',
    role: 'Frontend Developer',
    experienceYears: '7 years',
    aiScore: 85,
    integrityStatus: 'verified',
    status: 'New',
    resumeName: 'Arjun_Kapoor_CV.pdf',
    resumeText: 'Senior Web Engineer with 7 years experience building scalable enterprise dashboards with React, TypeScript, GraphQL, and WebSockets.',
    appliedAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    interviewResult: {
      role: 'Frontend Developer',
      level: '7 years',
      date: new Date(Date.now() - 86400000 * 3).toISOString(),
      overall: 85,
      categories: [
        { label: 'Technical Depth', score: 86 },
        { label: 'Performance', score: 88 },
        { label: 'System Design', score: 84 },
        { label: 'Team Leadership', score: 82 },
      ],
      strengths: ['Great knowledge of WebSocket state caching and real-time UI rendering'],
      improvements: ['Code structure could adopt more functional composition patterns'],
      answers: [
        { question: 'How do you prevent unnecessary re-renders in large React apps?', answer: 'By profiling with React DevTools, memoizing expensive computations with useMemo, and keeping state localized...', score: 86, wordCount: 68, keywordsHit: ['memo', 'profiler', 'colocation'], feedback: 'Sound answer.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-4',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Divya Menon',
    candidateEmail: 'divya.menon.qa@gmail.com',
    candidatePhone: '+91 90000 00104',
    role: 'QA Engineer',
    experienceYears: '4 years',
    aiScore: 79,
    integrityStatus: 'pending',
    status: 'New',
    resumeName: 'Divya_Menon_QA.pdf',
    resumeText: 'SDET & QA Automation Engineer with 4 years experience in Cypress, Playwright, Jest, and CI/CD quality gates for enterprise web applications.',
    appliedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    interviewResult: {
      role: 'QA Engineer',
      level: '4 years',
      date: new Date(Date.now() - 86400000 * 3).toISOString(),
      overall: 79,
      categories: [
        { label: 'Test Automation', score: 84 },
        { label: 'Bug Triage', score: 80 },
        { label: 'CI/CD Pipelines', score: 76 },
        { label: 'Performance QA', score: 76 },
      ],
      strengths: ['Strong hands-on experience with Playwright and visual snapshot tests'],
      improvements: ['Integrity check flagged intermittent webcam stream interruption during stage 2.'],
      answers: [
        { question: 'What is your strategy for flaky tests in Cypress or Playwright?', answer: 'I inspect dynamic waits, avoid hardcoded sleeps, use network mocks when appropriate, and isolate state fixtures...', score: 82, wordCount: 70, keywordsHit: ['fixtures', 'flaky', 'retries'], feedback: 'Good automation understanding.' },
      ],
      integrity: { faceViolations: 1, singlePersonOk: false, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-5',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Karthik Iyer',
    candidateEmail: 'karthik.iyer88@gmail.com',
    candidatePhone: '+91 90000 00105',
    role: 'DevOps Engineer',
    experienceYears: '8 years',
    aiScore: 74,
    integrityStatus: 'verified',
    status: 'Interviewing',
    resumeName: 'Karthik_Iyer_DevOps.pdf',
    resumeText: 'Cloud Infrastructure & DevOps Engineer with 8 years experience managing AWS, Kubernetes, Terraform, and Docker container clusters.',
    appliedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    interviewResult: {
      role: 'DevOps Engineer',
      level: '8 years',
      date: new Date(Date.now() - 86400000 * 4).toISOString(),
      overall: 74,
      categories: [
        { label: 'Cloud Architecture', score: 82 },
        { label: 'Security & IAM', score: 78 },
        { label: 'Kubernetes', score: 72 },
        { label: 'Frontend Tooling Fit', score: 64 },
      ],
      strengths: ['Extensive DevOps background and infrastructure-as-code acumen'],
      improvements: ['Lacks direct UI frontend framework development exposure for pure frontend roles'],
      answers: [
        { question: 'How do you design zero-downtime deployments for web applications?', answer: 'Using blue-green or rolling canary deployments in Kubernetes backed by health probes and CDN cache invalidation...', score: 78, wordCount: 65, keywordsHit: ['canary', 'probes', 'ingress'], feedback: 'Solid DevOps knowledge.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-6',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Lakshmi Prasad',
    candidateEmail: 'lakshmi.prasad.fs@gmail.com',
    candidatePhone: '+91 90000 00106',
    role: 'Full Stack Developer',
    experienceYears: '5 years',
    aiScore: 90,
    integrityStatus: 'verified',
    status: 'Shortlisted',
    resumeName: 'Lakshmi_Prasad_FullStack.pdf',
    resumeText: 'Full Stack Developer with 5 years experience in React, Node.js, Express, PostgreSQL, and GraphQL. Experienced in building end-to-end full stack web platforms.',
    appliedAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    interviewResult: {
      role: 'Full Stack Developer',
      level: '5 years',
      date: new Date(Date.now() - 86400000 * 5).toISOString(),
      overall: 90,
      categories: [
        { label: 'Frontend Expertise', score: 92 },
        { label: 'Backend Architecture', score: 90 },
        { label: 'Database Design', score: 88 },
        { label: 'API Security', score: 90 },
      ],
      strengths: ['Excellent balance of frontend React engineering and Node.js REST/GraphQL backends'],
      improvements: ['None notable, candidate is well aligned with senior specifications'],
      answers: [
        { question: 'How do you manage client-side state caching with server APIs?', answer: 'I utilize TanStack Query or SWR for automatic deduplication, cache staleness, and optimistic mutations...', score: 92, wordCount: 76, keywordsHit: ['tanstack', 'optimistic', 'deduplication'], feedback: 'Modern and accurate technical approach.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-7',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Meera Joshi',
    candidateEmail: 'meera.joshi21@gmail.com',
    candidatePhone: '+91 90000 00107',
    role: 'Data Analyst',
    experienceYears: '3 years',
    aiScore: 81,
    integrityStatus: 'verified',
    status: 'New',
    resumeName: 'Meera_Joshi_Analytics.pdf',
    resumeText: 'Data Analyst with 3 years experience building interactive business intelligence dashboards, SQL models, Tableau reports, and Python analytics pipelines.',
    appliedAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    interviewResult: {
      role: 'Data Analyst',
      level: '3 years',
      date: new Date(Date.now() - 86400000 * 5).toISOString(),
      overall: 81,
      categories: [
        { label: 'SQL & Query Optimization', score: 86 },
        { label: 'Data Visualization', score: 84 },
        { label: 'Statistical Thinking', score: 80 },
        { label: 'Frontend Dashboards', score: 74 },
      ],
      strengths: ['Clear data presentation skills and SQL query proficiency'],
      improvements: ['Limited experience with React component development'],
      answers: [
        { question: 'What visual charts do you use for multi-dimensional data?', answer: 'I recommend scatter plots with sized bubbles or grouped heatmaps to visualize complex correlation...', score: 82, wordCount: 60, keywordsHit: ['heatmap', 'correlation', 'dimensions'], feedback: 'Good data visualization fundamentals.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-8',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Nisha Verma',
    candidateEmail: 'nisha.verma.data@gmail.com',
    candidatePhone: '+91 90000 00108',
    role: 'Data Analyst',
    experienceYears: '6 years',
    aiScore: 86,
    integrityStatus: 'verified',
    status: 'New',
    resumeName: 'Nisha_Verma_Resume.pdf',
    resumeText: 'Senior Data & Product Analyst with 6 years experience in growth telemetry, user funnels, A/B testing, and full-funnel conversion analysis.',
    appliedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    interviewResult: {
      role: 'Data Analyst',
      level: '6 years',
      date: new Date(Date.now() - 86400000 * 6).toISOString(),
      overall: 86,
      categories: [
        { label: 'A/B Experimentation', score: 90 },
        { label: 'Product Analytics', score: 88 },
        { label: 'Cohort Analysis', score: 86 },
        { label: 'Stakeholder Comms', score: 80 },
      ],
      strengths: ['Strong understanding of statistically valid hypothesis testing and p-values'],
      improvements: ['Could strengthen understanding of web performance metric correlation'],
      answers: [
        { question: 'How do you determine statistical significance in conversion tests?', answer: 'I calculate sample size requirements upfront, verify confidence intervals above 95%, and guard against peeking bias...', score: 88, wordCount: 67, keywordsHit: ['confidence', 'p-value', 'power'], feedback: 'Very methodical.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-9',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Priya Nair',
    candidateEmail: 'priya.nair.dev@gmail.com',
    candidatePhone: '+91 90000 00109',
    role: 'Full Stack Developer',
    experienceYears: '4 years',
    aiScore: 77,
    integrityStatus: 'pending',
    status: 'New',
    resumeName: 'Priya_Nair_FullStack.pdf',
    resumeText: 'Full Stack Engineer with 4 years experience in MERN stack, Next.js, and serverless architectures.',
    appliedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    interviewResult: {
      role: 'Full Stack Developer',
      level: '4 years',
      date: new Date(Date.now() - 86400000 * 6).toISOString(),
      overall: 77,
      categories: [
        { label: 'React / Next.js', score: 80 },
        { label: 'Node.js', score: 78 },
        { label: 'Code Quality', score: 76 },
        { label: 'Architecture', score: 74 },
      ],
      strengths: ['Hands-on with modern React hooks and Next.js SSR'],
      improvements: ['Proctor recorded minor side gaze warning during question 3.'],
      answers: [
        { question: 'What are the trade-offs between SSR and CSR?', answer: 'SSR provides fast First Contentful Paint and SEO benefits, while CSR saves server CPU and allows quick subsequent navigations...', score: 78, wordCount: 65, keywordsHit: ['ssr', 'seo', 'fcp'], feedback: 'Accurate overview.' },
      ],
      integrity: { faceViolations: 1, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-10',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Rahul Desai',
    candidateEmail: 'rahul.desai85@gmail.com',
    candidatePhone: '+91 90000 00110',
    role: 'Frontend Developer',
    experienceYears: '3 years',
    aiScore: 83,
    integrityStatus: 'verified',
    status: 'Interviewing',
    resumeName: 'Rahul_Desai_Frontend.pdf',
    resumeText: 'Frontend Developer with 3 years building responsive web apps with React, Tailwind CSS, TypeScript, and Vite.',
    appliedAt: new Date(Date.now() - 86400000 * 8).toISOString(),
    interviewResult: {
      role: 'Frontend Developer',
      level: '3 years',
      date: new Date(Date.now() - 86400000 * 7).toISOString(),
      overall: 83,
      categories: [
        { label: 'CSS / Styling', score: 88 },
        { label: 'Component Architecture', score: 84 },
        { label: 'JavaScript Fundamentals', score: 82 },
        { label: 'Problem Solving', score: 78 },
      ],
      strengths: ['Excellent modern CSS and responsive UI styling ability'],
      improvements: ['Needs more exposure to high-scale state management patterns'],
      answers: [
        { question: 'Explain CSS specificity and CSS Modules advantages', answer: 'CSS Modules scope class names locally via hashing to prevent unintended cascade collisions across large codebases...', score: 84, wordCount: 66, keywordsHit: ['hashing', 'scope', 'specificity'], feedback: 'Clear and concise.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-11',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Rohan Mehta',
    candidateEmail: 'rohan.mehta27@gmail.com',
    candidatePhone: '+91 90000 00111',
    role: 'Backend Developer',
    experienceYears: '2 years',
    aiScore: 68,
    integrityStatus: 'unverified',
    status: 'New',
    resumeName: 'Rohan_Mehta_Backend.pdf',
    resumeText: 'Junior Backend Developer with 2 years experience writing Express microservices and Mongo/Postgres queries.',
    appliedAt: new Date(Date.now() - 86400000 * 8).toISOString(),
    interviewResult: {
      role: 'Backend Developer',
      level: '2 years',
      date: new Date(Date.now() - 86400000 * 7).toISOString(),
      overall: 68,
      categories: [
        { label: 'Backend APIs', score: 72 },
        { label: 'Database Queries', score: 68 },
        { label: 'Frontend Fit', score: 62 },
        { label: 'Verification', score: 50 },
      ],
      strengths: ['Good REST fundamentals'],
      improvements: ['Candidate camera was off during the first 2 minutes of the session; marked as unverified.'],
      answers: [
        { question: 'What is database indexing and how does B-Tree help?', answer: 'Indexes allow rapid key lookups without full table scans, sorting data in balanced tree structures...', score: 70, wordCount: 54, keywordsHit: ['b-tree', 'lookup', 'scan'], feedback: 'Basic overview given.' },
      ],
      integrity: { faceViolations: 2, singlePersonOk: false, maxFacesSeen: 0 },
    },
  },
  {
    id: 'cand-12',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Sai Teja',
    candidateEmail: 'sai.teja.codes@gmail.com',
    candidatePhone: '+91 90000 00112',
    role: 'Backend Developer',
    experienceYears: '1 year',
    aiScore: 64,
    integrityStatus: 'pending',
    status: 'Rejected',
    resumeName: 'Sai_Teja_Resume.pdf',
    resumeText: 'Entry-level Backend Developer with 1 year experience in Python Flask, Django, and SQLite.',
    appliedAt: new Date(Date.now() - 86400000 * 9).toISOString(),
    interviewResult: {
      role: 'Backend Developer',
      level: '1 year',
      date: new Date(Date.now() - 86400000 * 8).toISOString(),
      overall: 64,
      categories: [
        { label: 'Python Fundamentals', score: 70 },
        { label: 'Web Protocols', score: 64 },
        { label: 'Experience Depth', score: 58 },
        { label: 'Frontend Alignment', score: 52 },
      ],
      strengths: ['Enthusiastic beginner'],
      improvements: ['Insufficient experience for senior frontend developer track; candidate rejected.'],
      answers: [
        { question: 'How do you structure API endpoints in Flask?', answer: 'Using blueprints to modularize routes and returning jsonify responses with appropriate status codes...', score: 66, wordCount: 50, keywordsHit: ['blueprints', 'jsonify'], feedback: 'Acceptable junior level answer.' },
      ],
      integrity: { faceViolations: 1, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-13',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Sneha Patil',
    candidateEmail: 'sneha.patil14@gmail.com',
    candidatePhone: '+91 90000 00113',
    role: 'QA Engineer',
    experienceYears: '1 year',
    aiScore: 71,
    integrityStatus: 'verified',
    status: 'New',
    resumeName: 'Sneha_Patil_QA.pdf',
    resumeText: 'Junior QA Engineer with 1 year experience writing manual test cases and automated tests in Selenium.',
    appliedAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    interviewResult: {
      role: 'QA Engineer',
      level: '1 year',
      date: new Date(Date.now() - 86400000 * 9).toISOString(),
      overall: 71,
      categories: [
        { label: 'Manual QA', score: 78 },
        { label: 'Selenium', score: 72 },
        { label: 'Test Documentation', score: 70 },
        { label: 'Senior Alignment', score: 64 },
      ],
      strengths: ['Detail-oriented test case documentation'],
      improvements: ['Needs more technical experience with JavaScript and TypeScript testing frameworks.'],
      answers: [
        { question: 'What is regression testing and when is it executed?', answer: 'Regression testing ensures that new code updates or bug fixes do not inadvertently break existing functionality...', score: 74, wordCount: 58, keywordsHit: ['regression', 'break', 'verification'], feedback: 'Good understanding.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
  {
    id: 'cand-14',
    jobId: 'job-demo-1',
    jobTitle: 'Senior Frontend Developer',
    company: 'TechCitta Solutions',
    candidateName: 'Vikram Singh',
    candidateEmail: 'vikram.singh.pm@gmail.com',
    candidatePhone: '+91 90000 00114',
    role: 'Product Manager',
    experienceYears: '9 years',
    aiScore: 89,
    integrityStatus: 'verified',
    status: 'Shortlisted',
    resumeName: 'Vikram_Singh_Product.pdf',
    resumeText: 'Principal Product Manager with 9 years scaling SaaS B2B platforms, roadmaps, sprint execution, and developer tool ecosystems.',
    appliedAt: new Date(Date.now() - 86400000 * 11).toISOString(),
    interviewResult: {
      role: 'Product Manager',
      level: '9 years',
      date: new Date(Date.now() - 86400000 * 10).toISOString(),
      overall: 89,
      categories: [
        { label: 'Product Strategy', score: 92 },
        { label: 'User Research', score: 90 },
        { label: 'Technical Empathy', score: 88 },
        { label: 'Execution', score: 86 },
      ],
      strengths: ['Outstanding leadership, roadmap prioritization, and developer empathy'],
      improvements: ['None notable'],
      answers: [
        { question: 'How do you resolve conflicting priorities between engineering debt and feature requests?', answer: 'I allocate a fixed continuous capacity (e.g. 20%) for tech debt while framing maintenance in terms of uptime, developer velocity, and churn reduction...', score: 90, wordCount: 78, keywordsHit: ['velocity', 'capacity', 'trade-offs'], feedback: 'Executive-level framing.' },
      ],
      integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
    },
  },
]

export function getEmployerJobs(email?: string): EmployerJob[] {
  try {
    const raw = localStorage.getItem(EMPLOYER_JOBS_KEY)
    if (!raw) return []
    const jobs = JSON.parse(raw) as EmployerJob[]
    if (email) return jobs.filter((j) => j.createdByEmail === email)
    return jobs
  } catch {
    return []
  }
}

export function getEmployerJobByCode(code: string): EmployerJob | null {
  const jobs = getEmployerJobs()
  return jobs.find((j) => j.shareableCode === code || j.id === code) ?? null
}

export function saveEmployerJob(
  input: Omit<EmployerJob, 'id' | 'createdAt' | 'shareableCode'>,
): EmployerJob {
  const jobs = getEmployerJobs()
  const user = getUser()
  const code = `${input.company.toLowerCase().replace(/[^a-z0-9]/g, '')}-${input.title.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Math.random().toString(36).slice(2, 6)}`
  const job: EmployerJob = {
    ...input,
    id: uid(),
    createdByEmail: input.createdByEmail || user?.email || 'employer@hireright.com',
    createdAt: new Date().toISOString(),
    shareableCode: code,
  }
  jobs.unshift(job)
  localStorage.setItem(EMPLOYER_JOBS_KEY, JSON.stringify(jobs))
  return job
}

export function deleteEmployerJob(id: string) {
  const jobs = getEmployerJobs().filter((j) => j.id !== id)
  localStorage.setItem(EMPLOYER_JOBS_KEY, JSON.stringify(jobs))
}

export function getEmployerApplicants(jobId?: string): EmployerApplicant[] {
  try {
    const raw = localStorage.getItem(EMPLOYER_APPLICANTS_KEY)
    if (!raw) return []
    const applicants = JSON.parse(raw) as EmployerApplicant[]
    if (jobId) return applicants.filter((a) => a.jobId === jobId)
    return applicants
  } catch {
    return []
  }
}

export function saveEmployerApplicant(
  input: Omit<EmployerApplicant, 'id' | 'appliedAt' | 'status'>,
): EmployerApplicant {
  const applicants = getEmployerApplicants()
  const applicant: EmployerApplicant = {
    ...input,
    id: uid(),
    appliedAt: new Date().toISOString(),
    status: 'New',
  }
  applicants.unshift(applicant)
  localStorage.setItem(EMPLOYER_APPLICANTS_KEY, JSON.stringify(applicants))
  return applicant
}

export function updateEmployerApplicantStatus(
  id: string,
  status: EmployerApplicant['status'],
) {
  const applicants = getEmployerApplicants()
  const idx = applicants.findIndex((a) => a.id === id)
  if (idx >= 0) {
    applicants[idx].status = status
    localStorage.setItem(EMPLOYER_APPLICANTS_KEY, JSON.stringify(applicants))
    addNotification(
      {
        kind: 'status',
        title: `Application ${status.toLowerCase()}`,
        body: `${applicants[idx].company} marked you as ${status} for ${applicants[idx].jobTitle}.`,
        href: '/applications',
      },
      applicants[idx].candidateEmail,
    )
  }
}

export function attachInterviewToApplicant(applicantId: string, result: InterviewResult) {
  const applicants = getEmployerApplicants()
  const idx = applicants.findIndex((a) => a.id === applicantId)
  if (idx < 0) return
  applicants[idx] = {
    ...applicants[idx],
    interviewResult: result,
    status: result.overall >= 70 ? 'Shortlisted' : 'In Review',
  }
  localStorage.setItem(EMPLOYER_APPLICANTS_KEY, JSON.stringify(applicants))
}

export type AppNotification = {
  id: string
  title: string
  body: string
  href?: string
  read: boolean
  createdAt: string
  kind?: 'job_match' | 'application' | 'status' | 'general'
  jobId?: string
  /** Employer application alert id (dedupe bell entries). */
  alertId?: string
}

const NOTIF_KEY = 'hireright.notifications'

function notifKey(email?: string) {
  const userEmail = email ?? getUser()?.email
  return userEmail ? `${NOTIF_KEY}.${userEmail}` : NOTIF_KEY
}

export function getNotifications(email?: string): AppNotification[] {
  try {
    const raw = localStorage.getItem(notifKey(email))
    return raw ? (JSON.parse(raw) as AppNotification[]) : []
  } catch {
    return []
  }
}

export function addNotification(
  input: Pick<AppNotification, 'title' | 'body' | 'href' | 'kind' | 'jobId' | 'alertId'>,
  email?: string,
) {
  const list = getNotifications(email)
  if (input.jobId && list.some((n) => n.jobId === input.jobId && n.kind === 'job_match')) {
    return
  }
  if (input.alertId && list.some((n) => n.alertId === input.alertId)) {
    return
  }
  list.unshift({
    ...input,
    id: uid(),
    kind: input.kind ?? 'general',
    read: false,
    createdAt: new Date().toISOString(),
  })
  localStorage.setItem(notifKey(email), JSON.stringify(list.slice(0, 40)))
  window.dispatchEvent(new Event('hireright-auth'))
}

/** Remove all notifications from the inbox (treated as read/dismissed). */
export function markNotificationsRead() {
  localStorage.setItem(notifKey(), JSON.stringify([]))
  window.dispatchEvent(new Event('hireright-auth'))
}

/** Remove notifications matching predicate from the inbox (treated as read/dismissed). */
export function markNotificationsReadWhere(predicate: (n: AppNotification) => boolean) {
  const list = getNotifications().filter((n) => !predicate(n))
  localStorage.setItem(notifKey(), JSON.stringify(list))
  window.dispatchEvent(new Event('hireright-auth'))
}

/** Dismiss a single notification so it no longer appears in the bell. */
export function markNotificationRead(id: string) {
  const list = getNotifications().filter((n) => n.id !== id)
  localStorage.setItem(notifKey(), JSON.stringify(list))
  window.dispatchEvent(new Event('hireright-auth'))
}

export function unreadNotificationCount() {
  return getNotifications().filter((n) => !n.read).length
}
