import type { ProfileFormData } from '../data/wizard'
import { extractNameFromText } from './resumeParser'
import { findUserByPhone } from './phone'

export type UserRole = 'jobseeker' | 'employer'

export type User = {
  id: string
  name: string
  email: string
  password: string
  role?: UserRole
  companyName?: string
  phone?: string
  createdAt: string
}


/** Profile without File objects — safe for localStorage. */
export type SavedProfile = Omit<ProfileFormData, 'resumeFile'> & {
  fullName?: string
  name?: string
  resumeName: string | null
  /** Raw extracted resume text for Ava's resume-accurate questions. */
  resumeText?: string
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
}

export type IntegrityLogEvent = {
  id: string
  timestamp: string
  formattedTime: string
  eventType:
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
    total40: number
    stars: string
    feedback: string
  }[]
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
}

export type EmployerJob = {
  id: string
  title: string
  company: string
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
  experienceYears: string
  resumeName: string | null
  resumeText?: string
  interviewResult?: InterviewResult
  atsScore?: number
  jdMatchScore?: number
  primarySkills?: string[]
  appliedAt: string
  status: 'New' | 'Shortlisted' | 'In Review' | 'Rejected'
}

const USERS_KEY = 'hireright.users'
const SESSION_KEY = 'hireright.session'
const PROFILE_KEY = 'hireright.profile'
const RESULT_KEY = 'hireright.interviewResult'
const APPS_KEY = 'hireright.applications'
const EMPLOYER_JOBS_KEY = 'hireright.employerJobs'
const EMPLOYER_APPLICANTS_KEY = 'hireright.employerApplicants'

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const DEFAULT_DEMO_USER: User = {
  id: 'demo-user-1',
  name: 'Arjun Sharma',
  email: 'demo@hireright.com',
  password: 'password123',
  role: 'jobseeker',
  createdAt: new Date().toISOString(),
}

const DEFAULT_EMPLOYER_USER: User = {
  id: 'demo-employer-1',
  name: 'Sarah Jenkins (Recruiter)',
  email: 'employer@hireright.com',
  password: 'password123',
  role: 'employer',
  companyName: 'TechCitta Solutions',
  createdAt: new Date().toISOString(),
}

function readUsers(): User[] {
  try {
    const raw = localStorage.getItem(USERS_KEY)
    if (!raw) {
      // Migrate legacy single-user key if present.
      const legacy = localStorage.getItem('hireright.user')
      if (legacy) {
        const user = JSON.parse(legacy) as User
        if (!user.id) user.id = uid()
        writeUsers([user])
        localStorage.removeItem('hireright.user')
        return [user]
      }
      writeUsers([DEFAULT_DEMO_USER, DEFAULT_EMPLOYER_USER])
      return [DEFAULT_DEMO_USER, DEFAULT_EMPLOYER_USER]
    }
    const users = JSON.parse(raw) as User[]
    if (users.length === 0) {
      writeUsers([DEFAULT_DEMO_USER, DEFAULT_EMPLOYER_USER])
      return [DEFAULT_DEMO_USER, DEFAULT_EMPLOYER_USER]
    }
    let next: User[] = users.map((u) => ({
      ...u,
      role:
        u.role ??
        (u.email.includes('employer') ? ('employer' as const) : ('jobseeker' as const)),
      companyName:
        u.companyName ??
        (u.email === DEFAULT_EMPLOYER_USER.email ? DEFAULT_EMPLOYER_USER.companyName : undefined),
    }))
    const missingDemo = !next.some((u) => u.email === DEFAULT_DEMO_USER.email)
    const missingEmployer = !next.some((u) => u.email === DEFAULT_EMPLOYER_USER.email)
    if (missingDemo) next.push(DEFAULT_DEMO_USER)
    if (missingEmployer) next.push(DEFAULT_EMPLOYER_USER)
    const changed =
      missingDemo ||
      missingEmployer ||
      next.some((u, i) => u.role !== users[i]?.role || u.companyName !== users[i]?.companyName)
    if (changed) writeUsers(next)
    return next
  } catch {
    return [DEFAULT_DEMO_USER, DEFAULT_EMPLOYER_USER]
  }
}

function writeUsers(users: User[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

export function saveUser(
  input: Omit<User, 'id' | 'createdAt'> & { createdAt?: string },
  allowOverwrite = false,
): User {
  const users = readUsers()
  const email = input.email.trim().toLowerCase()
  const existingIdx = users.findIndex((u) => u.email === email)

  if (input.phone?.trim()) {
    const phoneOwner = findUserByPhone(users, input.phone)
    if (phoneOwner && phoneOwner.email !== email) {
      throw new Error('An account with this mobile number already exists.')
    }
  }

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
    localStorage.setItem(SESSION_KEY, email)
    window.dispatchEvent(new Event('hireright-auth'))
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
  localStorage.setItem(SESSION_KEY, user.email)
  window.dispatchEvent(new Event('hireright-auth'))
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
  window.dispatchEvent(new Event('hireright-auth'))
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
    resumeName: data.resumeFile?.name ?? getProfile()?.resumeName ?? null,
    resumeText: data.resumeText || getProfile()?.resumeText || '',
    updatedAt: new Date().toISOString(),
    completedSteps: Math.max(completedSteps, getProfile()?.completedSteps ?? 0),
  }
  localStorage.setItem(profileKey(user?.email), JSON.stringify(saved))
  void import('./apiSession').then((m) => m.syncProfileToApi(saved))
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
      return Boolean(w.jobTitle?.trim() || w.company?.trim())
    }),
    metrics: Array.isArray(p.metrics) ? p.metrics : [],
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
    localStorage.getItem(profileKey(user?.email)) ??
    localStorage.getItem(PROFILE_KEY)
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

/** Minimum AI interview score required to apply to jobs. */
export const MIN_APPLY_SCORE = 40

export function hasInterviewScore(): boolean {
  return Boolean(getInterviewResult())
}

export function canApplyToJobs(): boolean {
  const interview = getInterviewResult()
  return Boolean(interview && interview.overall >= MIN_APPLY_SCORE)
}

export type RankedJob = {
  title: string
  company: string
  location: string
  match: number
  locked: boolean
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

export function getRankedJobs(): RankedJob[] {
  const interview = getInterviewResult()
  const profile = getProfile()
  const unlocked = Boolean(interview)
  const roleHint =
    interview?.role ||
    profile?.currentRole ||
    profile?.preferredRoles?.[0] ||
    ''

  const employerPosted = getEmployerJobs().map((job) => ({
    title: job.title,
    company: job.company,
    location: job.location,
    match: 0,
  }))

  const catalog = [...employerPosted, ...JOB_MATCHES.map((j) => ({ ...j, match: 0 }))].filter(
    (job, index, list) =>
      list.findIndex((j) => j.title === job.title && j.company === job.company) === index,
  )

  return catalog
    .map((job) => {
      let match = 0
      if (unlocked && interview) {
        match = jobMatchFromInterview(
          interview.overall,
          job.title,
          roleHint,
          profile?.skills ?? [],
        )
      } else {
        match = Math.max(1, Math.min(35, 12))
      }
      return {
        ...job,
        match,
        locked: !unlocked,
      }
    })
    .sort((a, b) => b.match - a.match)
}

export function saveInterviewResult(result: InterviewResult) {
  const user = getUser()
  const key = user ? `${RESULT_KEY}.${user.email}` : RESULT_KEY
  localStorage.setItem(key, JSON.stringify(result))
  void import('./apiSync').then((m) => m.syncInterviewResultToApi(result))
}

export function getInterviewResult(): InterviewResult | null {
  const user = getUser()
  const raw =
    (user && localStorage.getItem(`${RESULT_KEY}.${user.email}`)) ||
    localStorage.getItem(RESULT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as InterviewResult
  } catch {
    return null
  }
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

export function applyToJob(job: {
  title: string
  company: string
  location: string
  match: number
}): Application {
  if (!canApplyToJobs()) {
    throw new Error(
      `Complete an AI interview scoring at least ${MIN_APPLY_SCORE} to apply.`,
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

const DEFAULT_DEMO_JOB: EmployerJob = {
  id: 'job-demo-1',
  title: 'Senior Frontend Developer',
  company: 'TechCitta Solutions',
  roleTrack: 'Frontend Developer',
  experienceLevel: '6+ years',
  location: 'Hyderabad / Remote',
  jobDescription:
    'Looking for a Senior Frontend Developer with 5+ years experience building modern web applications with React, TypeScript, state management, and performance optimization.',
  requiredSkills: ['React', 'TypeScript', 'Redux', 'CSS Modules', 'GraphQL'],
  createdByEmail: 'employer@hireright.com',
  createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  shareableCode: 'techcitta-sr-frontend',
}

const DEFAULT_DEMO_APPLICANT: EmployerApplicant = {
  id: 'app-demo-1',
  jobId: 'job-demo-1',
  jobTitle: 'Senior Frontend Developer',
  company: 'TechCitta Solutions',
  candidateName: 'Vikram Mehta',
  candidateEmail: 'vikram.m@example.com',
  candidatePhone: '+91 98765 43210',
  experienceYears: '6 years',
  resumeName: 'Vikram_Mehta_Resume.pdf',
  resumeText:
    'Senior Frontend Developer with 6 years experience specializing in React, TypeScript, Redux, Performance, and Micro-frontends.',
  interviewResult: {
    role: 'Frontend Developer',
    level: '6+ years',
    date: new Date(Date.now() - 86400000 * 1).toISOString(),
    overall: 92,
    categories: [
      { label: 'Communication', score: 94 },
      { label: 'Technical', score: 92 },
      { label: 'Problem Solving', score: 90 },
      { label: 'Experience', score: 92 },
    ],
    strengths: [
      'Exceptional React architecture knowledge',
      'Clear, concise STAR method explanations',
    ],
    improvements: ['Could elaborate more on automated E2E testing'],
    answers: [
      {
        question: 'Tell me about yourself',
        answer: 'I have 6 years building high scale React apps...',
        score: 95,
        wordCount: 85,
        keywordsHit: ['react', 'typescript'],
        feedback: 'Strong intro.',
      },
    ],
    resumeFitScore: 94,
    agent: 'openrouter+hireright-agent',
    integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
  },
  appliedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
  status: 'Shortlisted',
}

export function getEmployerJobs(email?: string): EmployerJob[] {
  try {
    const raw = localStorage.getItem(EMPLOYER_JOBS_KEY)
    if (!raw) {
      localStorage.setItem(EMPLOYER_JOBS_KEY, JSON.stringify([DEFAULT_DEMO_JOB]))
      return [DEFAULT_DEMO_JOB]
    }
    const jobs = JSON.parse(raw) as EmployerJob[]
    if (email) return jobs.filter((j) => j.createdByEmail === email)
    return jobs
  } catch {
    return [DEFAULT_DEMO_JOB]
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
    if (!raw) {
      localStorage.setItem(
        EMPLOYER_APPLICANTS_KEY,
        JSON.stringify([DEFAULT_DEMO_APPLICANT]),
      )
      return [DEFAULT_DEMO_APPLICANT]
    }
    const applicants = JSON.parse(raw) as EmployerApplicant[]
    if (jobId) return applicants.filter((a) => a.jobId === jobId)
    return applicants
  } catch {
    return [DEFAULT_DEMO_APPLICANT]
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
  input: Pick<AppNotification, 'title' | 'body' | 'href'>,
  email?: string,
) {
  const list = getNotifications(email)
  list.unshift({
    id: uid(),
    ...input,
    read: false,
    createdAt: new Date().toISOString(),
  })
  localStorage.setItem(notifKey(email), JSON.stringify(list.slice(0, 40)))
  window.dispatchEvent(new Event('hireright-auth'))
}

export function markNotificationsRead() {
  const list = getNotifications().map((n) => ({ ...n, read: true }))
  localStorage.setItem(notifKey(), JSON.stringify(list))
  window.dispatchEvent(new Event('hireright-auth'))
}

export function unreadNotificationCount() {
  return getNotifications().filter((n) => !n.read).length
}
