import { attachInterviewContentGuard, looksLikeVirtualCamera, type ContentGuardEvent } from '../lib/interviewContentGuard'
import { ReviewEventTracker, saveReviewEvents } from '../lib/interviewReview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  mergeRecognitionResults,
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
  processInterviewTurn,
  scoreInterviewRemote,
  startInterviewSession,
  type IntegritySnapshot,
} from '../lib/interviewAgentClient'
import { buildInterviewConsent, type InterviewConsent } from '../lib/interviewConsent'
import { InterviewRecorder } from '../lib/interviewRecorder'
import {
  inviteAccessFromStored,
  isImmediateInterviewAllowed,
  readInviteInterviewContext,
  readStoredInterviewInvite,
} from '../lib/interviewInviteGate'
import {
  applyToJob,
  attachInterviewToApplicant,
  candidateFullName,
  getUser,
  resolveCandidateName,

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
import { HrIcon } from '../components/HrIcon'
import { BrandLogo } from '../components/BrandLogo'
import { easeOut } from '../motion/variants'
import styles from './InterviewPage.module.css'
import { answerDoneCommand, silenceAdvanceMs, stripAnswerDoneCommand } from '../lib/answerTiming'

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
/** Silence before an answer counts as finished: answerTiming.silenceAdvanceMs (2.8-5 s by answer length). */
/** Longest the next question waits for Ava's bridge sentence to finish (a stuck audio callback never blocks). */
const BRIDGE_MAX_WAIT_MS = 9000
/** If the candidate never speaks after Ava finishes the question, advance silently (no UI). */
const NO_ANSWER_SKIP_MS = 10_000
const MIN_ANSWER_CHARS = 10

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

export function InterviewPage() {
  const navigate = useNavigate()
  const profile = useMemo(() => getProfile(), [])
  const profileSkills = profile?.skills ?? []

  const targetJobRaw = useMemo(() => {
    const str = sessionStorage.getItem('hireright.targetJob')
    if (!str) return null
    try {
      return JSON.parse(str) as {
        title: string
        company: string
        role: string
        level: string
        jd?: string
        jobId?: string
        applicationId?: string
        organizationId?: string
        primarySkills?: string[]
        atsScore?: number
        jdMatchScore?: number
      }
    } catch {
      return null
    }
  }, [])

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
  const [advancing, setAdvancing] = useState(false)
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [streamReady, setStreamReady] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [skipCamera, setSkipCamera] = useState(false)
  const [showTypeFallback, setShowTypeFallback] = useState(false)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [checklist, setChecklist] = useState([false])
  const interviewLockRequireFullscreenRef = useRef(false)
  const roomGuardDetachRef = useRef<(() => void) | null>(null)
  const [starting, setStarting] = useState(false)
  /** What "Enter interview room" is waiting on (null when not joining). */
  const [joinProgress, setJoinProgress] = useState<{
    questions: 'pending' | 'done'
    voice: 'pending' | 'done' | 'fallback'
  } | null>(null)
  const [sttPhase, setSttPhase] = useState<'idle' | 'capturing' | 'transcribing'>('idle')
  const sttPhaseRef = useRef(sttPhase)
  const [scheduleClock, setScheduleClock] = useState(() => Date.now())

  useEffect(() => {
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

  useEffect(() => {
    // Only a scheduled invite needs a live clock (countdown to the slot); otherwise don't re-render every second.
    if (isImmediateInterviewAllowed() || !readStoredInterviewInvite()) return
    const id = window.setInterval(() => setScheduleClock(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const scheduledInviteAccess = useMemo(() => {
    if (isImmediateInterviewAllowed()) return null
    return inviteAccessFromStored(readStoredInterviewInvite(), scheduleClock)
  }, [scheduleClock])
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
  // Nothing is recorded (and the camera is not opened) until the candidate agrees in the waiting room.
  // The consent screen was removed: candidates go straight to the camera check. The server still requires a
  // consent object to start a session, so one is supplied automatically. The version tag marks these records as
  // "not prompted" so they cannot be mistaken for an explicit acceptance of the consent wording.
  const [interviewConsent] = useState<InterviewConsent | null>(() => ({
    ...buildInterviewConsent(),
    version: 'no-prompt',
  }))
  const recordingConsent = interviewConsent !== null
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
  const bridgeRef = useRef('')
  /** Ava's bridge sentence, already playing while the next question is fetched (resolves when it ends). */
  const bridgePlaybackRef = useRef<Promise<void> | null>(null)
  const bridgeSpeakingRef = useRef(false)
  const advancingRef = useRef(false)
  const adaptiveRef = useRef(true)
  const interviewStartedAtRef = useRef<number>(0)
  const historyRef = useRef<{ question: Question; answer: string }[]>([])
  const lastSpeechAtRef = useRef(0)
  const answerWindowStartedAtRef = useRef(0)
  const noAnswerSkipTriggeredRef = useRef(false)
  const aiSpeakingRef = useRef(false)
  const listeningRef = useRef(false)
  const submitAnswerRef = useRef<() => void>(() => {})
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

  const applyTranscriptSegmentRef = useRef<(text: string) => void>(() => {})

  applyTranscriptSegmentRef.current = (raw: string) => {
    const segment = raw.trim()
    if (!segment) return

    if (aiSpeakingRef.current) {
      const words = segment.split(/\s+/).filter(Boolean)
      if (words.length >= 2) {
        handleBargeIn()
        const base = transcriptCommittedRef.current.trim()
        const line = base ? `${base} ${segment}` : segment
        transcriptCommittedRef.current = line
        setDraft(line)
        draftRef.current = line
        lastSpeechAtRef.current = Date.now()
      }
      return
    }

    const base = transcriptCommittedRef.current.trim()
    const line = base ? `${base} ${segment}` : segment
    transcriptCommittedRef.current = line
    setDraft(line)
    draftRef.current = line
    lastSpeechAtRef.current = Date.now()
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
      onSpeechCaptureStart: () => setSttPhase('capturing'),
      onTranscribing: (active) => setSttPhase(active ? 'transcribing' : 'idle'),
      onSegmentText: (text) => applyTranscriptSegmentRef.current(text),
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
          if (listeningRef.current && micOnRef.current && !aiSpeakingRef.current) {
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
        reviewRef.current.sample(status, Math.max(0, (Date.now() - interviewStartedAtRef.current) / 1000))
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
    setSttPhase('idle')
  }

  function stopAllSpeech() {
    speakGenRef.current += 1
    listenAfterTtsRef.current = false
    cancelSpeech()
    setAiSpeaking(false)
    aiSpeakingRef.current = false
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
    else if (stage === 'interview' && !aiSpeaking && speechSupported) {
      startListening()
    }
  }

  function handleBargeIn() {
    if (!aiSpeakingRef.current) return
    const now = Date.now()
    if (now - bargeCooldownRef.current < 400) return
    bargeCooldownRef.current = now
    speakGenRef.current += 1
    cancelSpeech()
    setAiSpeaking(false)
    aiSpeakingRef.current = false
    listenAfterTtsRef.current = true
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
      const merged = mergeRecognitionResults(event, transcriptCommittedRef.current)
      transcriptCommittedRef.current = merged.committed

      if (aiSpeakingRef.current) {
        if (merged.bargeIn) {
          handleBargeIn()
          const line = merged.committed.trim()
          if (line) {
            setDraft(line)
            draftRef.current = line
            lastSpeechAtRef.current = Date.now()
          }
        }
        return
      }

      const display = merged.interim
        ? `${merged.committed} ${merged.interim}`.trim()
        : merged.committed.trim()
      if (display) {
        setDraft(display)
        draftRef.current = display
      }
      if (merged.interim?.trim()) setSttPhase('capturing')
      if (merged.hadFinal) setSttPhase('idle')
      if (merged.hadFinal || (merged.interim && merged.interim.length >= 12)) {
        lastSpeechAtRef.current = Date.now()
      }
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => {
      setListening(false)
      listeningRef.current = false
      if (
        listenAfterTtsRef.current &&
        !aiSpeakingRef.current &&
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
    if (aiSpeakingRef.current) return
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
    if (aiSpeakingRef.current || recognitionRef.current) return
    if (!shouldUseMoonshineVad()) return
    stopListening()
    startListening()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, moonshineSttReady, moonshineVadReady])
  useEffect(() => {
    if (stage !== 'interview' || !question) return

    const gen = ++speakGenRef.current
    listenAfterTtsRef.current = false
    stopListening()
    lastSpeechAtRef.current = 0
    answerWindowStartedAtRef.current = 0
    noAnswerSkipTriggeredRef.current = false
    setDraft('')
    draftRef.current = ''
    baseDraftRef.current = ''
    transcriptCommittedRef.current = ''
    setSttPhase('idle')
    setAiSpeaking(true)
    aiSpeakingRef.current = true

    const bridge = bridgeRef.current
    if (bridge) bridgeRef.current = ''

    const intro =
      bridge ||
      (current === 0
        ? `Hello ${firstName}. I am Ava, your interviewer. I will ask clear questions about your ${role} background. Please listen fully, then answer in your own words. `
        : '')

    const spoken = bridge ? `${bridge} ${question.text}` : `${intro}${question.text}`

    const speakQuestion = () => speakText(spoken, {
      onStart: () => {
        if (gen === speakGenRef.current) {
          setAiSpeaking(true)
          aiSpeakingRef.current = true
        }
      },
      onEnd: () => {
        if (gen !== speakGenRef.current) return
        setAiSpeaking(false)
        aiSpeakingRef.current = false
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
        setAiSpeaking(false)
        aiSpeakingRef.current = false
        listenAfterTtsRef.current = true
        answerWindowStartedAtRef.current = Date.now()
        if (stageRef.current === 'interview' && micOnRef.current) startListening()
      },
    })

    // The bridge ("Thanks Bharath, let's go deeper...") started while this question was being fetched: let it
    // finish, then ask the question, so the candidate hears Ava straight away instead of silence.
    const playing = bridgePlaybackRef.current
    bridgePlaybackRef.current = null
    if (playing) {
      void Promise.race([playing, new Promise<void>((r) => window.setTimeout(r, BRIDGE_MAX_WAIT_MS))]).then(() => {
        if (gen === speakGenRef.current) speakQuestion()
      })
    } else {
      speakQuestion()
    }

    return () => {
      speakGenRef.current += 1
      if (!bridgeSpeakingRef.current) cancelSpeech() // never cut off a bridge that is playing for the next question
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
        interviewBanned
      ) {
        return
      }
      const text = draftRef.current.trim()
      const phase = sttPhaseRef.current
      if (text && answerDoneCommand(text) !== null) {
        submitAnswerRef.current() // "...next question": move on now, no silence wait
        return
      }
      if (text.length >= MIN_ANSWER_CHARS) {
        const last = lastSpeechAtRef.current
        if (!last) return
        if (Date.now() - last < silenceAdvanceMs(text)) return
        submitAnswerRef.current()
        return
      }
      if (text.length > 0 || phase === 'capturing' || phase === 'transcribing') {
        return
      }
      const windowStart = answerWindowStartedAtRef.current
      if (!windowStart || noAnswerSkipTriggeredRef.current) return
      if (Date.now() - windowStart < NO_ANSWER_SKIP_MS) return
      noAnswerSkipTriggeredRef.current = true
      submitAnswerRef.current()
    }, 400)
    return () => window.clearInterval(id)
  }, [stage, current, interviewBanned])

  useEffect(() => {
    if (stage !== 'interview') return
    setSecondsLeft(QUESTION_SECONDS)
    let alive = true
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id)
          if (alive) window.setTimeout(() => submitAnswer(), 0)
          return 0
        }
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
        .catch(e => setReviewSyncError(e.message))
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
    }
    stopAllSpeech()
    const voiceAlreadyReady =
      webSpeechFallbackRef.current || isLobbyLocalSttReady(lobbySttSnapshotRef.current)
    setJoinProgress({ questions: 'pending', voice: voiceAlreadyReady ? 'done' : 'pending' })
    try {
      const freshProfile = getProfile()
      const inviteCtx = readInviteInterviewContext()
      const baseProfile = freshProfile ?? profile
      const mergedProfile =
        baseProfile && inviteCtx?.resumeText?.trim()
          ? { ...baseProfile, resumeText: inviteCtx.resumeText }
          : baseProfile
      if (mergedProfile) {
        setCandidateDisplayName(resolveCandidateName(mergedProfile, getUser()) || candidateDisplayName)
      }
      historyRef.current = []
      interviewStartedAtRef.current = Date.now()
      const effectiveJd =
        inviteCtx?.jobDescription?.trim() ||
        customJd.trim() ||
        targetJobRaw?.jd?.trim() ||
        ''
      const explicitTrack =
        roleTrackExplicitRef.current ||
        Boolean(targetJobRaw) ||
        effectiveJd.length >= 40
      // The session request and the on-device voice model run in parallel; the voice wait is capped and falls back
      // to the browser's own speech recognition, so joining never hangs on a slow model download.
      const voicePromise = prepareVoiceForRoom().then((outcome) => {
        setJoinProgress((p) => (p ? { ...p, voice: outcome } : p))
        return outcome
      })
      const startPromise = startInterviewSession(role, level, mergedProfile, {
        jobDescription: effectiveJd,
        explicitRoleTrack: explicitTrack,
        jobId: targetJobRaw?.jobId,
        applicationId: targetJobRaw?.applicationId,
        organizationId: targetJobRaw?.organizationId,
        questionMode:
          targetJobRaw?.applicationId || targetJobRaw?.jobId
            ? undefined
            : targetJobRaw || effectiveJd.length >= 40
              ? 'individual_jd'
              : undefined,
        primarySkills: targetJobRaw?.primarySkills,
        atsScore: targetJobRaw?.atsScore,
        jdMatchScore: targetJobRaw?.jdMatchScore,
        consent: interviewConsent ?? undefined,
      })
      void startPromise.then(
        () => setJoinProgress((p) => (p ? { ...p, questions: 'done' } : p)),
        () => undefined,
      )
      const [started, voice] = await Promise.all([startPromise, voicePromise])
      adaptiveRef.current = started.adaptive !== false
      sessionIdRef.current = started.sessionId
      varietySeedRef.current = started.varietySeed || varietySeedRef.current
      totalTurnsRef.current = Math.max(
        started.total || 0,
        started.questions?.length || 0,
        MAX_ADAPTIVE_QUESTIONS,
      )
      setQuestions(started.questions)
      setCurrent(0)
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
      setDeviceError(err instanceof Error ? err.message : 'We couldn’t start your interview. Please try again.')
    } finally {
      setStarting(false)
      setJoinProgress(null)
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

  async function submitAnswer() {
    if (finishingRef.current || stage !== 'interview' || questions.length === 0) {
      return
    }
    if (interviewBanned || advancingRef.current) return
    listenAfterTtsRef.current = false
    stopAllSpeech()

    const answer = stripAnswerDoneCommand(draftRef.current)
    const next = [...answersRef.current]
    next[current] = answer
    answersRef.current = next

    const answeredCount = next.filter((a) => a && a.trim()).length
    if (isEndInterviewCommand(answer)) {
      if (answeredCount < 1 && current === 0 && !answer.replace(/end|stop|finish|done/gi, '').trim()) {
        setDeviceError('Share at least one answer first, then say "end the interview".')
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

    if (
      adaptiveRef.current &&
      historyRef.current.length >= totalTurnsRef.current
    ) {
      finishingRef.current = true
      finish(next, false)
      return
    }

    advancingRef.current = true
    setAdvancing(true)
    lastSpeechAtRef.current = 0
    answerWindowStartedAtRef.current = 0
    setDraft('')
    if (answer) {
      setDeviceError('')
    }

    try {
      const turn = await processInterviewTurn({
        sessionId: sessionIdRef.current,
        role,
        level,
        question: currentQuestion,
        answer,
        questionIndex: current,
        totalQuestions: Math.max(questions.length, current + 2),
        profile: getProfile(),
      })
      bridgeRef.current = turn.spoken?.trim() ? `${turn.spoken.trim()} ` : ''
    } catch {
      bridgeRef.current = `Thanks ${firstName}. Let's continue. `
    }

    if (finishingRef.current || stageRef.current !== 'interview') return

    try {
      const nextIdx = current + 1
      const preloaded = questions[nextIdx]
      const usePreloaded =
        adaptiveRef.current &&
        isPreloadedInterviewQuestion(preloaded) &&
        !isDeferredAdaptiveQuestion(preloaded)

      if (!usePreloaded && bridgeRef.current.trim()) {
        // The next question has to be generated (a few seconds): say the bridge now, while it loads.
        const bridgeText = bridgeRef.current
        bridgeRef.current = ''
        bridgeSpeakingRef.current = true
        setAiSpeaking(true)
        aiSpeakingRef.current = true
        bridgePlaybackRef.current = new Promise<void>((resolve) => {
          const done = () => {
            bridgeSpeakingRef.current = false
            resolve()
          }
          speakText(bridgeText, { onEnd: done, onError: done })
        })
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
        const nextQuestion = await fetchNextAdaptiveQuestion({
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
        finish(next, false)
        return
      }
      setDeviceError('Could not load the next question. Try again or say "end the interview".')
      bridgePlaybackRef.current = null
      bridgeSpeakingRef.current = false
    } finally {
      advancingRef.current = false
      setAdvancing(false)
    }
  }

  submitAnswerRef.current = () => {
    void submitAnswer()
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
    const targetJob = targetJobRaw
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
  const callStatus = advancing
    ? 'Moving to your next question…'
    : sttPhase === 'capturing'
      ? 'Recording your answer…'
      : sttPhase === 'transcribing'
        ? 'Transcribing your answer…'
        : aiSpeaking
          ? 'Ava is speaking — wait for the full question, or speak clearly to interrupt'
          : listening
            ? 'Listening — pause ~5s when you are done'
            : 'Live call with Ava'

  const canSubmit =
    draft.trim().length >= 1 &&
    !aiSpeaking &&
    !faceBlocks &&
    !interviewBanned &&
    !advancing &&
    sttPhase !== 'transcribing'
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
            <span className={secondsLeft < 30 ? styles.timerLow : styles.timer}>
              {timeLabel}
            </span>
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

      {reviewSyncError && <p role="alert" className="ds-alert ds-alert--warning">{reviewSyncError}</p>}
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
                {deviceError && <p className={styles.deviceError}>{deviceError}</p>}
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
                  <div className={styles.autoConfigBanner}>
                    <div className={styles.autoConfigLeft}>
                      <span className={styles.autoConfigIcon}>
                        <HrIcon name="target" size={20} />
                      </span>
                      <div>
                        <strong>Interview for this job</strong>
                        <p>
                          <strong>{targetJobRaw.title}</strong> at <strong>{targetJobRaw.company}</strong>
                        </p>
                      </div>
                    </div>
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
                >
                  {lobbyEnterButtonLabel({ starting })}
                </motion.button>
                {joinProgress && (
                  <ul className={styles.joinSteps} aria-live="polite">
                    <li data-state={joinProgress.questions}>
                      {joinProgress.questions === 'done' ? 'Questions ready' : 'Preparing your questions…'}
                    </li>
                    <li data-state={joinProgress.voice === 'pending' ? 'pending' : 'done'}>
                      {joinProgress.voice === 'pending'
                        ? 'Setting up voice answers…'
                        : joinProgress.voice === 'fallback'
                          ? 'Voice answers ready (browser speech)'
                          : 'Voice answers ready'}
                    </li>
                  </ul>
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
                      ? 'Your link opens at your scheduled time. Come back when the countdown reaches zero.'
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
                    Question {current + 1}
                    {adaptiveRef.current ? '' : ` of ${questions.length}`}
                    {question.topic || question.category ? ` · ${question.topic || question.category}` : ''}
                  </span>
                </div>

                <div className={styles.ccBox}>
                  <p>{question.text}</p>
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
              {(showTypeFallback || !speechSupported) && (
                <textarea
                  className={styles.typeFallback}
                  value={draft}
                  rows={3}
                  placeholder="Type your answer…"
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
              {speechSupported && (
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

              <div className={styles.callStatus} aria-live="polite">
                {callStatus}
              </div>

              <motion.button
                type="button"
                className={styles.nextBtnSecondary}
                onClick={() => submitAnswer()}
                disabled={!canSubmit}
              >
                {faceBlocks ? 'Fix face check' : 'Submit answer now'}
              </motion.button>

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
