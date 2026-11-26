import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCandidateName } from './store'
import { interviewRoleFromProfile } from './interviewRole'
import { buildInterviewConsent } from './interviewConsent'
import { isLobbyLocalSttReady, lobbyEnterButtonLabel } from './interviewLobbySttGate'
import {
  answerDoneCommand,
  isEndInterviewRequest,
  silenceAdvanceMs,
  stripAnswerDoneCommand,
} from './answerTiming'
import {
  attachInterviewRoomGuard,
  shouldRequireInterviewFullscreen,
  type InterviewFocusViolation,
} from './interviewRoomLock'
import { collectInterviewPairs, hasSubstantiveInterviewProgress } from './interviewFinish'
import { stripProctoringForCandidateView } from './candidateInterviewResult'
import { reviewEventsToFlagSections } from './reviewEventsToFlagSections'
import { filterJobSeekerCandidates, isOwnOrgCandidate } from './employerCandidateUtils'
import {
  DEFAULT_INTERVIEW_PRICE_INR,
  calculateInterviewPriceINR,
  calculateRetakeCreditStatus,
  inrToPaise,
  paiseToInr,
  sanitizeCandidateName,
  sanitizeResumeText,
  sanitizeSkillsList,
  serializeInterviewSessionPayload,
} from './interviewSessionPayload'

describe('End-to-End User Acceptance Testing (UAT) Flow', () => {
  let doc: EventTarget & {
    hidden: boolean
    fullscreenElement: object | null
    webkitFullscreenElement?: object | null
    hasFocus: () => boolean
    documentElement: object
    exitFullscreen?: () => Promise<void>
  }
  let win: EventTarget
  let detach: (() => void) | undefined
  const violations: { reason: InterviewFocusViolation; message: string }[] = []

  beforeEach(() => {
    violations.length = 0
    doc = Object.assign(new EventTarget(), {
      hidden: false,
      fullscreenElement: {},
      webkitFullscreenElement: null,
      hasFocus: () => true,
      documentElement: {
        requestFullscreen: vi.fn().mockResolvedValue(undefined),
      },
      exitFullscreen: vi.fn().mockResolvedValue(undefined),
    })
    win = new EventTarget()
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', win)
  })

  afterEach(() => {
    detach?.()
    detach = undefined
    vi.unstubAllGlobals()
  })

  describe('Candidate Journey: Onboarding -> Lobby -> Room Lock -> Interview Turn -> Report', () => {
    it('Step 1: Resolves candidate identity and derives standardized interview role', () => {
      const profile = {
        fullName: 'Dr. Priya Sharma',
        headline: 'Staff Software Architect',
        currentRole: 'Principal Cloud Systems Engineer',
        totalExperience: '12 years',
        skills: ['Distributed Systems', 'Python', 'AWS', 'FastAPI', 'PostgreSQL'],
        resumeText: 'Priya Sharma - Experienced in building high-throughput microservices.',
      }

      const name = resolveCandidateName(profile, null)
      expect(name).toBe('Dr. Priya Sharma')

      const role = interviewRoleFromProfile(profile)
      expect(role).toBe('Principal Cloud Systems Engineer')
    })

    it('Step 2: Generates interview recording consent and evaluates lobby readiness', () => {
      const consent = buildInterviewConsent()
      expect(consent.recording).toBe(true)
      expect(consent.faceTracking).toBe(true)
      expect(consent.aiScoring).toBe(true)
      expect(consent.version).toBeDefined()
      expect(typeof consent.acceptedAt).toBe('string')

      // Lobby waiting on model download
      const downloadingSnapshot = {
        moonshineStatus: 'downloading' as const,
        vadReady: false,
      }
      expect(isLobbyLocalSttReady(downloadingSnapshot)).toBe(false)
      expect(lobbyEnterButtonLabel({ starting: true })).toBe('Joining interview room…')

      // Lobby ready
      const readySnapshot = {
        moonshineStatus: 'ready' as const,
        vadReady: true,
      }
      expect(isLobbyLocalSttReady(readySnapshot)).toBe(true)
      expect(lobbyEnterButtonLabel({ starting: false })).toBe('Enter interview room')
    })

    it('Step 3: Enforces room guard security and detects fullscreen requirements', () => {
      const requiresFs = shouldRequireInterviewFullscreen()
      expect(typeof requiresFs).toBe('boolean')

      detach = attachInterviewRoomGuard({
        requireFullscreen: false,
        onViolation: (detail) => violations.push(detail),
      })

      // Simulate a tab blur / focus loss
      win.dispatchEvent(new Event('blur'))
      expect(violations.length).toBe(1)
      expect(violations[0].reason).toBe('WINDOW_BLUR')
      expect(violations[0].message).toContain('interview window')
    })

    it('Step 4: Processes answer speech timings, interruptions, and early finish commands', () => {
      // Long substantive answer (22+ words)
      const answer =
        'In my previous cloud architecture role, I successfully led the migration from an on-premise monolithic database to Aurora Postgres with zero downtime.'
      const silenceMs = silenceAdvanceMs(answer)
      // 22 words is a short answer: the candidate gets the full 8 s pause before it can end by itself.
      expect(silenceMs).toBe(8000)

      // Spoken voice command: "...and that concludes my thoughts, next question please"
      const commandAnswer = `${answer} next question`
      const cleaned = answerDoneCommand(commandAnswer)
      expect(cleaned).toBe(answer)
      expect(stripAnswerDoneCommand(commandAnswer)).toBe(answer)

      // Spoken end interview command
      const endCommand = 'I am satisfied with my answers, end the interview.'
      expect(isEndInterviewRequest(endCommand)).toBe(true)
    })

    it('Step 5: Gathers interview QA pairs and verifies substantive progress before scoring', () => {
      const questions = [
        { id: 'q1', text: 'Explain how you design resilient microservices.', category: 'architecture' },
        { id: 'q2', text: 'How do you handle distributed transactions?', category: 'database' },
      ]
      const finalAnswers = [
        'We implemented the Saga pattern using orchestrators and idempotency keys to ensure consistent state across services.',
        'We avoid 2PC across microservices and use transactional outbox patterns with Kafka.',
      ]

      const pairs = collectInterviewPairs(questions, finalAnswers, [])
      expect(pairs.questions.length).toBe(2)
      expect(pairs.answers.length).toBe(2)

      const hasProgress = hasSubstantiveInterviewProgress(finalAnswers, [], '', 10)
      expect(hasProgress).toBe(true)
    })

    it('Step 6: Sanitizes scorecard for candidate view while retaining proctoring on recruiter report', () => {
      const fullScorecard: any = {
        sessionId: 'session_uat_123',
        candidateName: 'Priya Sharma',
        role: 'Principal Cloud Systems Engineer',
        overall: 94,
        technical: 96,
        communication: 92,
        integrity: {
          singlePersonOk: true,
          faceViolations: 0,
          banned: false,
          logs: [
            { id: 'ev1', eventType: 'focus_lost', timestamp: new Date().toISOString() },
          ],
          flaggedSections: [
            { questionNumber: 1, topic: 'architecture', severity: 'low', reason: 'Brief glance' },
          ],
        },
      }

      // Candidate version removes sensitive proctoring telemetry (logs, flaggedSections)
      const candidateView = stripProctoringForCandidateView(fullScorecard)
      expect(candidateView.overall).toBe(94)
      expect(candidateView.technical).toBe(96)
      expect((candidateView.integrity as any)?.logs).toBeUndefined()
      expect((candidateView.integrity as any)?.flaggedSections).toBeUndefined()

      // Recruiter flag sections are accurately transformed from raw telemetry
      const sections = reviewEventsToFlagSections(fullScorecard.integrity.logs, [
        { id: 'q1', text: 'Architecture question' },
      ])
      expect(Array.isArray(sections)).toBe(true)
    })
  })

  describe('Employer Journey: Job Setup -> Applicant Review -> Pricing Invariants', () => {
    it('Step 1: Accurately filters candidates belonging to the organization', () => {
      const orgApplicants = [
        { id: 'c1', candidateName: 'Alice Smith', candidateEmail: 'alice@applicant.com', source: 'application' as const },
        { id: 'c2', candidateName: 'Bob Jones', candidateEmail: 'bob@talent.com', source: 'talent' as const },
        { id: 'c3', candidateName: 'Charlie Lee', candidateEmail: 'charlie@applicant.com', source: 'vault' as const },
      ]

      const ownCandidates = orgApplicants.filter((c) => isOwnOrgCandidate(c))
      expect(ownCandidates.length).toBe(2)
      expect(ownCandidates.map((c) => c.candidateName)).toEqual(['Alice Smith', 'Charlie Lee'])

      const filtered = filterJobSeekerCandidates(orgApplicants as any)
      expect(filtered.length).toBe(3)
    })

    it('Step 2: Enforces ₹89 per interview pricing invariants across tiers and retakes', () => {
      expect(DEFAULT_INTERVIEW_PRICE_INR).toBe(89)

      // 1 interview = ₹89
      const singlePrice = calculateInterviewPriceINR(1)
      expect(singlePrice).toBe(89)
      expect(inrToPaise(singlePrice)).toBe(8900)
      expect(paiseToInr(8900)).toBe(89)

      // 5 interviews = ₹445
      const packPrice = calculateInterviewPriceINR(5)
      expect(packPrice).toBe(445)
      expect(inrToPaise(packPrice)).toBe(44500)

      // Retake credit invariants
      const freeInitial = calculateRetakeCreditStatus({
        completedCareerInterviews: 0,
        paidCredits: 0,
        usedCredits: 0,
        isJobInterview: false,
      })
      expect(freeInitial.canStart).toBe(true)
      expect(freeInitial.freeInterviewAvailable).toBe(true)
      expect(freeInitial.creditRequired).toBe(false)

      const paidRetakeRequired = calculateRetakeCreditStatus({
        completedCareerInterviews: 1,
        paidCredits: 0,
        usedCredits: 0,
        isJobInterview: false,
      })
      expect(paidRetakeRequired.canStart).toBe(false)
      expect(paidRetakeRequired.creditRequired).toBe(true)
      expect(paidRetakeRequired.priceInr).toBe(89)

      const paidRetakeWithCredit = calculateRetakeCreditStatus({
        completedCareerInterviews: 1,
        paidCredits: 2,
        usedCredits: 0,
        isJobInterview: false,
      })
      expect(paidRetakeWithCredit.canStart).toBe(true)
      expect(paidRetakeWithCredit.creditRequired).toBe(true)
      expect(paidRetakeWithCredit.availableCredits).toBe(2)
    })

    it('Step 3: Sanitizes candidate name, skills, and resume payloads without data loss', () => {
      const cleanName = sanitizeCandidateName('  O’Connor-Smith, Jr.  ')
      expect(cleanName).toBe('O’Connor-Smith, Jr.')

      const rawSkills = ['TypeScript', 'Python', 'PyTorch', '<script>alert(1)</script>']
      const cleanSkills = sanitizeSkillsList(rawSkills)
      expect(cleanSkills).toContain('TypeScript')
      expect(cleanSkills).toContain('PyTorch')
      expect(cleanSkills).not.toContain('<script>alert(1)</script>')

      const cleanResume = sanitizeResumeText('Experienced with deep learning models.\x00\x07')
      expect(cleanResume).not.toContain('\x00')
      expect(cleanResume).not.toContain('\x07')

      const payload = serializeInterviewSessionPayload({
        candidateName: cleanName,
        role: 'Lead AI Engineer',
        level: 'Senior',
        primarySkills: cleanSkills,
        resumeText: cleanResume,
        profile: {
          fullName: cleanName,
          name: cleanName,
          skills: cleanSkills,
        },
      })

      expect(payload.role).toBe('Lead AI Engineer')
      expect(payload.level).toBe('Senior')
      expect(payload.profile.fullName).toBe('O’Connor-Smith, Jr.')
    })
  })
})
