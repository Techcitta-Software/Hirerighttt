import { ReviewEventTracker, saveReviewEvents } from '../lib/interviewReview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  mapExperienceToLevel,
  mapProfileRoleToInterviewRole,
  type Question,
} from '../lib/interviewEngine'
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
  FaceTracker,
  type FaceTrackStatus,
} from '../lib/faceTracker'
import {
  processInterviewTurn,
  scoreInterviewRemote,
  startInterviewSession,
  type IntegritySnapshot,
} from '../lib/interviewAgentClient'
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
  firstName,
  getInterviewResult,
  getProfile,
  saveInterviewResult,
  type InterviewResult,
} from '../lib/store'
import {
  MAX_ADAPTIVE_QUESTIONS,
  fetchNextAdaptiveQuestion,
  isEndInterviewCommand,
} from '../lib/adaptiveInterview'
import {
  collectInterviewPairs,
  hasSubstantiveInterviewProgress,
} from '../lib/interviewFinish'
import { apiHealthInfo } from '../lib/api'
import { ensureApiSession } from '../lib/apiSession'
import {
  goToCandidateDashboardAfterInterview,
  goToInterviewReportAfterCompletion,
  leaveInterviewRoom,
  markCandidateOnboardingCompleteAfterInterview,
} from '../lib/completeOnboardingAfterInterview'
import {
  createGroqVadSttController,
  type GroqVadSttController,
} from '../lib/groqVadStt'
import { CareerIntelligenceDashboard } from '../components/CareerIntelligenceDashboard'
import { HrIcon } from '../components/HrIcon'
import { BrandLogo } from '../components/BrandLogo'
import { easeOut } from '../motion/variants'
import styles from './InterviewPage.module.css'


type Stage = 'setup' | 'interview' | 'analyzing' | 'results'

const QUESTION_SECONDS = 180
/** After this much silence with an answer on the transcript, auto-advance (call-style). */
const SILENCE_ADVANCE_MS = 5000
const MIN_ANSWER_CHARS = 10

const LOBBY_TIPS = [
  'Only you in frame — extra people bans the interview',
  'Brief glances are fine. Poor frames are marked unable to assess. Scores are unaffected.',
  'Questions follow your resume and the role on your profile',
  'It works for any field — engineering, healthcare, oil & gas, and more',
  'Talk over Ava to interrupt — only your voice stops her (not background noise)',
  'Pause ~5 seconds when you are done — the next question starts automatically',
  'Say "end the interview" when you want to finish (after 2+ answers)',
]

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
    return mapProfileRoleToInterviewRole(profile?.currentRole ?? '')
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
  const [checklist, setChecklist] = useState([false, false, false])
  const [starting, setStarting] = useState(false)
  const [scheduleClock, setScheduleClock] = useState(() => Date.now())

  useEffect(() => {
    void ensureApiSession()
  }, [])

  useEffect(() => {
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
  const [faceStatus, setFaceStatus] = useState<FaceTrackStatus>({
    faceCount: 0,
    ok: false,
    label: 'Waiting for camera…',
    severity: 'warn',
    issue: 'no_face',
    faceAreaRatio: 0,
    yaw: 0,
    lookingForward: false,
  })
  const [interviewBanned, setInterviewBanned] = useState(false)
  const [banMessage, setBanMessage] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [, setRecordingNote] = useState('')
  const [, setRecordingUrl] = useState<string | null>(null)
  const reviewRef = useRef(new ReviewEventTracker())
  const [reviewSyncError, setReviewSyncError] = useState('')
  const recordingConsent = true
  const sessionIdRef = useRef<string | null>(null)
  const integrityRef = useRef<IntegritySnapshot>({
    faceViolations: 0,
    singlePersonOk: true,
    maxFacesSeen: 1,
    sideLookWarnings: 0,
    tooFarWarnings: 0,
  })
  const faceTrackerRef = useRef<FaceTracker | null>(null)
  const multiBanRef = useRef(0)
  const currentRef = useRef(0)
  const recorderRef = useRef(new InterviewRecorder())
  const pendingClipRef = useRef<Awaited<ReturnType<InterviewRecorder['stop']>>>(null)
  const recordingBlobUrlRef = useRef<string | null>(null)

  const answersRef = useRef<string[]>([])
  const finishingRef = useRef(false)
  const draftRef = useRef('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const groqVadRef = useRef<GroqVadSttController | null>(null)
  const groqWhisperEnabledRef = useRef(false)
  const [groqWhisperEnabled, setGroqWhisperEnabled] = useState(false)
  const [groqVadReady, setGroqVadReady] = useState(false)
  const [groqInitFailed, setGroqInitFailed] = useState(false)
  /** Groq path: idle | capturing (Silero) | transcribing (Whisper). Web Speech uses capturing when interim text exists. */
  const [sttPhase, setSttPhase] = useState<'idle' | 'capturing' | 'transcribing'>('idle')
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
  const advancingRef = useRef(false)
  const adaptiveRef = useRef(true)
  const interviewStartedAtRef = useRef<number>(0)
  const historyRef = useRef<{ question: Question; answer: string }[]>([])
  const lastSpeechAtRef = useRef(0)
  const aiSpeakingRef = useRef(false)
  const listeningRef = useRef(false)
  const submitAnswerRef = useRef<() => void>(() => {})
  const bargeCooldownRef = useRef(0)

  const question = questions[current]
  const webSpeechSupported = isSpeechRecognitionSupported()
  const groqSttPreferred = groqWhisperEnabled && !groqInitFailed
  const speechSupported =
    groqVadReady || (webSpeechSupported && !groqSttPreferred) || (groqSttPreferred && groqInitFailed && webSpeechSupported)
  const groqSttLoading = groqSttPreferred && streamReady && !groqVadReady && !groqInitFailed
  const ttsSupported = isSpeechSynthesisSupported()
  const [candidateDisplayName, setCandidateDisplayName] = useState(() => candidateFullName())
  const [savedReport] = useState<InterviewResult | null>(() => getInterviewResult())
  const name = firstName()

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
    groqWhisperEnabledRef.current = groqWhisperEnabled
  }, [groqWhisperEnabled])

  useEffect(() => {
    void apiHealthInfo().then((health) => {
      const enabled = Boolean(health?.features?.groqWhisper)
      setGroqWhisperEnabled(enabled)
      groqWhisperEnabledRef.current = enabled
    })
  }, [])

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
    if (!groqWhisperEnabled || !streamReady) {
      setGroqVadReady(false)
      setGroqInitFailed(false)
      return
    }
    let cancelled = false
    setGroqVadReady(false)
    setGroqInitFailed(false)
    void createGroqVadSttController({
      getStream: () => streamRef.current,
      isAiSpeaking: () => aiSpeakingRef.current,
      onSpeechCaptureStart: () => setSttPhase('capturing'),
      onTranscribing: (active) => setSttPhase(active ? 'transcribing' : 'idle'),
      onSegmentText: (text) => applyTranscriptSegmentRef.current(text),
      onError: (message) => {
        console.warn('[groq-vad-stt]', message)
        setSttPhase('idle')
      },
    }).then((controller) => {
      if (cancelled) {
        void controller?.dispose()
        return
      }
      groqVadRef.current = controller
      const ok = Boolean(controller)
      setGroqVadReady(ok)
      setGroqInitFailed(!ok)
    })
    return () => {
      cancelled = true
      setGroqVadReady(false)
      setGroqInitFailed(false)
      void groqVadRef.current?.dispose()
      groqVadRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groqWhisperEnabled, streamReady])


  // Continuous face tracking in lobby + full interview room
  useEffect(() => {
    if (stage === 'setup' && (skipCamera || !streamReady)) return
    if (stage === 'analyzing' || stage === 'results') return
    const tracker = new FaceTracker()
    faceTrackerRef.current = tracker
    let alive = true
    let busy = false
    const id = window.setInterval(() => {
      if (busy) return
      busy = true
      void (async () => {
        if (!alive || interviewBanned) return
        const video =
          stageRef.current === 'interview' ? roomVideoRef.current : lobbyVideoRef.current
        const status = await tracker.detect(video)
        if (!alive) return
        setFaceStatus(status)

        if (stageRef.current === 'interview' && !pendingClipRef.current) {
          reviewRef.current.sample(status, Math.max(0, (Date.now() - interviewStartedAtRef.current) / 1000))
          integrityRef.current.logs = reviewRef.current.events
        }
      })().finally(() => { busy = false })
    }, 350)
    return () => {
      alive = false
      window.clearInterval(id)
      tracker.dispose()
      faceTrackerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamReady, skipCamera, stage, interviewBanned])

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
    void groqVadRef.current?.stop()
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
    cancelSpeech()
    setAiSpeaking(false)
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

  // Auto-prompt devices when lobby opens (CloudHire-style)
  useEffect(() => {
    if (stage !== 'setup' || streamReady || skipCamera) return
    void enableDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

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

  function startListening() {
    if (!speechSupported || !micOnRef.current) return
    if (aiSpeakingRef.current) return
    stopListening()
    baseDraftRef.current = draftRef.current.trim()
    transcriptCommittedRef.current = baseDraftRef.current

    if (groqVadRef.current) {
      void groqVadRef.current
        .start()
        .then(() => {
          setListening(true)
          listeningRef.current = true
        })
        .catch(() => {
          setListening(false)
          listeningRef.current = false
        })
      return
    }

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

  useEffect(() => {
    if (stage !== 'interview' || !question) return

    const gen = ++speakGenRef.current
    listenAfterTtsRef.current = false
    stopListening()
    lastSpeechAtRef.current = 0
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
        ? `Hi ${name}. I'm Ava on a live interview call. I've reviewed your background for ${role}. When you're ready, you can jump in anytime. `
        : '')

    const spoken = bridge ? `${bridge} ${question.text}` : `${intro}${question.text}`

    speakText(spoken, {
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
        if (stageRef.current === 'interview' && micOnRef.current) startListening()
      },
    })

    return () => {
      speakGenRef.current += 1
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
        interviewBanned
      ) {
        return
      }
      const text = draftRef.current.trim()
      if (text.length < MIN_ANSWER_CHARS) return
      const last = lastSpeechAtRef.current
      if (!last) return
      if (Date.now() - last < SILENCE_ADVANCE_MS) return
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
    const timer = window.setInterval(() => {
      if (sessionIdRef.current) void saveReviewEvents(sessionIdRef.current, reviewRef.current.events)
        .then(() => setReviewSyncError('')).catch(e => setReviewSyncError(e.message))
    }, 5000)
    return () => window.clearInterval(timer)
  }, [stage])

  async function startInterview() {
    if (!streamReady && !skipCamera) return
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
    try {
      const freshProfile = getProfile()
      const inviteCtx = readInviteInterviewContext()
      const baseProfile = freshProfile ?? profile
      const mergedProfile =
        baseProfile && inviteCtx?.resumeText?.trim()
          ? { ...baseProfile, resumeText: inviteCtx.resumeText }
          : baseProfile
      if (mergedProfile?.fullName || mergedProfile?.name) {
        setCandidateDisplayName(mergedProfile.fullName || mergedProfile.name || candidateDisplayName)
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
      const started = await startInterviewSession(role, level, mergedProfile, {
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
      })
      adaptiveRef.current = started.adaptive !== false
      sessionIdRef.current = started.sessionId
      setQuestions(started.questions)
      setCurrent(0)
      setDraft('')
      setResult(null)
      setRecordingNote('')
      setRecordingUrl(null)
      setShowTypeFallback(!speechSupported)
      if (recordingConsent && !sessionIdRef.current) throw new Error('A connected backend session is required to save a vendor recording.')
      setStage('interview')
      reviewRef.current = new ReviewEventTracker()
      interviewStartedAtRef.current = Date.now()
      // This epoch is also the recording timeline origin.
      if (streamRef.current && recordingConsent && sessionIdRef.current) {
        const ok = recorderRef.current.start(streamRef.current)
        setIsRecording(ok)
        if (!ok) {
          setRecordingNote('Recording unavailable in this browser — answers still score.')
        }
      }

      window.setTimeout(() => attachStream(roomVideoRef.current), 50)
      window.setTimeout(() => attachStream(roomVideoRef.current), 300)
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Could not start interview agent.')
    } finally {
      setStarting(false)
    }
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

    const answer = draftRef.current.trim()
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
      historyRef.current.length >= MAX_ADAPTIVE_QUESTIONS
    ) {
      finishingRef.current = true
      finish(next, false)
      return
    }

    advancingRef.current = true
    setAdvancing(true)
    lastSpeechAtRef.current = 0
    setDraft('')
    setDeviceError('')

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
      bridgeRef.current = `Thanks ${name}. Let's continue. `
    }

    try {
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
        history: historyRef.current,
        lastQuestion: currentQuestion,
        lastAnswer: answer,
      })
      if (historyRef.current.length >= MAX_ADAPTIVE_QUESTIONS) {
        finishingRef.current = true
        finish(next, false)
        return
      }
      setQuestions((prev) => [...prev, nextQuestion])
      setCurrent((c) => c + 1)
    } catch (err) {
      if (err instanceof Error && err.message === 'INTERVIEW_COMPLETE') {
        finishingRef.current = true
        finish(next, false)
        return
      }
      setDeviceError('Could not load the next question. Try again or say "end the interview".')
    } finally {
      advancingRef.current = false
      setAdvancing(false)
    }
  }

  submitAnswerRef.current = () => {
    void submitAnswer()
  }

  function finish(finalAnswers: string[], banned: boolean, banReason?: string) {
    reviewRef.current.finish((Date.now() - interviewStartedAtRef.current) / 1000)
    integrityRef.current.logs = reviewRef.current.events
    setStage('analyzing')
    setIsRecording(false)
    const reason =
      banReason ||
      banMessage ||
      integrityRef.current.banReason ||
      'Interview banned: more than one person was detected on camera.'
    if (banned) {
      integrityRef.current.banned = true
      integrityRef.current.banReason = reason
      integrityRef.current.singlePersonOk = false
    }
    window.setTimeout(() => {
      void (async () => {
        const integrity = { ...integrityRef.current }
        if (sessionIdRef.current) await saveReviewEvents(sessionIdRef.current, reviewRef.current.events)
        let recordingNoteLocal = ''

        try {
          const clip = pendingClipRef.current || (await recorderRef.current.stop())
          pendingClipRef.current = clip
          if (clip) {
            recordingNoteLocal = 'Recording captured — scoring your answers.'
            if (sessionIdRef.current) {
              const { uploadInterviewRecordingToS3 } = await import(
                '../lib/interviewRecordingUpload'
              )
              const cloud = await uploadInterviewRecordingToS3({
                sessionId: sessionIdRef.current,
                blob: clip.blob,
                durationMs: clip.durationMs,
              })
              if (cloud.ok) {
                recordingNoteLocal = 'Recording saved to secure cloud storage (S3).'
                pendingClipRef.current = null
              } else if (cloud.skipped) {
                recordingNoteLocal =
                  'Cloud recording storage is not configured — your scorecard will still be generated.'
              } else {
                recordingNoteLocal = `${cloud.error || 'Recording upload failed.'} Your answers will still be scored.`
              }
            }
          } else {
            recordingNoteLocal = 'Recording not captured — answers were still scored locally.'
          }
        } catch (error) {
          recordingNoteLocal =
            error instanceof Error
              ? `${error.message} Your answers will still be scored.`
              : 'Recording upload had a problem. Your answers will still be scored.'
        }
        setRecordingNote(recordingNoteLocal)

        const paired = collectInterviewPairs(
          questions,
          finalAnswers,
          historyRef.current,
        )
        if (!paired.questions.length) {
          throw new Error('No answered questions to score.')
        }

        let scored: InterviewResult
        try {
          scored = await scoreInterviewRemote({
            sessionId: sessionIdRef.current,
            role,
            level,
            questions: paired.questions,
            answers: paired.answers,
            profile: getProfile() ?? profile,
            integrity,
          })
        } catch (scoreErr) {
          console.warn('[InterviewPage] score failed, retrying local score', scoreErr)
          scored = await scoreInterviewRemote({
            sessionId: null,
            role,
            level,
            questions: paired.questions,
            answers: paired.answers,
            profile: getProfile() ?? profile,
            integrity,
          })
        }
        scored.sessionId = sessionIdRef.current || undefined
        scored.integrity = { ...integrity, logs: reviewRef.current.events }
        saveInterviewResult(scored)
        await markCandidateOnboardingCompleteAfterInterview()
        if (targetJobRaw?.applicationId) {
          attachInterviewToApplicant(targetJobRaw.applicationId, scored)
        }
        if (targetJobRaw && !integrity.banned) {
          try {
            applyToJob({
              title: targetJobRaw.title,
              company: targetJobRaw.company,
              location: 'Remote',
              match: scored.overall,
            })
          } catch {
            // ignore if already applied or score too low
          }
          sessionStorage.removeItem('hireright.targetJob')
        }
        finishingRef.current = false
        if (sessionIdRef.current) {
          sessionStorage.setItem('hireright.lastInterviewSessionId', sessionIdRef.current)
        }
        setResult(scored)
        goToInterviewReportAfterCompletion(navigate, { uploadReport: true })
      })().catch((err) => {
        finishingRef.current = false
        setStage('interview')
        setDeviceError(
          err instanceof Error ? err.message : 'Could not finish the interview. Try Leave again.',
        )
      })
    }, 1200)
  }

  function retake() {
    finishingRef.current = false
    answersRef.current = []
    sessionIdRef.current = null
    multiBanRef.current = 0
    setInterviewBanned(false)
    setBanMessage('')
    setIsRecording(false)
    setRecordingNote('')
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
    setChecklist([false, false, false])
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
          ? 'Ava speaking — speak clearly (2+ words) to interrupt'
          : listening
            ? 'Listening — pause ~5s when you are done'
            : 'Live call with Ava'

  const canSubmit =
    Boolean(draft.trim()) && !aiSpeaking && !faceBlocks && !interviewBanned && !advancing

  return (
    <div className={styles.page}>
      <header className={styles.appBar}>
        <div className={styles.appBrand}>
          <BrandLogo size="md" />
        </div>

        {stage === 'interview' && question ? (
          <div className={styles.appMeta}>
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

      {reviewSyncError && <p role="alert">{reviewSyncError}</p>}
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
                Hi {name}, meet your interviewer <em>Ava</em>
              </h1>
              <p className={styles.sub}>
                A live call with Ava — software, civil, mechanical, healthcare, oil &amp; gas,
                and more. Speak anytime; she stops when you talk. Pause briefly when you are done
                and the next question flows automatically.
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
                      <p>Enable camera to preview how you&apos;ll appear</p>
                    </div>
                  )}
                  <div className={styles.previewOverlay}>
                    <span className={styles.youChip}>{name}</span>
                    {streamReady && <span className={styles.liveBadge}>Camera live</span>}
                  </div>
                </div>

                <div className={styles.deviceStrip}>
                  <span className={streamReady && camOn ? styles.ok : styles.off}>
                    Camera
                  </span>
                  <span className={streamReady && micOn ? styles.ok : styles.off}>Mic</span>
                  <span className={speechSupported || groqSttLoading ? styles.ok : styles.warn}>
                    {groqVadReady
                      ? 'Groq STT'
                      : groqSttLoading
                        ? 'Loading STT…'
                        : 'Speech'}
                  </span>
                  <span className={ttsSupported ? styles.ok : styles.warn}>AI voice</span>
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
                  Camera is required. Face tracking runs for the full interview — one person, facing forward.
                </p>
                {deviceError && <p className={styles.deviceError}>{deviceError}</p>}
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
              </div>

              <div className={styles.lobbySide}>
                {targetJobRaw && (
                  <div className={styles.autoConfigBanner}>
                    <div className={styles.autoConfigLeft}>
                      <span className={styles.autoConfigIcon}>
                        <HrIcon name="target" size={20} />
                      </span>
                      <div>
                        <strong>Auto-Selected for Job Application</strong>
                        <p>
                          Targeting: <strong>{targetJobRaw.title}</strong> at <strong>{targetJobRaw.company}</strong>
                        </p>
                      </div>
                    </div>
                    <span className={styles.autoConfigPill}>
                      {role} · {level}
                    </span>
                  </div>
                )}

                <div className={styles.tips}>
                  <h4>Before you join</h4>
                  <ul>
                    {LOBBY_TIPS.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>

                <div className={styles.checkList}>
                  {[
                    'I am alone in a quiet place',
                    'My face is visible and facing the camera',
                    'I will answer out loud',
                  ].map((label, i) => (
                    <label key={label} className={styles.checkItem}>
                      <input
                        type="checkbox"
                        checked={checklist[i]}
                        onChange={(e) => {
                          const next = [...checklist]
                          next[i] = e.target.checked
                          setChecklist(next)
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <motion.button
                  type="button"
                  className={styles.joinBtn}
                  onClick={() => void startInterview()}
                  disabled={!canStart}
                  whileHover={canStart ? { scale: 1.02 } : undefined}
                  whileTap={canStart ? { scale: 0.98 } : undefined}
                >
                  {starting ? 'Ava is preparing questions…' : 'Enter interview room'}
                </motion.button>
                {savedReport && (
                  <button
                    type="button"
                    id="view-saved-report-btn"
                    style={{
                      marginTop: '12px',
                      width: '100%',
                      padding: '12px 18px',
                      borderRadius: '12px',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1d4ed8',
                      fontWeight: 700,
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                    onClick={() => {
                      setResult(savedReport)
                      setStage('results')
                    }}
                  >
                    <HrIcon name="chart" size={18} /> View Last 360° Career Intelligence Report
                  </button>
                )}
                {!canStart && (
                  <p className={styles.joinHint}>
                    {scheduledInviteAccess?.status === 'too_early'
                      ? 'Your scheduled link opens at the exact slot start time. Use the email link when the countdown reaches zero.'
                      : scheduledInviteAccess?.status === 'expired'
                        ? 'Your interview window has ended. Ask your recruiter for a new invite link.'
                        : faceBlocks
                      ? faceStatus.issue === 'multi_person'
                        ? 'Only one person may be in the camera — clear others to join.'
                        : faceStatus.issue === 'looking_away'
                          ? 'Face the camera straight-on before joining.'
                          : faceStatus.issue === 'no_face'
                            ? 'Move into view (closer if you are far) so your face is detected.'
                            : 'Fix the face check to join.'
                      : `Complete the checklist${!streamReady ? ' and enable camera' : ''} to join.`}
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
                            : 'Proctoring alert'}
                </strong>
                <span>{interviewBanned ? banMessage : faceStatus.label}</span>
              </div>
            )}

            <div className={styles.callStage}>
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
                    {question.topic || question.category} · Q{current + 1}
                    {adaptiveRef.current ? ' · adaptive' : `/${questions.length}`}
                    {isRecording ? ' · Recording' : ''}
                  </span>
                </div>

                <div className={styles.ccBox}>
                  <span className={styles.ccTag}>Ava asks · Gemini 2.5 Flash / Luna</span>
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
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {faceBlocks ? 'Fix face check' : 'Submit answer now'}
              </motion.button>

              <button type="button" className={styles.endBtn} onClick={endInterviewEarly}>
                Leave
              </button>
            </footer>
          </motion.section>
        )}

        {stage === 'analyzing' && (
          <motion.section
            key="analyzing"
            className={styles.analyzing}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className={styles.analyzeCard}>
              <motion.div
                className={styles.analyzeOrb}
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              />
              <h2>Scoring your interview</h2>
              <p>Ava is scoring communication, resume fit, and role accuracy.</p>
              <ul>
                {[
                  'Matching answers to your resume',
                  'Scoring structure & specificity',
                  'Checking single-person integrity',
                  'Building your talent report',
                ].map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <div className={styles.analyzeSteps}>
                {[
                  'Syncing video transcript',
                  'Evaluating answer depth',
                  'Benchmarking to your role',
                ].map((step, i) => (
                  <motion.p
                    key={step}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.7 }}
                  >
                    {step}
                  </motion.p>
                ))}
              </div>
            </div>
          </motion.section>
        )}

        {stage === 'results' && result && (
          <motion.section
            key="results"
            className={styles.results}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: easeOut }}
            style={{ width: '100%', maxWidth: '1280px', margin: '0 auto', padding: '0 0 48px' }}
          >
            {/* 360° AI Persona & Career Intelligence Dashboard */}
            <CareerIntelligenceDashboard
              result={result}
              candidateName={candidateDisplayName}
              candidateRole={role}
              candidateExperience={level}
              skills={profileSkills.length > 0 ? profileSkills : ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'AWS', 'REST APIs', 'System Design']}
              onRetake={retake}
              onContinue={() => goToCandidateDashboardAfterInterview(navigate)}
            />


          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
