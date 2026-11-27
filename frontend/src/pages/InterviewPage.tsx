import { attachInterviewContentGuard, looksLikeVirtualCamera, type ContentGuardEvent } from '../lib/interviewContentGuard'
import { ReviewEventTracker, saveReviewEvents } from '../lib/interviewReview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  mapExperienceToLevel,
  type Question,
} from '../lib/interviewEngine'
import { interviewRoleFromProfile } from '../lib/interviewRole'
import {
  cancelSpeech,
  configureInterviewRecognition,
  getSpeechRecognition,
  interviewAudioConstraints,
  classifySpokenSegment,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speakText,
} from '../lib/speech'
import {
  FACE_SAMPLE_INTERVAL_MS,
  FaceTracker,
  faceStatusKey,
  preloadFaceTracker,
  type FaceTrackStatus,
} from '../lib/faceTracker'
import { InterviewProctorEngine } from '../lib/interviewProctorEngine'
import { stripProctoringForCandidateView } from '../lib/candidateInterviewResult'
import { reviewEventsToFlagSections } from '../lib/reviewEventsToFlagSections'
import {
  isServerInterviewSession,
  scoreInterviewRemote,
  type IntegritySnapshot,
  RETAKE_PAYMENT_REQUIRED_ERROR,
  INTERVIEW_BOOKED_ERROR,
  InterviewBookedError,
  fetchInterviewBooking,
  recordInterviewAnswer,
} from '../lib/interviewAgentClient'
import { buildInterviewConsent, type InterviewConsent } from '../lib/interviewConsent'
import { InterviewRecorder } from '../lib/interviewRecorder'
import {
  formatSlotCountdown,
  inviteAccessFromStored,
  isImmediateInterviewAllowed,
  msUntilSlotOpens,
  readStoredInterviewInvite,
  storeBookingLock,
} from '../lib/interviewInviteGate'
import {
  applyToJob,
  attachInterviewToApplicant,
  candidateFullName,
  getInterviewResult,
  getProfile,
  saveInterviewResult,
  type InterviewResult,
} from '../lib/store'
import {
  MAX_ADAPTIVE_QUESTIONS,
  fetchNextAdaptiveQuestion,
  isDeferredAdaptiveQuestion,
  isPreloadedInterviewQuestion,
  isEndInterviewCommand,
} from '../lib/adaptiveInterview'
import {
  collectInterviewPairs,
  hasSubstantiveInterviewProgress,
} from '../lib/interviewFinish'
import { ensureApiSession } from '../lib/apiSession'
import {
  goToCandidateDashboardAfterInterview,
  goToInterviewReportAfterCompletion,
  leaveInterviewRoom,
  markCandidateOnboardingCompleteAfterInterview,
  PENDING_REPORT_UPLOAD_KEY,
} from '../lib/completeOnboardingAfterInterview'
import type { MoonshineVadSttController } from '../lib/moonshineVadStt'
import { shouldStickToWebSpeechFallback } from '../lib/interviewSttFallback'
import { moonshineStt, type MoonshineStatus } from '../lib/moonshineStt'
import {
  isLobbyLocalSttReady,
  LOBBY_STT_WAIT_CAP_MS,
  lobbyEnterButtonLabel,
  waitForLobbyLocalStt,
  type LobbySttSnapshot,
} from '../lib/interviewLobbySttGate'
import {
  beginLobbySessionPrep,
  enterPreparedSession,
  invalidateLobbySessionPrep,
  lobbySessionPrepKey,
  resumePointFromStart,
  runLobbySessionPrep,
} from '../lib/interviewLobbySessionPrep'
import { displayNameFromSessionProfile } from '../lib/interviewStartContext'
import {
  attachInterviewRoomGuard,
  exitInterviewFullscreen,
  fullscreenDeniedUserMessage,
  integrityEventTypeForViolation,
  requestInterviewFullscreen,
  shouldRequireInterviewFullscreen,
  type InterviewFocusViolation,
} from '../lib/interviewRoomLock'
import { CareerIntelligenceDashboard } from '../components/CareerIntelligenceDashboard'
import { startInterviewFinishJob } from '../lib/interviewFinishJob'
import { clearPendingJob, resolveInterviewJobContext } from '../lib/pendingJobApply'
import { interviewDurationMinutes, isInterviewOverBudget } from '../lib/interviewDuration'
import { HrIcon } from '../components/HrIcon'
import {
  ANSWER_SAVED_MESSAGE,
  OFFLINE_ANSWER_MESSAGE,
  PREPARING_AFTER_MS,
  PREPARING_QUESTIONS_MESSAGE,
  candidateStartErrorMessage,
  candidateSyncErrorMessage,
  sendWithReconnect,
} from '../lib/candidateMessages'
import { BrandLogo } from '../components/BrandLogo'
import { easeOut } from '../motion/variants'
import styles from './InterviewPage.module.css'
import {
  MIN_ANSWER_CHARS,
  ENDING_COUNTDOWN_LABEL,
  SILENCE_NUDGE_PROMPT,
  SILENCE_NUDGE_SPOKEN,
  TIME_LEFT_NUDGE_PROMPT,
  saveAnswerBeforeAdvance,
  type AdvanceReason,
  CAPTURE_STUCK_MS,
  answerClockRunning,
  decideAnswerTick,
  isClosingQuestionAt,
  isClosingStatement,
  stripAnswerDoneCommand,
  stripEchoOfQuestion,
  timeUpCanAdvance,
  TRANSCRIPT_JOIN_MS,
} from '../lib/answerTiming'

/** Silero VAD + onnxruntime-web JS (~300 KB) load only once the mic stream is ready, not with the page. */
const createMoonshineVadSttController: typeof import('../lib/moonshineVadStt').createMoonshineVadSttController = async (
  handlers,
) => {
  try {
    const mod = await import('../lib/moonshineVadStt')
    return await mod.createMoonshineVadSttController(handlers)
  } catch (err) {
    // Same contract as the module itself: report, resolve null, and the page falls back to Web Speech / typing.
    handlers.onError?.(err instanceof Error ? err.message : 'Voice detection failed to load.')
    return null
  }
}

type Stage = 'setup' | 'interview' | 'analyzing' | 'results'

const QUESTION_SECONDS = 180
/** Silence before an answer counts as finished: answerTiming.silenceAdvanceMs (4.5 s under 25 words, 3 s through 60, 2 s over 60; at least 6 words). */
/** Silence never moves on (owner rule): answerTiming.SILENCE_NUDGE_MS, then Ava nudges once and keeps listening. */

const LOBBY_TIPS = [
  'Only you on camera, facing the screen. Brief glances away are fine.',
  'Stay in fullscreen. Leaving it or switching tabs ends the interview.',
  'Answer out loud and pause when you’re done. Say “end the interview” to finish early.',
]

const INITIAL_FACE_STATUS: FaceTrackStatus = {
  faceCount: 0,
  ok: false,
  label: 'Waiting for your camera…',
  severity: 'warn',
  issue: 'no_face',
  faceAreaRatio: 0,
  yaw: 0,
  lookingForward: false,
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className={`${styles.wave} ${active ? styles.waveOn : ''}`} aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <span key={i} style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
    </div>
  )
}

/**
 * Experience chip on the waiting-room job card: the job's own experience only.
 * Hidden when the job has none, and never the candidate's profile total.
 */
export function waitingRoomJobExperience(
  jobLevel: string | null | undefined,
  profileExperience: string | null | undefined,
): string {
  const job = String(jobLevel || '').trim()
  if (!job) return ''
  const profileExp = String(profileExperience || '').trim()
  if (profileExp && job.toLowerCase() === profileExp.toLowerCase()) return ''
  return job
}

export function InterviewPage() {
  const navigate = useNavigate()
  const profile = useMemo(() => getProfile(), [])
  const profileSkills = profile?.skills ?? []

  // The job this interview is for: the apply page / invite, or a job link carried through sign-up or log-in
  // (pendingJobApply) so its JD is preloaded instead of a generic resume interview.
  const targetJobRaw = useMemo(() => resolveInterviewJobContext(), [])
  /** The job as linked when the interview started (after a job-link application was saved: has applicationId). */
  const activeJobRef = useRef(targetJobRaw)
  /** Whole-interview time budget in minutes (20 for a job-link interview); 0 = no budget. */
  const budgetMinutesRef = useRef(0)

  const [stage, setStage] = useState<Stage>('setup')
  const [role] = useState<string>(() => {
    if (targetJobRaw?.role) return targetJobRaw.role
    // The most recent job title exactly as on the resume (never squeezed into a fixed list of roles).
    return interviewRoleFromProfile(profile)
  })
  const [level] = useState<string>(() => {
    if (targetJobRaw?.level) return targetJobRaw.level
    return mapExperienceToLevel(profile?.totalExperience ?? '')
  })
  const [questions, setQuestions] = useState<Question[]>([])
  const [current, setCurrent] = useState(0)
  const [draft, setDraft] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(QUESTION_SECONDS)
  const [result, setResult] = useState<InterviewResult | null>(null)
  const [listening, setListening] = useState(false)
  const [aiSpeaking, setAiSpeaking] = useState(false)
  /** Shown (and spoken) when the candidate is quiet: SILENCE_NUDGE_PROMPT / TIME_LEFT_NUDGE_PROMPT. */
  const [noAnswerNotice, setNoAnswerNotice] = useState('')
  const [advancing, setAdvancing] = useState(false)
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [streamReady, setStreamReady] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [retakePaymentRequired, setRetakePaymentRequired] = useState(false)
  const [skipCamera, setSkipCamera] = useState(false)
  const [showTypeFallback, setShowTypeFallback] = useState(false)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [checklist, setChecklist] = useState([false])
  const interviewLockRequireFullscreenRef = useRef(false)
  const roomGuardDetachRef = useRef<(() => void) | null>(null)
  const [starting, setStarting] = useState(false)
  /** Starting has taken more than PREPARING_AFTER_MS: show "Preparing your questions…". */
  const [startingSlow, setStartingSlow] = useState(false)
  /** The last start failed in a way a retry can fix: show a Retry button next to the message. */
  const [startRetryable, setStartRetryable] = useState(false)
  /** Offline / reconnected notice inside the interview room. */
  const [connectionNotice, setConnectionNotice] = useState('')
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false)
  const lobbyVoicePrepRef = useRef(false)
  const [sttPhase, setSttPhase] = useState<'idle' | 'capturing' | 'transcribing'>('idle')
  const sttPhaseRef = useRef(sttPhase)
  const sttPhaseSinceRef = useRef(0)
  const [scheduleClock, setScheduleClock] = useState(() => Date.now())

  useEffect(() => {
    if (sttPhaseRef.current !== sttPhase) sttPhaseSinceRef.current = Date.now()
    sttPhaseRef.current = sttPhase
  }, [sttPhase])

  const handleInterviewRoomViolation = useCallback(
    (detail: { reason: InterviewFocusViolation; message: string }) => {
      if (finishingRef.current || stageRef.current !== 'interview') return
      finishingRef.current = true
      stopAllSpeech()
      roomGuardDetachRef.current?.()
      roomGuardDetachRef.current = null
      exitInterviewFullscreen()

      const elapsedSec = Math.max(0, (Date.now() - interviewStartedAtRef.current) / 1000)
      const eventType = integrityEventTypeForViolation(detail.reason)
      reviewRef.current.events.push({
        id: crypto.randomUUID(),
        eventType,
        severity: 'block',
        message: detail.message,
        timestamp: new Date().toISOString(),
        formattedTime: `${Math.floor(elapsedSec / 60)}:${String(Math.floor(elapsedSec % 60)).padStart(2, '0')}`,
        startOffsetSec: elapsedSec,
        durationSec: 0,
        reviewOnly: false,
      })

      setInterviewBanned(true)
      setBanMessage(detail.message)
      setDeviceError(detail.message)
      integrityRef.current.banned = true
      integrityRef.current.banReason = detail.message
      integrityRef.current.singlePersonOk = false

      const next = [...answersRef.current]
      next[currentRef.current] = draftRef.current.trim()
      answersRef.current = next
      finish(next, true, detail.message)
    },
    // finish/stopAllSpeech are stable enough for interview lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    if (stage !== 'interview') {
      roomGuardDetachRef.current?.()
      roomGuardDetachRef.current = null
      document.body.style.overflow = ''
      return
    }
    document.body.style.overflow = 'hidden'
    roomGuardDetachRef.current?.()
    roomGuardDetachRef.current = attachInterviewRoomGuard({
      requireFullscreen: interviewLockRequireFullscreenRef.current,
      onViolation: handleInterviewRoomViolation,
    })
    // Copy / paste / developer-tool protection. Attempts are blocked and recorded for recruiter review.
    const detachContentGuard = attachInterviewContentGuard({
      clearClipboard: () => void navigator.clipboard?.writeText(''),
      onEvent: (event: ContentGuardEvent) => {
        const elapsedSec = Math.max(0, (Date.now() - interviewStartedAtRef.current) / 1000)
        reviewRef.current.events.push({
          id: crypto.randomUUID(),
          eventType: event.kind,
          severity: 'warn',
          message: event.message,
          timestamp: new Date().toISOString(),
          formattedTime: `${Math.floor(elapsedSec / 60)}:${String(Math.floor(elapsedSec % 60)).padStart(2, '0')}`,
          startOffsetSec: elapsedSec,
          durationSec: 0,
          reviewOnly: true,
        })
        if (event.notify) {
          setGuardNotice('Copying, pasting and developer tools are turned off during the interview. This was recorded.')
          window.clearTimeout(guardNoticeTimer.current)
          guardNoticeTimer.current = window.setTimeout(() => setGuardNotice(''), 4000)
        }
      },
    })
    return () => {
      detachContentGuard()
      window.clearTimeout(guardNoticeTimer.current)
      setGuardNotice('')
      roomGuardDetachRef.current?.()
      roomGuardDetachRef.current = null
      document.body.style.overflow = ''
      exitInterviewFullscreen()
    }
  }, [stage, handleInterviewRoomViolation])

  useEffect(() => {
    void ensureApiSession()
  }, [])

  /** Bumped when a booked slot arrives from the server (a new tab / device has no copy in sessionStorage). */
  const [bookingVersion, setBookingVersion] = useState(0)
  /** Lobby notice: an interview in progress to continue, or an earlier attempt that ended. */
  const [lobbyNotice, setLobbyNotice] = useState('')

  useEffect(() => {
    // The booked slot lives on the server too: lock the lobby in every tab, not only the one that booked it.
    if (isImmediateInterviewAllowed() || readStoredInterviewInvite()) return
    let cancelled = false
    void fetchInterviewBooking().then((got) => {
      if (cancelled || !got?.booking || got.booking.status !== 'too_early') return
      if (storeBookingLock(got.booking, got.serverNow)) setBookingVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Only a scheduled invite needs a live clock (countdown to the slot); otherwise don't re-render every second.
    if (isImmediateInterviewAllowed() || !readStoredInterviewInvite()) return
    const id = window.setInterval(() => setScheduleClock(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [bookingVersion])

  const scheduledInviteAccess = useMemo(() => {
    if (isImmediateInterviewAllowed()) return null
    return inviteAccessFromStored(readStoredInterviewInvite(), scheduleClock)
    // bookingVersion: re-read storage when the server reported a booking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleClock, bookingVersion])
  const slotStoredInvite = useMemo(
    () => (scheduledInviteAccess ? readStoredInterviewInvite() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduledInviteAccess?.status, bookingVersion],
  )
  const slotMsLeft = scheduledInviteAccess?.status === 'too_early' ? msUntilSlotOpens(slotStoredInvite, scheduleClock) : null

  const [customJd] = useState(
    targetJobRaw?.jd
      ? targetJobRaw.jd
      : targetJobRaw?.title
        ? `Target Job: ${targetJobRaw.title} at ${targetJobRaw.company}`
        : '',
  )
  const [roleTrackExplicit] = useState(() => Boolean(targetJobRaw))
  const roleTrackExplicitRef = useRef(roleTrackExplicit)
  const [faceStatus, setFaceStatus] = useState<FaceTrackStatus>(INITIAL_FACE_STATUS)
  /** Latest status from every tick (state only follows visible changes). */
  const faceStatusRef = useRef<FaceTrackStatus>(INITIAL_FACE_STATUS)
  const faceStatusKeyRef = useRef('')
  const [interviewBanned, setInterviewBanned] = useState(false)
  const [banMessage, setBanMessage] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const reviewRef = useRef(new ReviewEventTracker())
  const [guardNotice, setGuardNotice] = useState('')
  const guardNoticeTimer = useRef<number | undefined>(undefined)
  const [reviewSyncError, setReviewSyncError] = useState('')

  useEffect(() => {
    if (!starting) {
      setStartingSlow(false)
      return
    }
    const id = window.setTimeout(() => setStartingSlow(true), PREPARING_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [starting])
  // Nothing is recorded (and the camera is not opened) until the candidate agrees in the waiting room.
  // The consent screen was removed: candidates go straight to the camera check. The server still requires a
  // consent object to start a session, so one is supplied automatically. The version tag marks these records as
  // "not prompted" so they cannot be mistaken for an explicit acceptance of the consent wording.
  const [interviewConsent] = useState<InterviewConsent | null>(() => ({
    ...buildInterviewConsent(),
    version: 'no-prompt',
  }))
  const recordingConsent = interviewConsent !== null

  const lobbySessionKey = useMemo(
    () =>
      lobbySessionPrepKey({
        role,
        level,
        targetJobRaw,
        customJd,
        interviewConsent,
      }),
    [role, level, targetJobRaw, customJd, interviewConsent],
  )

  const sessionIdRef = useRef<string | null>(null)
  const varietySeedRef = useRef<string>('')
  const totalTurnsRef = useRef(MAX_ADAPTIVE_QUESTIONS)
  const integrityRef = useRef<IntegritySnapshot>({
    faceViolations: 0,
    singlePersonOk: true,
    maxFacesSeen: 1,
    sideLookWarnings: 0,
    tooFarWarnings: 0,
  })
  const faceTrackerRef = useRef<FaceTracker | null>(null)
  const proctorRef = useRef<InterviewProctorEngine | null>(null)
  const proctorStoppedRef = useRef(false)
  const multiBanRef = useRef(0)
  const currentRef = useRef(0)
  /** Live question list. The 400ms tick must not close over `questions` from the render that started the interval. */
  const questionsRef = useRef(questions)
  questionsRef.current = questions
  const recorderRef = useRef(new InterviewRecorder())
  const pendingClipRef = useRef<Awaited<ReturnType<InterviewRecorder['stop']>>>(null)
  const recordingBlobUrlRef = useRef<string | null>(null)

  const answersRef = useRef<string[]>([])
  const finishingRef = useRef(false)
  const draftRef = useRef('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const moonshineVadRef = useRef<MoonshineVadSttController | null>(null)
  const lobbySttSnapshotRef = useRef<LobbySttSnapshot>({
    moonshineStatus: 'idle',
    vadReady: false,
  })
  const [moonshineVadReady, setMoonshineVadReady] = useState(false)
  const [moonshineInitFailed, setMoonshineInitFailed] = useState(false)
  const [sttStatus, setSttStatus] = useState<MoonshineStatus>(() => moonshineStt.getState().status)
  /** Moonshine path: idle | capturing (Silero) | transcribing (local WASM). Web Speech fallback when init fails. */
  const baseDraftRef = useRef('')
  const transcriptCommittedRef = useRef('')
  const streamRef = useRef<MediaStream | null>(null)
  const lobbyVideoRef = useRef<HTMLVideoElement | null>(null)
  const roomVideoRef = useRef<HTMLVideoElement | null>(null)
  const micOnRef = useRef(true)
  const stageRef = useRef<Stage>(stage)
  const listenAfterTtsRef = useRef(true)
  const speakGenRef = useRef(0)
  const advancingRef = useRef(false)
  const adaptiveRef = useRef(true)
  const interviewStartedAtRef = useRef<number>(0)
  const historyRef = useRef<{ question: Question; answer: string }[]>([])
  const lastSpeechAtRef = useRef(0)
  const answerWindowStartedAtRef = useRef(0)
  const noAnswerSkipTriggeredRef = useRef(false) // the silence nudge was given for this question
  const timeNudgedRef = useRef(false) // the "about 30 seconds left" nudge was given for this question
  const timeUpRef = useRef(false) // the 3:00 ran out; advance as soon as the candidate is not speaking
  const secondsLeftRef = useRef(QUESTION_SECONDS)
  const aiSpeakingRef = useRef(false)
  /** Which line Ava is in the middle of. The echo gate is on only for these; null means she is not speaking. */
  const speakingKindRef = useRef<'question' | 'nudge' | 'ack' | null>(null)
  /** Exact string passed to speakText for the current utterance. */
  const spokenLineRef = useRef('')
  /** Skip: drop late transcript segments until the next question clears this. */
  const ignoreTranscriptRef = useRef(false)
  const listeningRef = useRef(false)
  const submitAnswerRef = useRef<(reason?: AdvanceReason) => void>(() => {})
  /** When the "Moving on… keep talking to continue" countdown started (0 = not running). */
  const countdownStartedAtRef = useRef(0)
  const [endingCountdown, setEndingCountdown] = useState(false)
  /** Ava is saying a nudge: the mic stays on, but her own words must not count as a spoken command. */
  const nudgeMutedUntilRef = useRef(0)
  /** The answer could not be saved: the question stays, with a Retry (never a silent advance). */
  const [saveFailedNotice, setSaveFailedNotice] = useState('')
  const lastAdvanceReasonRef = useRef<AdvanceReason>('submit')
  const bargeCooldownRef = useRef(0)

  const sttReadyRef = useRef(false)
  /** When Moonshine/VAD misses a segment, keep using browser speech for the rest of the session. */
  const webSpeechFallbackRef = useRef(false)
  const [webSpeechFallback, setWebSpeechFallback] = useState(false)

  function markWebSpeechFallback() {
    if (webSpeechFallbackRef.current) return
    webSpeechFallbackRef.current = true
    setWebSpeechFallback(true)
  }

  const question = questions[current]
  const webSpeechSupported = isSpeechRecognitionSupported()
  const moonshineSttReady = sttStatus === 'ready'
  const useSileroMoonshineStt =
    moonshineVadReady &&
    moonshineSttReady &&
    !moonshineInitFailed &&
    !webSpeechFallback
  const speechSupported = useSileroMoonshineStt || webSpeechSupported
  const moonshineSttLoading =
    streamReady &&
    !moonshineInitFailed &&
    !webSpeechFallback &&
    sttStatus !== 'error' &&
    (!moonshineVadReady || sttStatus === 'downloading' || sttStatus === 'idle')
  const ttsSupported = isSpeechSynthesisSupported()
  const [candidateDisplayName, setCandidateDisplayName] = useState(() => candidateFullName())
  const [savedReport] = useState<InterviewResult | null>(() => getInterviewResult())
  const name = candidateDisplayName && candidateDisplayName !== 'Candidate' ? candidateDisplayName.trim().replace(/\s+/g, ' ') : 'there'
  const firstName = name.split(' ')[0] || name

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('report') === '1' || params.get('results') === '1') {
      const saved = getInterviewResult()
      if (saved) {
        setResult(saved)
        setStage('results')
      }
    }
  }, [])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    roleTrackExplicitRef.current = roleTrackExplicit
  }, [roleTrackExplicit])

  useEffect(() => {
    currentRef.current = current
  }, [current])

  useEffect(() => {
    micOnRef.current = micOn
  }, [micOn])

  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  useEffect(() => {
    aiSpeakingRef.current = aiSpeaking
  }, [aiSpeaking])

  useEffect(() => {
    listeningRef.current = listening
  }, [listening])

  useEffect(() => {
    moonshineStt.preloadNow()
    return moonshineStt.subscribe((s) => {
      sttReadyRef.current = s.status === 'ready'
      setSttStatus(s.status) // progress ticks do not re-render the page
      if (s.status === 'error' && stageRef.current === 'interview') {
        markWebSpeechFallback()
      }
    })
  }, [])

  useEffect(() => {
    lobbySttSnapshotRef.current = {
      moonshineStatus: sttStatus,
      vadReady: moonshineVadReady,
    }
  }, [sttStatus, moonshineVadReady])

  useEffect(() => {
    if (stage !== 'results' || !result || !sessionIdRef.current) return
    const sessionId = sessionIdRef.current
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const { uploadInterviewReportPdfToS3 } = await import('../lib/interviewReportUpload')
        if (!cancelled) await uploadInterviewReportPdfToS3(sessionId)
      })()
    }, 1200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [stage, result])

  const applyTranscriptSegmentRef = useRef<(text: string, captureEndedAt?: number) => void>(() => {})

  applyTranscriptSegmentRef.current = (raw: string, captureEndedAt?: number) => {
    if (ignoreTranscriptRef.current) return
    const questionText = questionsRef.current[currentRef.current]?.text || spokenLineRef.current
    const segment = stripEchoOfQuestion(raw.trim(), questionText)
    // A final that is only the tail of Ava's question is not an answer.
    if (!segment) return

    const speaking = speakingKindRef.current
    const gateOn = speaking === 'question' || speaking === 'nudge' || speaking === 'ack'
    if (gateOn && classifySpokenSegment(segment, spokenLineRef.current) !== 'clear') return

    const base = transcriptCommittedRef.current.trim()
    const line = base ? `${base} ${segment}` : segment
    transcriptCommittedRef.current = line
    setDraft(line)
    draftRef.current = line
    // Stamp the capture-end recorded before transcription, not the time the text is written.
    if (typeof captureEndedAt === 'number') lastSpeechAtRef.current = captureEndedAt
    if (speaking === 'question') handleBargeIn()
  }

  useEffect(() => {
    if (!streamReady) {
      setMoonshineVadReady(false)
      setMoonshineInitFailed(false)
      return
    }
    let cancelled = false
    setMoonshineVadReady(false)
    setMoonshineInitFailed(false)
    void createMoonshineVadSttController({
      getStream: () => streamRef.current,
      isAiSpeaking: () => aiSpeakingRef.current,
      onSpeechCaptureStart: () => markSttPhase('capturing'),
      onTranscribing: (active) => markSttPhase(active ? 'transcribing' : 'idle'),
      onSegmentText: (text, captureEndedAt) => applyTranscriptSegmentRef.current(text, captureEndedAt),
      onError: (message) => {
        console.warn('[moonshine-vad-stt]', message)
        setSttPhase('idle')
      },
      onTranscriptionMiss: (reason) => {
        if (!shouldStickToWebSpeechFallback(reason)) {
          return
        }
        setDeviceError(
          `${reason} You can type your answer below or keep speaking.`,
        )
        setShowTypeFallback(true)
        if (webSpeechSupported) {
          markWebSpeechFallback()
          if (
            listeningRef.current &&
            micOnRef.current &&
            (!aiSpeakingRef.current || speakingKindRef.current === 'question')
          ) {
            stopListening()
            startWebSpeechListening()
          }
        }
      },
    }).then((controller) => {
      if (cancelled) {
        void controller?.dispose()
        return
      }
      moonshineVadRef.current = controller
      const ok = Boolean(controller)
      setMoonshineVadReady(ok)
      setMoonshineInitFailed(!ok)
    })
    return () => {
      cancelled = true
      setMoonshineVadReady(false)
      setMoonshineInitFailed(false)
      void moonshineVadRef.current?.dispose()
      moonshineVadRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamReady])

  // Face tracking for the lobby and the whole interview. One model (FaceTracker) at ~3 Hz feeds the on-screen
  // status, the review-event log and the proctoring engine. React state only changes when what the candidate sees
  // changes, so typing and speech are never competing with a re-render every tick.
  useEffect(() => {
    if (stage === 'setup' && (skipCamera || !streamReady)) return
    if (stage === 'analyzing' || stage === 'results') return
    const tracker = new FaceTracker()
    faceTrackerRef.current = tracker
    let alive = true
    let timer: number | undefined
    const tick = async () => {
      if (!alive || interviewBanned) return
      const video =
        stageRef.current === 'interview' ? roomVideoRef.current : lobbyVideoRef.current
      const status = await tracker.detect(video)
      if (!alive) return
      faceStatusRef.current = status
      const key = faceStatusKey(status)
      if (key !== faceStatusKeyRef.current) {
        faceStatusKeyRef.current = key
        setFaceStatus(status)
      }

      if (stageRef.current === 'interview' && !pendingClipRef.current) {
        // Offsets are seconds since the recording started; the observation adds head-movement / phone intervals.
        reviewRef.current.sample(
          status,
          Math.max(0, (Date.now() - interviewStartedAtRef.current) / 1000),
          Date.now(),
          tracker.lastObservation,
        )
        integrityRef.current.logs = reviewRef.current.events
        proctorRef.current?.observe(tracker.lastObservation)
      }
    }
    const loop = () => {
      void tick().finally(() => {
        if (alive) timer = window.setTimeout(loop, FACE_SAMPLE_INTERVAL_MS)
      })
    }
    loop()
    return () => {
      alive = false
      window.clearTimeout(timer)
      tracker.dispose()
      faceTrackerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamReady, skipCamera, stage, interviewBanned])

  // Even when the lobby face check is skipped, the room tracks faces: load the model before the candidate joins.
  useEffect(() => {
    if (streamReady) preloadFaceTracker()
  }, [streamReady])

  // Section-level proctoring (debounced flags for employer review — not shown on candidate scorecard). It has no
  // model of its own; the face-tracking loop above feeds it.
  useEffect(() => {
    if (stage !== 'interview' || interviewBanned) return
    proctorStoppedRef.current = false
    const engine = new InterviewProctorEngine()
    const q = questions[currentRef.current]
    engine.setTurnContext(currentRef.current + 1, q?.text ?? '')
    engine.start(interviewStartedAtRef.current || Date.now())
    proctorRef.current = engine
    return () => {
      if (!proctorStoppedRef.current) {
        proctorRef.current?.stop()
      }
      proctorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, interviewBanned])

  useEffect(() => {
    if (stage !== 'interview') return
    const q = questions[current]
    proctorRef.current?.setTurnContext(current + 1, q?.text ?? '')
  }, [stage, current, questions])

  function attachStream(video: HTMLVideoElement | null) {
    if (!video || !streamRef.current) return
    if (video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current
      video.muted = true
      video.playsInline = true
      void video.play().catch(() => undefined)
    }
  }

  const bindRoomVideo = useCallback((el: HTMLVideoElement | null) => {
    roomVideoRef.current = el
    if (el && streamRef.current && stageRef.current === 'interview') {
      attachStream(el)
    }
  }, [])

  const bindLobbyVideo = useCallback((el: HTMLVideoElement | null) => {
    lobbyVideoRef.current = el
    if (el && streamRef.current && stageRef.current === 'setup') {
      attachStream(el)
    }
  }, [])

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStreamReady(false)
    if (lobbyVideoRef.current) lobbyVideoRef.current.srcObject = null
    if (roomVideoRef.current) roomVideoRef.current.srcObject = null
  }

  function markSttPhase(phase: 'idle' | 'capturing' | 'transcribing') {
    if (sttPhaseRef.current !== phase) sttPhaseSinceRef.current = Date.now()
    sttPhaseRef.current = phase
    setSttPhase(phase)
  }

  function stopListening() {
    void moonshineVadRef.current?.stop()
    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore
    }
    recognitionRef.current = null
    setListening(false)
    listeningRef.current = false
    markSttPhase('idle')
  }

  function stopAllSpeech() {
    speakGenRef.current += 1
    listenAfterTtsRef.current = false
    cancelSpeech()
    setAiSpeaking(false)
    aiSpeakingRef.current = false
    speakingKindRef.current = null
    stopListening()
  }

  useEffect(() => {
    return () => {
      stopAllSpeech()
      stopTracks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (stage === 'setup') attachStream(lobbyVideoRef.current)
    if (stage === 'interview') {
      // Retry attach — video node mounts after stage switch
      const tryAttach = () => attachStream(roomVideoRef.current)
      tryAttach()
      const t1 = window.setTimeout(tryAttach, 80)
      const t2 = window.setTimeout(tryAttach, 250)
      const t3 = window.setTimeout(tryAttach, 600)
      return () => {
        window.clearTimeout(t1)
        window.clearTimeout(t2)
        window.clearTimeout(t3)
      }
    }
  }, [stage, streamReady, camOn])

  async function enableDevices() {
    setMediaBusy(true)
    setDeviceError('')
    try {
      if (streamRef.current) stopTracks()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: interviewAudioConstraints(),
      })
      streamRef.current = stream
      setStreamReady(true)
      setSkipCamera(false)
      setCamOn(true)
      setMicOn(true)
      attachStream(lobbyVideoRef.current)
    } catch {
      setDeviceError(
        'Camera or microphone blocked. Allow access in your browser, or continue without camera.',
      )
      setStreamReady(false)
    } finally {
      setMediaBusy(false)
    }
  }

  // Prompt for camera & mic once the candidate has agreed to recording.
  useEffect(() => {
    if (stage !== 'setup' || streamReady || skipCamera || !interviewConsent) return
    void enableDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, interviewConsent])

  function setTrackEnabled(kind: 'video' | 'audio', enabled: boolean) {
    streamRef.current?.getTracks().forEach((track) => {
      if (track.kind === kind) track.enabled = enabled
    })
  }

  function toggleCamera() {
    const next = !camOn
    setCamOn(next)
    setTrackEnabled('video', next)
  }

  function toggleMic() {
    const next = !micOn
    setMicOn(next)
    setTrackEnabled('audio', next)
    micOnRef.current = next
    if (!next) stopListening()
    else if (
      stage === 'interview' &&
      speechSupported &&
      (!aiSpeaking || speakingKindRef.current === 'question')
    ) {
      startListening()
    }
  }

  function handleBargeIn() {
    if (speakingKindRef.current !== 'question') return
    if (!aiSpeakingRef.current) return
    const now = Date.now()
    if (now - bargeCooldownRef.current < 400) return
    bargeCooldownRef.current = now
    speakingKindRef.current = null
    speakGenRef.current += 1
    cancelSpeech()
    setAiSpeaking(false)
    aiSpeakingRef.current = false
    listenAfterTtsRef.current = true
    // The candidate spoke over the question: their answer window (and the answer clock) starts now.
    if (!answerWindowStartedAtRef.current) answerWindowStartedAtRef.current = Date.now()
  }

  function shouldUseMoonshineVad(): boolean {
    return Boolean(
      moonshineVadRef.current &&
        sttReadyRef.current &&
        !moonshineInitFailed &&
        !webSpeechFallbackRef.current,
    )
  }

  function startWebSpeechListening() {
    const recognition = getSpeechRecognition()
    if (!recognition) return
    configureInterviewRecognition(recognition)
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (ignoreTranscriptRef.current) return
      let finalChunk = ''
      let interimChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const chunk = (result[0]?.transcript || '').trim()
        if (!chunk) continue
        if (result.isFinal) finalChunk = finalChunk ? `${finalChunk} ${chunk}` : chunk
        else interimChunk = interimChunk ? `${interimChunk} ${chunk}` : chunk
      }
      const segment = (finalChunk || interimChunk).trim()
      if (!segment) return
      const speaking = speakingKindRef.current
      const gateOn = speaking === 'question' || speaking === 'nudge' || speaking === 'ack'
      if (gateOn && classifySpokenSegment(segment, spokenLineRef.current) !== 'clear') return

      if (finalChunk) {
        // One stamp, on the accepted final. Interim never moves lastSpeechAt.
        applyTranscriptSegmentRef.current(finalChunk, Date.now())
        markSttPhase('idle')
        return
      }

      const display = `${transcriptCommittedRef.current} ${interimChunk}`.trim()
      if (display) {
        setDraft(display)
        draftRef.current = display
      }
      markSttPhase('capturing')
      if (speaking === 'question') handleBargeIn()
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => {
      setListening(false)
      listeningRef.current = false
      const duringQuestion = speakingKindRef.current === 'question'
      if (
        listenAfterTtsRef.current &&
        (duringQuestion || !aiSpeakingRef.current) &&
        stageRef.current === 'interview' &&
        micOnRef.current &&
        !finishingRef.current &&
        !advancingRef.current
      ) {
        try {
          recognition.start()
          setListening(true)
          listeningRef.current = true
        } catch {
          // already started
        }
      }
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      listeningRef.current = true
    } catch {
      setListening(false)
      listeningRef.current = false
    }
  }

  function startListening() {
    if (!speechSupported || !micOnRef.current) return
    if (aiSpeakingRef.current && speakingKindRef.current !== 'question') return
    stopListening()
    baseDraftRef.current = draftRef.current.trim()
    transcriptCommittedRef.current = baseDraftRef.current

    if (shouldUseMoonshineVad()) {
      void moonshineVadRef.current!
        .start()
        .then(() => {
          setListening(true)
          listeningRef.current = true
        })
        .catch(() => {
          markWebSpeechFallback()
          setDeviceError('Switched to your browser’s speech recognition for voice answers.')
          startWebSpeechListening()
        })
      return
    }

    startWebSpeechListening()
  }

  useEffect(() => {
    if (stage !== 'interview' || !moonshineSttReady || !moonshineVadReady) return
    if (webSpeechFallbackRef.current || !listeningRef.current || !micOnRef.current) return
    if (recognitionRef.current) return
    if (aiSpeakingRef.current && speakingKindRef.current !== 'question') return
    if (!shouldUseMoonshineVad()) return
    stopListening()
    startListening()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, moonshineSttReady, moonshineVadReady])
  useEffect(() => {
    if (stage !== 'interview' || !question) return

    const gen = ++speakGenRef.current
    ignoreTranscriptRef.current = false
    lastSpeechAtRef.current = 0
    answerWindowStartedAtRef.current = 0
    noAnswerSkipTriggeredRef.current = false
    timeNudgedRef.current = false
    timeUpRef.current = false
    secondsLeftRef.current = QUESTION_SECONDS
    setNoAnswerNotice('')
    setDraft('')
    draftRef.current = ''
    baseDraftRef.current = ''
    transcriptCommittedRef.current = ''
    markSttPhase('idle')
    setAiSpeaking(true)
    aiSpeakingRef.current = true

    const intro = current === 0 ? `Hello ${firstName}. I am Ava. ` : ''
    const spoken = `${intro}${question.text}`
    // Every question gets a fresh 3:00; the clock itself only runs once Ava has finished asking.
    setSecondsLeft(QUESTION_SECONDS)
    const closing = isClosingStatement(question)
    if (!closing) {
      // Mic stays up while she asks. The echo gate drops her own line.
      speakingKindRef.current = 'question'
      spokenLineRef.current = spoken
      listenAfterTtsRef.current = true
      if (micOnRef.current && speechSupported) startListening()
    } else {
      speakingKindRef.current = null
      spokenLineRef.current = ''
      listenAfterTtsRef.current = false
    }

    const endQuestionUtterance = () => {
      if (speakingKindRef.current === 'question') speakingKindRef.current = null
      setAiSpeaking(false)
      aiSpeakingRef.current = false
    }

    speakText(spoken, {
      onStart: () => {
        if (gen === speakGenRef.current) {
          setAiSpeaking(true)
          aiSpeakingRef.current = true
        }
      },
      onEnd: () => {
        if (gen !== speakGenRef.current) return
        endQuestionUtterance()
        if (closing) {
          finishAfterClosing()
          return
        }
        listenAfterTtsRef.current = true
        answerWindowStartedAtRef.current = Date.now()
        if (
          stageRef.current === 'interview' &&
          micOnRef.current &&
          !listeningRef.current
        ) {
          startListening()
        }
      },
      onError: () => {
        if (gen !== speakGenRef.current) return
        endQuestionUtterance()
        if (closing) {
          finishAfterClosing()
          return
        }
        listenAfterTtsRef.current = true
        answerWindowStartedAtRef.current = Date.now()
        if (stageRef.current === 'interview' && micOnRef.current) startListening()
      },
    })

    return () => {
      speakGenRef.current += 1
      speakingKindRef.current = null
      cancelSpeech()
      stopListening()
      setAiSpeaking(false)
      aiSpeakingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, current, question?.text])

  useEffect(() => {
    if (stage !== 'interview') return
    const id = window.setInterval(() => {
      if (
        finishingRef.current ||
        advancingRef.current ||
        aiSpeakingRef.current ||
        interviewBanned ||
        isClosingQuestionAt(questionsRef.current, currentRef.current)
      ) {
        return
      }
      const now = Date.now()
      // A capture that never ends leaves the transcript empty and blocks the timer. Drop it so typing and time-up work.
      if (
        sttPhaseRef.current === 'capturing' &&
        sttPhaseSinceRef.current > 0 &&
        now - sttPhaseSinceRef.current >= CAPTURE_STUCK_MS
      ) {
        markSttPhase('idle')
      }
      // Rules (and the no-answer timeout) live in answerTiming.decideAnswerTick.
      const decision = decideAnswerTick({
        now,
        transcript: draftRef.current,
        sttPhase: sttPhaseRef.current,
        lastSpeechAt: lastSpeechAtRef.current,
        answerWindowStartedAt: answerWindowStartedAtRef.current,
        nudged: noAnswerSkipTriggeredRef.current,
        secondsLeft: secondsLeftRef.current,
        timeNudged: timeNudgedRef.current,
        countdownStartedAt: countdownStartedAtRef.current,
        commandsMuted: Date.now() < nudgeMutedUntilRef.current,
      })
      if (decision === 'start-countdown') {
        countdownStartedAtRef.current = Date.now()
        setEndingCountdown(true)
        return
      }
      if (decision === 'cancel-countdown') {
        countdownStartedAtRef.current = 0
        setEndingCountdown(false)
        return
      }
      if (decision === 'submit' || decision === 'submit-now') {
        countdownStartedAtRef.current = 0
        setEndingCountdown(false)
        submitAnswerRef.current(decision === 'submit' ? 'voice-complete' : 'said-next')
      } else if (timeUpRef.current) {
        const transcribeInFlight = moonshineVadRef.current?.transcribeInFlight() ?? false
        // A live transcription joins for up to 12 s. The 4 s grace is only when nothing is in flight.
        if (
          transcribeInFlight ||
          timeUpCanAdvance({
            now,
            lastSpeechAt: lastSpeechAtRef.current,
            sttPhase: sttPhaseRef.current,
            answerWindowStartedAt: answerWindowStartedAtRef.current,
            phaseSince: sttPhaseSinceRef.current,
            transcribeInFlight,
          })
        ) {
          submitAnswerRef.current('time-up')
        }
      } else if (decision === 'nudge') {
        noAnswerSkipTriggeredRef.current = true
        nudgeCandidate(SILENCE_NUDGE_PROMPT, SILENCE_NUDGE_SPOKEN)
      } else if (decision === 'time-nudge') {
        timeNudgedRef.current = true
        nudgeCandidate(TIME_LEFT_NUDGE_PROMPT)
      }
    }, 400)
    return () => window.clearInterval(id)
    // Reads the live question through questionsRef. Do not add `questions` here: that would restart the tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, current, interviewBanned])

  useEffect(() => {
    if (stage !== 'interview') return
    setSecondsLeft(QUESTION_SECONDS)
    let alive = true
    const id = window.setInterval(() => {
      // The 3:00 starts when Ava has finished asking (never while she speaks, never for the closing line).
      if (
        !answerClockRunning({
          answerWindowStartedAt: answerWindowStartedAtRef.current,
          aiSpeaking: aiSpeakingRef.current,
          closing: isClosingQuestionAt(questionsRef.current, currentRef.current),
        }) ||
        advancingRef.current
      ) {
        return
      }
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id)
          // The answer loop moves on once the candidate is not mid-sentence (answerTiming.timeUpCanAdvance).
          if (alive) timeUpRef.current = true
          secondsLeftRef.current = 0
          return 0
        }
        secondsLeftRef.current = s - 1
        return s - 1
      })
    }, 1000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, current])

  useEffect(() => {
    if (stage !== 'interview') return
    let inFlight = false
    const timer = window.setInterval(() => {
      const sid = sessionIdRef.current
      if (!isServerInterviewSession(sid) || inFlight) return
      inFlight = true
      void saveReviewEvents(sid, reviewRef.current.events)
        .then(() => setReviewSyncError(''))
        .catch(e => setReviewSyncError(candidateSyncErrorMessage(e)))
        .finally(() => { inFlight = false })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [stage])

  async function joinInterviewRoom() {
    if (!canStart || starting) return

    const camLabel = streamRef.current?.getVideoTracks()[0]?.label
    if (looksLikeVirtualCamera(camLabel)) {
      setDeviceError(
        `A virtual camera was detected (${camLabel}). Switch to your real webcam and turn off camera software such as OBS or ManyCam to join.`,
      )
      return
    }
    const extended = Boolean((window.screen as unknown as { isExtended?: boolean }).isExtended)
    if (extended && import.meta.env.VITE_BLOCK_MULTI_MONITOR === 'true') {
      setDeviceError('More than one display is connected. Disconnect extra monitors and join again.')
      return
    }

    interviewLockRequireFullscreenRef.current = shouldRequireInterviewFullscreen()
    if (interviewLockRequireFullscreenRef.current) {
      const fs = await requestInterviewFullscreen()
      if (fs.result !== 'granted') {
        setDeviceError(
          fs.result === 'unsupported'
            ? 'This browser cannot enter fullscreen. Use a browser and device that support fullscreen to join the interview.'
            : fullscreenDeniedUserMessage(fs),
        )
        return
      }
    }

    await startInterview()
  }

  async function startInterview() {
    if (!streamReady) {
      setDeviceError('Allow microphone access before joining the interview room.')
      return
    }
    if (!skipCamera) {
      if (faceStatus.issue === 'multi_person' || faceStatus.severity === 'ban') {
        setDeviceError('More than one person detected — clear the frame to only you before joining.')
        return
      }
      if (faceStatus.severity === 'block' || faceStatus.faceCount !== 1) {
        setDeviceError('Face check: sit where Ava can see your face (move closer if you are far).')
        return
      }
      if (faceStatus.issue === 'looking_away' && !faceStatus.lookingForward) {
        setDeviceError('Face the camera straight-on before joining.')
        return
      }
    }
    setStarting(true)
    setDeviceError('')
    finishingRef.current = false
    setInterviewBanned(false)
    setBanMessage('')
    multiBanRef.current = 0
    answersRef.current = []
    integrityRef.current = {
      faceViolations: 0,
      singlePersonOk: true,
      maxFacesSeen: Math.max(1, faceStatus.faceCount),
      sideLookWarnings: 0,
      tooFarWarnings: 0,
      banned: false,
      // "Continue without camera" chosen explicitly: no "no face" penalty, the recruiter sees "camera off by choice".
      cameraOffByChoice: skipCamera,
    }
    stopAllSpeech()
    try {
      historyRef.current = []
      interviewStartedAtRef.current = Date.now()
      // Session + question batch may already be in flight from the waiting room (no extra UI for that).
      const voicePromise = prepareVoiceForRoom()
      const sessionPromise = beginLobbySessionPrep(lobbySessionKey, () =>
        runLobbySessionPrep({
          role,
          level,
          profile,
          customJd,
          targetJobRaw,
          roleTrackExplicit: roleTrackExplicitRef.current,
          interviewConsent,
        }),
      )
      const [preparedPayload, voice] = await Promise.all([sessionPromise, voicePromise])
      // Entering is what makes the interview count (free interview / paid credit), never the waiting room.
      const sessionPayload = await enterPreparedSession(preparedPayload, () =>
        beginLobbySessionPrep(lobbySessionKey, () =>
          runLobbySessionPrep({
            role,
            level,
            profile,
            customJd,
            targetJobRaw,
            roleTrackExplicit: roleTrackExplicitRef.current,
            interviewConsent,
          }),
        ),
      )
      const { started, targetJob, mergedProfile } = sessionPayload
      activeJobRef.current = targetJob
      const nameFromProfile = displayNameFromSessionProfile(mergedProfile, candidateDisplayName)
      if (nameFromProfile && nameFromProfile !== candidateDisplayName) {
        setCandidateDisplayName(nameFromProfile)
      }
      adaptiveRef.current = started.adaptive !== false
      budgetMinutesRef.current = started.jdFirst ? interviewDurationMinutes(targetJob, started.durationMinutes) : 0
      sessionIdRef.current = started.sessionId
      varietySeedRef.current = started.varietySeed || varietySeedRef.current
      totalTurnsRef.current = Math.max(
        started.total || 0,
        started.questions?.length || 0,
        MAX_ADAPTIVE_QUESTIONS,
      )
      setQuestions(started.questions)
      // Back after a reload / crash: same session, same questions, answers kept; continue where it stopped.
      const resumePoint = resumePointFromStart(started)
      answersRef.current = resumePoint.answers
      historyRef.current = resumePoint.history
      setCurrent(resumePoint.current)
      setLobbyNotice('')
      setDraft('')
      setResult(null)
      setRecordingUrl(null)
      // Without browser speech, a still-loading voice model means typed answers until it is ready.
      setShowTypeFallback(!speechSupported || (voice === 'fallback' && !webSpeechSupported))
      if (recordingConsent && !sessionIdRef.current) throw new Error('We could not connect to your interview. Please reconnect before starting a recording.')

      setStage('interview')
      reviewRef.current = new ReviewEventTracker()
      interviewStartedAtRef.current = Date.now()
      // This epoch is also the recording timeline origin.
      if (streamRef.current && recordingConsent && isServerInterviewSession(sessionIdRef.current)) {
        const ok = recorderRef.current.start(streamRef.current)
        setIsRecording(ok)
        if (!ok) {
          console.warn('[InterviewPage] recording unavailable in this browser — answers still score')
        }
      } else if (streamRef.current && recordingConsent) {
        console.warn('[InterviewPage] interview server unreachable — session not recorded, answers still score')
      }

      window.setTimeout(() => attachStream(roomVideoRef.current), 50)
      window.setTimeout(() => attachStream(roomVideoRef.current), 300)
    } catch (err) {
      if (err instanceof InterviewBookedError || (err instanceof Error && err.name === INTERVIEW_BOOKED_ERROR)) {
        // A booked slot that has not opened (enforced by the server in every tab): show the lock and countdown.
        invalidateLobbySessionPrep()
        const booked = err as InterviewBookedError
        if (storeBookingLock(booked.booking, booked.serverNow)) setBookingVersion((v) => v + 1)
        setStartRetryable(false)
        setDeviceError(booked.message)
        return
      }
      const paymentRequired = err instanceof Error && err.name === RETAKE_PAYMENT_REQUIRED_ERROR
      setRetakePaymentRequired(paymentRequired)
      setStartRetryable(!paymentRequired)
      // Never developer text (API keys, "Failed to fetch") in front of the candidate.
      setDeviceError(paymentRequired && err instanceof Error ? err.message : candidateStartErrorMessage(err))
    } finally {
      setStarting(false)
    }
  }

  /**
   * Waits (at most LOBBY_STT_WAIT_CAP_MS) for the on-device voice model. If it is not ready by then, or failed,
   * the session switches to the browser's speech recognition (the same fallback used when a transcription fails).
   */
  async function prepareVoiceForRoom(): Promise<'done' | 'fallback'> {
    if (webSpeechFallbackRef.current) return 'done'
    if (isLobbyLocalSttReady(lobbySttSnapshotRef.current)) return 'done'
    const fallBack = (): 'fallback' => {
      if (webSpeechSupported) markWebSpeechFallback()
      return 'fallback'
    }
    if (moonshineInitFailed || lobbySttSnapshotRef.current.moonshineStatus === 'error') return fallBack()
    const gate = await Promise.race([
      waitForLobbyLocalStt(() => lobbySttSnapshotRef.current, {
        waitMoonshine: (maxMs) => moonshineStt.waitUntilReady(maxMs),
        waitVad: async (maxMs) => {
          const deadline = Date.now() + maxMs
          while (Date.now() < deadline) {
            if (lobbySttSnapshotRef.current.vadReady) return true
            await new Promise((r) => setTimeout(r, 200))
          }
          return lobbySttSnapshotRef.current.vadReady
        },
        moonshineMaxMs: LOBBY_STT_WAIT_CAP_MS,
        vadMaxMs: LOBBY_STT_WAIT_CAP_MS,
        pollMs: 250,
      }),
      new Promise<{ ok: false; reason: string }>((resolve) =>
        window.setTimeout(() => resolve({ ok: false, reason: 'timeout' }), LOBBY_STT_WAIT_CAP_MS),
      ),
    ])
    return gate.ok ? 'done' : fallBack()
  }

  /** Warm voice models in the lobby so join only waits on the session API (no step list in UI). */
  useEffect(() => {
    if (stage !== 'setup' || !streamReady || !interviewConsent || lobbyVoicePrepRef.current) return
    lobbyVoicePrepRef.current = true
    void prepareVoiceForRoom()
    // prepareVoiceForRoom is stable for lobby lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, streamReady, interviewConsent])

  /** Question batch + session start run silently while the candidate is in the waiting room. */
  useEffect(() => {
    if (stage !== 'setup' || !interviewConsent) return
    if (scheduledInviteAccess && !scheduledInviteAccess.canStart) return
    void beginLobbySessionPrep(lobbySessionKey, () =>
      runLobbySessionPrep({
        role,
        level,
        profile,
        customJd,
        targetJobRaw,
        roleTrackExplicit: roleTrackExplicitRef.current,
        interviewConsent,
      }),
    )
      .then(({ started }) => {
        if (started.resumed) {
          const n = (started.questionIndex ?? 0) + 1
          setLobbyNotice(`You have an interview in progress. Enter the room to continue from question ${n} — your earlier answers are saved.`)
        } else if (started.previousAttempt?.message) {
          setLobbyNotice(started.previousAttempt.message)
        }
      })
      .catch((err) => {
        if (err instanceof InterviewBookedError) {
          invalidateLobbySessionPrep()
          if (storeBookingLock(err.booking, err.serverNow)) setBookingVersion((v) => v + 1)
        }
        /* otherwise join will retry; never surface “preparing questions” in the lobby */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, interviewConsent, lobbySessionKey, scheduledInviteAccess?.canStart])

  function endInterviewEarly() {
    if (finishingRef.current || stage !== 'interview') return
    stopAllSpeech()
    const next = [...answersRef.current]
    next[current] = draftRef.current.trim()
    answersRef.current = next
    if (
      !hasSubstantiveInterviewProgress(
        next,
        historyRef.current,
        draftRef.current,
        MIN_ANSWER_CHARS,
      )
    ) {
      void recorderRef.current.stop()
      leaveInterviewRoom(navigate)
      return
    }
    finishingRef.current = true
    finish(next, false)
  }

  /** Ava has said the closing line (a goodbye, not a question): finish without waiting for an "answer". */
  function finishAfterClosing() {
    if (finishingRef.current || stageRef.current !== 'interview') return
    stopListening()
    const next = [...answersRef.current]
    next[currentRef.current] = ''
    answersRef.current = next
    finishingRef.current = true
    finish(next, false)
  }

  /**
   * The candidate has been quiet: Ava says `text` (on screen too) and then KEEPS LISTENING. Silence never moves to
   * the next question (owner rule); only an answer, a skip, or the time running out does.
   */
  function nudgeCandidate(text: string, spoken: string = text) {
    const forIndex = currentRef.current
    // The microphone keeps running: nothing the candidate says during the nudge is lost. Ava's own words are
    // kept out of the spoken-command check while she talks (and the spoken line has no "next question" in it).
    setNoAnswerNotice(text)
    nudgeMutedUntilRef.current = Date.now() + 60_000
    speakingKindRef.current = 'nudge'
    spokenLineRef.current = spoken
    setAiSpeaking(true)
    aiSpeakingRef.current = true
    let done = false
    const after = () => {
      if (done) return
      done = true
      if (speakingKindRef.current === 'nudge') speakingKindRef.current = null
      setAiSpeaking(false)
      aiSpeakingRef.current = false
      nudgeMutedUntilRef.current = Date.now() + 1_500
      window.setTimeout(() => {
        if (currentRef.current === forIndex) setNoAnswerNotice((n) => (n === text ? '' : n))
      }, 6000)
      if (finishingRef.current || stageRef.current !== 'interview' || currentRef.current !== forIndex) return
      if (micOnRef.current && !listeningRef.current && !aiSpeakingRef.current) startListening()
    }
    speakText(spoken, { onEnd: after, onError: after })
  }

  /** "Skip question": the candidate chose to move on without answering this one. No transcript join. */
  function skipQuestion() {
    if (finishingRef.current || advancingRef.current || stage !== 'interview') return
    ignoreTranscriptRef.current = true
    draftRef.current = ''
    setDraft('')
    transcriptCommittedRef.current = ''
    baseDraftRef.current = ''
    void submitAnswer('skip')
  }

  /** One "Thank you." while a server save is in flight. Resolves when that utterance ends. */
  function speakSaveAck(): Promise<void> {
    const line = 'Thank you.'
    spokenLineRef.current = line
    speakingKindRef.current = 'ack'
    setAiSpeaking(true)
    aiSpeakingRef.current = true
    return new Promise((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        if (speakingKindRef.current === 'ack') speakingKindRef.current = null
        setAiSpeaking(false)
        aiSpeakingRef.current = false
        resolve()
      }
      speakText(line, { onEnd: done, onError: done })
    })
  }

  async function submitAnswer(reason: AdvanceReason = 'submit') {
    if (finishingRef.current || stage !== 'interview' || questions.length === 0) {
      return
    }
    if (interviewBanned || advancingRef.current) return
    lastAdvanceReasonRef.current = reason
    countdownStartedAtRef.current = 0
    setEndingCountdown(false)
    setSaveFailedNotice('')

    const waitsForTranscript =
      reason === 'submit' || reason === 'voice-complete' || reason === 'said-next' || reason === 'time-up'

    // Before any await, so a second tick cannot submit again while the join or the save is running.
    advancingRef.current = true
    setAdvancing(true)

    try {
    if (reason === 'skip') {
      ignoreTranscriptRef.current = true
      draftRef.current = ''
      setDraft('')
      transcriptCommittedRef.current = ''
      baseDraftRef.current = ''
      listenAfterTtsRef.current = false
      stopAllSpeech()
    } else if (waitsForTranscript) {
      // Cancel her voice only. VAD keeps running so an in-flight transcription can still land.
      speakGenRef.current += 1
      cancelSpeech()
      setAiSpeaking(false)
      aiSpeakingRef.current = false
      await moonshineVadRef.current?.joinTranscript(TRANSCRIPT_JOIN_MS)
      if (finishingRef.current || stageRef.current !== 'interview') return
      speakingKindRef.current = null
    } else {
      listenAfterTtsRef.current = false
      stopAllSpeech()
    }

    const answer = reason === 'skip' ? '' : stripAnswerDoneCommand(draftRef.current)
    const next = [...answersRef.current]
    next[current] = answer
    answersRef.current = next

    const answeredCount = next.filter((a) => a && a.trim()).length
    if (isEndInterviewCommand(answer)) {
      if (answeredCount < 1 && current === 0 && !answer.replace(/end|stop|finish|done/gi, '').trim()) {
        setDeviceError('Share at least one answer first, then say "end the interview".')
        listenAfterTtsRef.current = true
        speakingKindRef.current = null
        if (micOnRef.current) startListening()
        return
      }
      finishingRef.current = true
      finish(next, false)
      return
    }

    if (
      !adaptiveRef.current &&
      current >= questions.length - 1
    ) {
      finishingRef.current = true
      finish(next, false)
      return
    }

    const currentQuestion = questions[current]
    historyRef.current = [
      ...historyRef.current.slice(0, current),
      { question: currentQuestion, answer },
    ]
    // Saved on the server BEFORE moving on (a reload / crash resumes with it). If it cannot be saved, the question
    // stays with "Couldn't save — Retry": never a silent advance. advanceReason says why the question moved on.
    if (isServerInterviewSession(sessionIdRef.current)) {
      const ackDone = speakSaveAck()
      const saved = await saveAnswerBeforeAdvance(() =>
        recordInterviewAnswer({
          sessionId: sessionIdRef.current,
          questionIndex: current,
          question: currentQuestion,
          answer,
          advanceReason: reason,
        }),
      )
      if (finishingRef.current || stageRef.current !== 'interview') return
      if (!saved) {
        cancelSpeech()
        setAiSpeaking(false)
        aiSpeakingRef.current = false
        speakingKindRef.current = null
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        setSaveFailedNotice(offline ? OFFLINE_ANSWER_MESSAGE : 'Couldn’t save your answer.')
        if (offline) {
          const onBack = () => {
            window.removeEventListener('online', onBack)
            if (stageRef.current === 'interview' && currentRef.current === current) submitAnswerRef.current(reason)
          }
          window.addEventListener('online', onBack)
        }
        listenAfterTtsRef.current = true
        if (micOnRef.current) startListening()
        return
      }
      await ackDone
    }

    if (
      adaptiveRef.current &&
      historyRef.current.length >= totalTurnsRef.current
    ) {
      finishingRef.current = true
      finish(next, false)
      return
    }
    // Job-link interviews are budgeted at 20 minutes: when time is up, wrap up after this answer.
    if (isInterviewOverBudget(interviewStartedAtRef.current, Date.now(), budgetMinutesRef.current)) {
      finishingRef.current = true
      finish(next, false)
      return
    }

    lastSpeechAtRef.current = 0
    answerWindowStartedAtRef.current = 0
    timeUpRef.current = false
    setDraft('')
    if (answer) {
      setDeviceError('')
    }

    if (finishingRef.current || stageRef.current !== 'interview') return

      const nextIdx = current + 1
      const preloaded = questions[nextIdx]
      const usePreloaded =
        adaptiveRef.current &&
        isPreloadedInterviewQuestion(preloaded) &&
        !isDeferredAdaptiveQuestion(preloaded)

      if (usePreloaded && typeof navigator !== 'undefined' && navigator.onLine === false) {
        // The next question is already here; the answer is kept and goes with the interview once back online.
        setConnectionNotice(OFFLINE_ANSWER_MESSAGE)
        const onBack = () => {
          window.removeEventListener('online', onBack)
          setConnectionNotice(ANSWER_SAVED_MESSAGE)
          window.setTimeout(() => setConnectionNotice((n) => (n === ANSWER_SAVED_MESSAGE ? '' : n)), 5000)
        }
        window.addEventListener('online', onBack)
      }
      if (usePreloaded) {
        if (finishingRef.current || stageRef.current !== 'interview') return
        if (historyRef.current.length >= totalTurnsRef.current) {
          finishingRef.current = true
          finish(next, false)
          return
        }
        setCurrent(nextIdx)
      } else {
        // Offline: the answer is queued and re-sent when the connection returns (it is never dropped).
        const nextQuestion = await sendWithReconnect(() => fetchNextAdaptiveQuestion({
          sessionId: sessionIdRef.current,
          role,
          level,
          profile: getProfile(),
          jobDescription: customJd,
          explicitRoleTrack:
            roleTrackExplicitRef.current ||
            Boolean(targetJobRaw) ||
            customJd.trim().length >= 40,
          totalTurns: totalTurnsRef.current,
          history: historyRef.current,
          lastQuestion: currentQuestion,
          lastAnswer: answer,
          varietySeed: varietySeedRef.current,
        }), {
          onOffline: () => setConnectionNotice(OFFLINE_ANSWER_MESSAGE),
          onSaved: () => {
            setConnectionNotice(ANSWER_SAVED_MESSAGE)
            window.setTimeout(() => setConnectionNotice((n) => (n === ANSWER_SAVED_MESSAGE ? '' : n)), 5000)
          },
          cancelled: () => finishingRef.current || stageRef.current !== 'interview',
        })
        if (finishingRef.current || stageRef.current !== 'interview') return
        if (historyRef.current.length >= totalTurnsRef.current) {
          finishingRef.current = true
          finish(next, false)
          return
        }
        setQuestions((prev) => {
          const copy = [...prev]
          while (copy.length <= nextIdx) {
            copy.push(nextQuestion)
          }
          copy[nextIdx] = nextQuestion
          return copy
        })
        setCurrent(nextIdx)
      }
    } catch (err) {
      if (finishingRef.current || stageRef.current !== 'interview') return
      if (err instanceof Error && err.message === 'INTERVIEW_COMPLETE') {
        finishingRef.current = true
        finish([...answersRef.current], false)
        return
      }
      setDeviceError('Could not load the next question. Try again or say "end the interview".')
    } finally {
      advancingRef.current = false
      setAdvancing(false)
    }
  }

  submitAnswerRef.current = (reason?: AdvanceReason) => {
    void submitAnswer(reason)
  }

  /**
   * Ends the interview and sends the candidate straight to the completion page. Everything after that — syncing the
   * integrity log, uploading the recording, scoring the answers and saving the report — runs in the background; the
   * completion page waits on the scoring job (see lib/interviewFinishJob).
   */
  function finish(finalAnswers: string[], banned: boolean, banReason?: string) {
    const paired = collectInterviewPairs(questions, finalAnswers, historyRef.current)
    if (!paired.questions.length) {
      finishingRef.current = false
      setDeviceError('No answered questions to score yet. Answer at least one question, or use Leave to exit.')
      return
    }

    stageRef.current = 'analyzing'
    reviewRef.current.finish((Date.now() - interviewStartedAtRef.current) / 1000)
    integrityRef.current.logs = reviewRef.current.events
    if (proctorRef.current && !proctorStoppedRef.current) {
      proctorStoppedRef.current = true
      let sections = proctorRef.current.stop()
      if (!sections.length && reviewRef.current.events.length) {
        sections = reviewEventsToFlagSections(reviewRef.current.events, questions)
      }
      integrityRef.current.flaggedSections = sections.map(({ snapshotDataUrl: _s, snapshotS3Key: _k, ...rest }) => rest)
      proctorRef.current = null
    } else if (!integrityRef.current.flaggedSections?.length && reviewRef.current.events.length) {
      integrityRef.current.flaggedSections = reviewEventsToFlagSections(
        reviewRef.current.events,
        questions,
      )
    }
    setStage('analyzing')
    setIsRecording(false)
    exitInterviewFullscreen()
    if (banned) {
      integrityRef.current.banned = true
      integrityRef.current.banReason =
        banReason ||
        banMessage ||
        integrityRef.current.banReason ||
        'Interview banned: more than one person was detected on camera.'
      integrityRef.current.singlePersonOk = false
    }

    // Snapshot everything the background work needs: this component unmounts as soon as we navigate.
    const sessionId = sessionIdRef.current
    const serverSessionId = isServerInterviewSession(sessionId) ? sessionId : null
    const reviewEvents = [...reviewRef.current.events]
    const integrity = { ...integrityRef.current, logs: reviewEvents }
    const targetJob = activeJobRef.current ?? targetJobRaw
    const scoreProfile = getProfile() ?? profile

    const clipPromise = pendingClipRef.current
      ? Promise.resolve(pendingClipRef.current)
      : recorderRef.current.stop().catch(() => null)

    // Background: integrity log + recording. Never blocks the candidate or the score.
    void (async () => {
      if (serverSessionId) {
        try {
          await saveReviewEvents(serverSessionId, reviewEvents)
        } catch (syncErr) {
          // Review events also ride along on the score payload.
          console.warn('[InterviewPage] final review-event sync failed', syncErr)
        }
      }
      try {
        const clip = await clipPromise
        pendingClipRef.current = clip
        if (!clip || !serverSessionId) return
        const { uploadInterviewRecordingToS3 } = await import('../lib/interviewRecordingUpload')
        const cloud = await uploadInterviewRecordingToS3({
          sessionId: serverSessionId,
          blob: clip.blob,
          durationMs: clip.durationMs,
        })
        if (!cloud.ok && !cloud.skipped) {
          console.warn('[InterviewPage] recording upload failed:', cloud.error)
        }
      } catch (error) {
        console.warn('[InterviewPage] recording upload error', error)
      }
    })()

    // Background: score the answers and save the report. The completion page waits on this job.
    startInterviewFinishJob(
      { role, level, startedAt: new Date(interviewStartedAtRef.current || Date.now()).toISOString() },
      async () => {
        const request = {
          role,
          level,
          questions: paired.questions,
          answers: paired.answers,
          profile: scoreProfile,
          integrity,
        }
        let scored: InterviewResult
        try {
          scored = await scoreInterviewRemote({ ...request, sessionId })
        } catch (scoreErr) {
          console.warn('[InterviewPage] score failed, retrying local score', scoreErr)
          scored = await scoreInterviewRemote({ ...request, sessionId: null })
        }
        scored.sessionId = sessionId || undefined
        scored.integrity = integrity
        saveInterviewResult(stripProctoringForCandidateView(scored))
        if (sessionId) {
          sessionStorage.setItem('hireright.lastInterviewSessionId', sessionId)
        }
        sessionStorage.setItem(PENDING_REPORT_UPLOAD_KEY, '1')
        if (targetJob?.applicationId) {
          attachInterviewToApplicant(targetJob.applicationId, scored)
        }
        if (targetJob && !integrity.banned) {
          try {
            applyToJob({
              title: targetJob.title,
              company: targetJob.company,
              location: 'Remote',
              match: scored.overall,
            })
          } catch {
            // ignore if already applied or score too low
          }
          sessionStorage.removeItem('hireright.targetJob')
          clearPendingJob() // this job's interview is done; the next one is not for it
        }
        try {
          await markCandidateOnboardingCompleteAfterInterview()
        } catch (err) {
          // The completion page retries this before opening the dashboard.
          console.warn('[InterviewPage] onboarding completion sync failed', err)
        }
      },
    )

    // Give the recorder a brief moment to hand over the clip (it needs the camera tracks we stop on unmount),
    // then go straight to the next page.
    void Promise.race([clipPromise, new Promise((resolve) => window.setTimeout(resolve, 1500))]).then(() => {
      finishingRef.current = false
      goToInterviewReportAfterCompletion(navigate)
    })
  }

  function retake() {
    invalidateLobbySessionPrep()
    lobbyVoicePrepRef.current = false
    finishingRef.current = false
    answersRef.current = []
    sessionIdRef.current = null
    varietySeedRef.current = ''
    multiBanRef.current = 0
    setInterviewBanned(false)
    setBanMessage('')
    setIsRecording(false)
    void recorderRef.current.stop()
    if (recordingBlobUrlRef.current) {
      URL.revokeObjectURL(recordingBlobUrlRef.current)
      recordingBlobUrlRef.current = null
    }
    setRecordingUrl(null)
    stopAllSpeech()
    setQuestions([])
    setCurrent(0)
    setDraft('')
    setResult(null)
    setSecondsLeft(QUESTION_SECONDS)
    setChecklist([false])
    setDeviceError('')
    setSkipCamera(false)
    setStage('setup')
    if (streamRef.current) {
      setStreamReady(true)
      window.setTimeout(() => attachStream(lobbyVideoRef.current), 50)
    }
  }

  const timeLabel = useMemo(() => {
    const m = Math.floor(secondsLeft / 60)
    const s = secondsLeft % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }, [secondsLeft])

  const faceBlocks =
    stage === 'setup' && !skipCamera &&
    (faceStatus.severity === 'block' ||
      faceStatus.severity === 'ban' ||
      faceStatus.issue === 'multi_person' ||
      (faceStatus.issue === 'looking_away' && Math.abs(faceStatus.yaw) >= 0.48))
  const faceWarnOnly =
    !skipCamera && faceStatus.severity === 'warn' && !faceBlocks
  const scheduleAllowsStart =
    !scheduledInviteAccess || scheduledInviteAccess.canStart
  const canStart =
    recordingConsent &&
    checklist.every(Boolean) &&
    !starting &&
    scheduleAllowsStart &&
    (skipCamera || (streamReady && !faceBlocks && faceStatus.faceCount === 1))
  const closingTurn = stage === 'interview' && isClosingStatement(question)
  const callStatus = closingTurn
    ? 'Ava is wrapping up the interview — no answer needed'
    : endingCountdown
    ? ENDING_COUNTDOWN_LABEL
    : advancing
    ? 'Moving to your next question…'
    : sttPhase === 'capturing'
      ? 'Recording your answer…'
      : sttPhase === 'transcribing'
        ? 'Transcribing your answer…'
        : aiSpeaking
          ? 'Ava is speaking — wait for the full question, or speak clearly to interrupt'
          : listening
            ? 'Listening — pause when you are done, or say “next question” to skip'
            : 'Live call with Ava'

  const canSubmit =
    !closingTurn &&
    draft.trim().length >= 1 &&
    !aiSpeaking &&
    !faceBlocks &&
    !interviewBanned &&
    !advancing
  return (
    <main className={`${styles.page} ${stage === 'interview' ? styles.pageLocked : ''}`}>
      {stage === 'interview' ? (
        <>
          {guardNotice ? (
            <div className={styles.guardNotice} role="status">
              {guardNotice}
            </div>
          ) : null}
        </>
      ) : null}
      <header className={styles.appBar}>
        <div className={styles.appBrand}>
          <BrandLogo size="md" />
        </div>

        {stage === 'interview' && question ? (
          <div className={styles.appMeta}>
            <span className={styles.livePill} title="Fullscreen and focus are monitored">
              Locked room
            </span>
            {!skipCamera && (
              <span
                className={`${styles.faceBadgeInline} ${
                  faceStatus.severity === 'ok'
                    ? styles.faceOk
                    : faceStatus.severity === 'warn'
                      ? styles.faceWarn
                      : styles.faceBlock
                }`}
              >
                {faceStatus.label}
              </span>
            )}
            {closingTurn ? null : (
              <span className={secondsLeft < 30 ? styles.timerLow : styles.timer}>
                {timeLabel}
              </span>
            )}
          </div>
        ) : stage === 'analyzing' ? (
          <div className={styles.appMeta}>
            <span className={styles.livePill}>Wrapping up</span>
          </div>
        ) : (
          <button
            type="button"
            className={styles.exitLink}
            onClick={() => leaveInterviewRoom(navigate)}
          >
            Exit
          </button>
        )}
      </header>

      {reviewSyncError && !connectionNotice && <p role="alert" className="ds-alert ds-alert--warning">{reviewSyncError}</p>}
      {connectionNotice && stage === 'interview' && (
        <p role="status" aria-live="polite" className="ds-alert ds-alert--warning">
          {connectionNotice}
        </p>
      )}
      <AnimatePresence mode="wait">
        {stage === 'setup' && (
          <motion.section
            key="setup"
            className={styles.lobby}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: easeOut }}
          >
            <div className={styles.lobbyHero}>
              <p className={styles.eyebrow}>Waiting room</p>
              <h1>
                Hi {firstName}, meet your interviewer <em>Ava</em>
              </h1>
              <p className={styles.sub}>
                A live voice call. Speak naturally — Ava stops when you talk, and the next question starts when you
                pause.
              </p>
            </div>

            <div className={styles.lobbyGrid}>
              <div className={styles.previewCard}>
                <div className={styles.previewFrame}>
                  {streamReady && camOn ? (
                    <video
                      ref={bindLobbyVideo}
                      className={styles.previewVideo}
                      autoPlay
                      muted
                      playsInline
                    />
                  ) : (
                    <div className={styles.previewEmpty}>
                      <div className={styles.emptyOrb}>You</div>
                      <p>Turn on your camera to see how you&apos;ll appear</p>
                    </div>
                  )}
                  <div className={styles.previewOverlay}>
                    <span className={styles.youChip}>{name === 'there' ? 'You' : name}</span>
                    {streamReady && <span className={styles.liveBadge}>Camera live</span>}
                  </div>
                </div>

                <div className={styles.deviceStrip}>
                  <span className={streamReady && camOn ? styles.ok : styles.off}>
                    Camera
                  </span>
                  <span className={streamReady && micOn ? styles.ok : styles.off}>Mic</span>
                  <span className={speechSupported || moonshineSttLoading ? styles.ok : styles.warn}>
                    {speechSupported || moonshineSttLoading ? 'Voice answers' : 'Typed answers'}
                  </span>
                  <span className={ttsSupported ? styles.ok : styles.warn}>Ava&apos;s voice</span>
                </div>

                <div className={styles.lobbyActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => void enableDevices()}
                    disabled={mediaBusy}
                  >
                    {mediaBusy ? 'Connecting…' : streamReady ? 'Recheck devices' : 'Allow camera & mic'}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => {
                      setSkipCamera((prev) => !prev)
                      setDeviceError('')
                    }}
                  >
                    {skipCamera ? 'Use camera check' : 'Continue without camera'}
                  </button>
                </div>
                <p className={styles.joinHint}>
                  {skipCamera
                    ? 'Without the camera check, your interview may be flagged for the recruiter to review.'
                    : 'Your camera stays on for the whole interview.'}
                </p>
                {lobbyNotice && !deviceError && (
                  <p className={styles.joinHint} role="status">
                    {lobbyNotice}
                  </p>
                )}
                {deviceError && (
                  <p className={styles.deviceError} role="alert">
                    {deviceError}
                    {startRetryable && !retakePaymentRequired && !starting && canStart ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className={styles.textBtn}
                          onClick={() => {
                            setStartRetryable(false)
                            void joinInterviewRoom()
                          }}
                        >
                          Retry
                        </button>
                      </>
                    ) : null}
                    {retakePaymentRequired ? (
                      <>
                        {' '}
                        <Link to="/pricing/retake">See retake options</Link>
                      </>
                    ) : null}
                  </p>
                )}
                {!skipCamera && (
                  <div
                    className={`${styles.faceBadge} ${
                      faceStatus.severity === 'ok'
                        ? styles.faceOk
                        : faceStatus.severity === 'warn'
                          ? styles.faceWarn
                          : styles.faceBlock
                    }`}
                    role="status"
                  >
                    <span className={styles.faceDot} aria-hidden="true" />
                    {faceStatus.label}
                  </div>
                )}
              </div>

              <div className={styles.lobbySide}>
                {targetJobRaw && (
                  <div className={styles.jobCard}>
                    <div className={styles.autoConfigBanner}>
                      <div className={styles.autoConfigLeft}>
                        <span className={styles.autoConfigIcon}>
                          <HrIcon name="target" size={20} />
                        </span>
                        <div className={styles.autoConfigCopy}>
                          <span className={styles.autoConfigEyebrow}>Interview for this job</span>
                          <strong className={styles.autoConfigTitle}>{targetJobRaw.title}</strong>
                          <p className={styles.autoConfigMeta}>
                            {targetJobRaw.company}
                            {targetJobRaw.role ? ` · ${targetJobRaw.role}` : ''}
                          </p>
                          {waitingRoomJobExperience(targetJobRaw.level, profile?.totalExperience) ? (
                            <span className="ds-pill ds-pill--neutral" data-testid="job-experience">
                              {waitingRoomJobExperience(targetJobRaw.level, profile?.totalExperience)}
                            </span>
                          ) : null}
                          <p className={styles.autoConfigBlurb}>
                            About{' '}
                            {interviewDurationMinutes(
                              targetJobRaw,
                              null,
                              Boolean(readStoredInterviewInvite()?.token),
                            )}{' '}
                            minutes · tailored questions from this role and your profile
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.jobDetailsToggle}
                        aria-expanded={jobDetailsOpen}
                        aria-controls="interview-job-details"
                        onClick={() => setJobDetailsOpen((open) => !open)}
                      >
                        {jobDetailsOpen ? 'Hide job details' : 'View job details'}
                      </button>
                    </div>
                    {jobDetailsOpen ? (
                      <div id="interview-job-details" className={styles.jobDetailsPanel}>
                        <dl className={styles.jobDetailsStats}>
                          {targetJobRaw.atsScore != null ? (
                            <div>
                              <dt>ATS fit</dt>
                              <dd>{Math.round(targetJobRaw.atsScore)}%</dd>
                            </div>
                          ) : null}
                          {targetJobRaw.jdMatchScore != null ? (
                            <div>
                              <dt>JD match</dt>
                              <dd>{Math.round(targetJobRaw.jdMatchScore)}%</dd>
                            </div>
                          ) : null}
                        </dl>
                        {targetJobRaw.primarySkills && targetJobRaw.primarySkills.length > 0 ? (
                          <div className={styles.jobSkills}>
                            <p className={styles.jobSkillsLabel}>Skills we may ask about</p>
                            <ul>
                              {targetJobRaw.primarySkills.map((skill) => (
                                <li key={skill}>{skill}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {targetJobRaw.jd?.trim() ? (
                          <div className={styles.jobDescription}>
                            <p className={styles.jobSkillsLabel}>Job description</p>
                            <div
                              className={styles.jobDescriptionBody}
                              tabIndex={0}
                              role="region"
                              aria-label="Job description"
                            >
                              {targetJobRaw.jd.trim()}
                            </div>
                          </div>
                        ) : (
                          <p className={styles.jobDescriptionEmpty}>
                            Full description wasn&apos;t saved with this application. Questions still follow the role
                            and company you applied for.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}

                <div className={styles.tips}>
                  <h2>Before you join</h2>
                  <ul>
                    {LOBBY_TIPS.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>

                <div className={styles.checkList}>
                  <label className={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={checklist[0]}
                      onChange={(e) => setChecklist([e.target.checked])}
                    />
                    <span>I&apos;m alone in a quiet place and I&apos;ll stay in fullscreen until I finish.</span>
                  </label>
                </div>

                <motion.button
                  type="button"
                  className={styles.joinBtn}
                  onClick={() => void joinInterviewRoom()}
                  disabled={!canStart}
                  aria-busy={starting}
                >
                  {lobbyEnterButtonLabel({ starting })}
                </motion.button>
                {startingSlow && (
                  <p className={styles.joinHint} role="status" aria-live="polite">
                    {PREPARING_QUESTIONS_MESSAGE}
                  </p>
                )}
                {savedReport && !starting && (
                  <button
                    type="button"
                    id="view-saved-report-btn"
                    className={styles.savedReportBtn}
                    onClick={() => navigate('/dashboard/report')}
                  >
                    <HrIcon name="chart" size={18} /> View your last report
                  </button>
                )}
                {!canStart && !starting && (
                  <p className={styles.joinHint}>
                    {scheduledInviteAccess?.status === 'too_early'
                      ? `Your interview is booked for ${
                          slotStoredInvite?.scheduledStart
                            ? new Date(slotStoredInvite.scheduledStart).toLocaleString(undefined, {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                                hour: 'numeric',
                                minute: '2-digit',
                              })
                            : 'your scheduled time'
                        }. It opens in ${formatSlotCountdown(slotMsLeft ?? 0)}.`
                      : scheduledInviteAccess?.status === 'expired'
                        ? 'Your interview window has ended. Ask your recruiter for a new invite link.'
                        : faceBlocks
                          ? faceStatus.issue === 'multi_person'
                            ? 'Only you should be on camera.'
                            : faceStatus.issue === 'looking_away'
                              ? 'Face the camera to join.'
                              : 'Sit in front of the camera so we can see your face.'
                          : !streamReady
                            ? 'Allow your camera and microphone to join.'
                            : !skipCamera && faceStatus.faceCount !== 1
                              ? 'Sit in front of the camera so we can see your face.'
                              : 'Tick the box above to join.'}
                  </p>
                )}
              </div>
            </div>
          </motion.section>
        )}

        {stage === 'interview' && question && (
          <motion.section
            key="call"
            className={styles.call}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {(faceBlocks || faceWarnOnly || interviewBanned) && (
              <div
                className={`${styles.proctorBanner} ${
                  faceStatus.severity === 'ban' ||
                  faceStatus.issue === 'multi_person' ||
                  interviewBanned
                    ? styles.proctorBan
                    : faceStatus.severity === 'block'
                      ? styles.proctorBlock
                      : styles.proctorWarn
                }`}
                role="alert"
              >
                <strong>
                  {interviewBanned
                    ? 'Interview banned'
                    : faceStatus.issue === 'multi_person'
                      ? 'Multiple people detected'
                      : faceStatus.issue === 'looking_away'
                        ? 'Look at the camera'
                        : faceStatus.issue === 'too_far'
                          ? 'Move closer'
                          : faceStatus.issue === 'no_face'
                            ? 'Face not detected'
                            : 'Camera check'}
                </strong>
                <span>{interviewBanned ? banMessage : faceStatus.label}</span>
              </div>
            )}

            <div className={styles.callStage}>
              {(webSpeechFallback || sttStatus === 'error') && (
                <div className={styles.moonshineSttPill} aria-live="polite">
                  {webSpeechFallback && webSpeechSupported
                    ? 'Using browser speech for captions.'
                    : 'Voice model unavailable — using browser speech.'}
                </div>
              )}

              {/* Main: your webcam (recorded live) */}
              <div className={`${styles.mainTile} ${styles.youMain}`}>
                {streamReady && camOn ? (
                  <video
                    ref={bindRoomVideo}
                    className={styles.youVideo}
                    autoPlay
                    muted
                    playsInline
                  />
                ) : (
                  <div className={styles.youFallback}>
                    <span>{name.slice(0, 1).toUpperCase()}</span>
                    <p>Camera off — turn it on to continue</p>
                  </div>
                )}

                <div className={styles.qProgress}>
                  <div className={styles.progressTrack}>
                    <motion.div
                      className={styles.progressFill}
                      animate={{
                        width: `${Math.min(100, ((current + 1) / Math.max(questions.length, current + 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>
                    {closingTurn ? (
                      'Closing message'
                    ) : (
                      <>
                        Question {current + 1}
                        {adaptiveRef.current ? '' : ` of ${questions.length}`}
                        {question.topic || question.category ? ` · ${question.topic || question.category}` : ''}
                      </>
                    )}
                  </span>
                </div>

                <div className={styles.ccBox}>
                  <p>{question.text}</p>
                  {noAnswerNotice && (
                    <p className={styles.noAnswerNotice} role="status" aria-live="polite">
                      {noAnswerNotice}
                    </p>
                  )}
                </div>

                <div className={styles.youLabel}>
                  <span>You · live</span>
                  {sttPhase === 'capturing' && <em className={styles.sttRecEm}>Recording</em>}
                  {sttPhase === 'transcribing' && <em>Transcribing</em>}
                  {listening && sttPhase === 'idle' && draft.trim() && <em>On mic</em>}
                  {isRecording && <em className={styles.recEm}>REC</em>}
                </div>
              </div>

              {/* PiP: Ava */}
              <div className={`${styles.pip} ${aiSpeaking ? styles.speakingTile : ''}`}>
                <div className={styles.avaPipInner}>
                  <div className={styles.avaFaceLg}>
                    <span className={styles.avaEye} />
                    <span className={styles.avaEye} />
                    <motion.span
                      className={styles.avaMouth}
                      animate={
                        aiSpeaking
                          ? { scaleY: [1, 1.6, 0.8, 1.4, 1], opacity: 1 }
                          : { scaleY: 1, opacity: 0.85 }
                      }
                      transition={
                        aiSpeaking
                          ? { duration: 0.45, repeat: Infinity }
                          : { duration: 0.2 }
                      }
                    />
                  </div>
                  <div className={styles.pipLabel}>
                    <span>Ava</span>
                    <em>
                      {aiSpeaking ? 'Speaking' : listening ? 'Listening' : advancing ? 'Next Q' : 'On call'}
                    </em>
                  </div>
                  <Waveform active={aiSpeaking || listening} />
                </div>
              </div>
            </div>

            <footer className={styles.dock}>
              {!closingTurn && (showTypeFallback || !speechSupported) && (
                <textarea
                  className={styles.typeFallback}
                  value={draft}
                  rows={3}
                  placeholder="Type your answer…"
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
              {speechSupported && !closingTurn && (
                <button
                  type="button"
                  className={styles.textBtn}
                  onClick={() => setShowTypeFallback((v) => !v)}
                >
                  {showTypeFallback ? 'Hide keyboard' : 'Use keyboard'}
                </button>
              )}
              <div className={styles.dockCluster}>
                <button
                  type="button"
                  className={`${styles.roundBtn} ${!micOn ? styles.roundOff : ''}`}
                  onClick={toggleMic}
                  aria-label={micOn ? 'Mute' : 'Unmute'}
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    {micOn ? (
                      <>
                        <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M6 11a6 6 0 0 0 12 0M12 17v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </>
                    ) : (
                      <>
                        <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M9 9V8a3 3 0 0 1 5.2-2" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M15 11v1a3 3 0 0 1-5.2 2M6 11a6 6 0 0 0 8 5.3M12 17v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </>
                    )}
                  </svg>
                  <span>{micOn ? 'Mute' : 'Unmute'}</span>
                </button>
                <button
                  type="button"
                  className={`${styles.roundBtn} ${!camOn ? styles.roundOff : ''}`}
                  onClick={toggleCamera}
                  disabled={!streamReady}
                  aria-label={camOn ? 'Stop camera' : 'Start camera'}
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="7" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M15 10l5-2.5v9L15 14v-4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                  <span>{camOn ? 'Camera' : 'Cam off'}</span>
                </button>
                {speechSupported && (
                  <button
                    type="button"
                    className={`${styles.roundBtn} ${listening ? styles.roundLive : ''}`}
                    onClick={() => (listening ? stopListening() : startListening())}
                    disabled={!micOn}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="12" r="3" fill="currentColor" />
                    </svg>
                    <span>{listening ? 'Listening' : 'Listen'}</span>
                  </button>
                )}
              </div>

              <div className={styles.callStatus} aria-live="polite" data-testid="call-status">
                {callStatus}
              </div>

              {saveFailedNotice ? (
                <p className="ds-alert ds-alert--warning" role="alert" data-testid="save-failed">
                  {saveFailedNotice}{' '}
                  <button
                    type="button"
                    className={styles.textBtn}
                    onClick={() => submitAnswerRef.current(lastAdvanceReasonRef.current)}
                    disabled={advancing}
                  >
                    Retry
                  </button>
                </p>
              ) : null}

              <motion.button
                type="button"
                className={styles.nextBtnSecondary}
                onClick={() => submitAnswer('submit')}
                disabled={!canSubmit}
              >
                {faceBlocks ? 'Fix face check' : 'Submit answer now'}
              </motion.button>

              {closingTurn ? null : (
                <button
                  type="button"
                  className={styles.textBtn}
                  onClick={skipQuestion}
                  disabled={advancing || interviewBanned}
                  data-testid="skip-question"
                >
                  Skip question
                </button>
              )}

              <button type="button" className={styles.endBtn} onClick={endInterviewEarly}>
                Leave
              </button>
            </footer>
          </motion.section>
        )}

        {/* stage === 'analyzing' renders nothing: finish() hands off to /interview/complete within ~1.5s and the
            scoring, recording upload and report work continue in the background. */}

        {stage === 'results' && result && (
          <motion.section
            key="results"
            className={styles.results}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: easeOut }}
          >
            {/* 360° AI Persona & Career Intelligence Dashboard */}
            <CareerIntelligenceDashboard
              result={result}
              candidateName={candidateDisplayName}
              candidateRole={role}
              candidateExperience={level}
              skills={profileSkills.length > 0 ? profileSkills : ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'AWS', 'REST APIs', 'System Design']}
              interviewSessionId={
                result.sessionId ||
                sessionIdRef.current ||
                (typeof sessionStorage !== 'undefined'
                  ? sessionStorage.getItem('hireright.lastInterviewSessionId')
                  : null)
              }
              localPreviewUrl={recordingUrl}
              onRetake={retake}
              onContinue={() => goToCandidateDashboardAfterInterview(navigate)}
            />


          </motion.section>
        )}
      </AnimatePresence>
    </main>
  )
}
