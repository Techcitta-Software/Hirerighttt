import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LEVELS,
  ROLES,
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
  checkLlmStatus,
  pingInterviewIntegrity,
  processInterviewTurn,
  scoreInterviewRemote,
  startInterviewSession,
  type IntegritySnapshot,
} from '../lib/interviewAgentClient'
import { InterviewRecorder } from '../lib/interviewRecorder'
import {
  applyToJob,
  attachInterviewToApplicant,
  candidateFullName,
  firstName,
  getInterviewResult,
  getProfile,
  saveInterviewResult,
  saveProfile,
  updateUserName,
  type IntegrityLogEvent,
  type InterviewResult,
} from '../lib/store'
import {
  MAX_ADAPTIVE_QUESTIONS,
  fetchNextAdaptiveQuestion,
  isEndInterviewCommand,
} from '../lib/adaptiveInterview'
import { ensureApiSession, syncProfileToApi } from '../lib/apiSession'
import { parseResumeFile } from '../lib/resumeParser'
import { CareerIntelligenceDashboard } from '../components/CareerIntelligenceDashboard'
import { HrIcon } from '../components/HrIcon'
import { BrandLogo } from '../components/BrandLogo'
import { easeOut } from '../motion/variants'
import styles from './InterviewPage.module.css'


type Stage = 'setup' | 'interview' | 'analyzing' | 'results'

const QUESTION_SECONDS = 180
/** After this much silence with an answer on the transcript, auto-advance (call-style). */
const SILENCE_ADVANCE_MS = 2500
const MIN_ANSWER_CHARS = 10

const LOBBY_TIPS = [
  'Only you in frame — extra people bans the interview',
  'Face the camera (not the side) the whole time',
  'No role chip selected? Questions follow your resume. Pick a role track to focus the interview on that job',
  'It works for any field — engineering, healthcare, oil & gas, and more',
  'Talk over Ava to interrupt — only your voice stops her (not background noise)',
  'Pause ~2.5s or click "Next Question" when done — Ava promptly gives the next question',
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
  const fromWizard = useMemo(
    () => sessionStorage.getItem('hireright.returnToWizard') === '1',
    [],
  )

  const targetJobRaw = useMemo(() => {
    const str = sessionStorage.getItem('hireright.targetJob')
    if (!str) return null
    try {
      return JSON.parse(str) as {
        title: string
        company: string
        role: string
        level: string
        applicantId?: string
        jd?: string
      }
    } catch {
      return null
    }
  }, [])

  const [stage, setStage] = useState<Stage>('setup')
  const [role, setRole] = useState<string>(() => {
    if (targetJobRaw?.role) return targetJobRaw.role
    return mapProfileRoleToInterviewRole(profile?.currentRole ?? '')
  })
  const [level, setLevel] = useState<string>(() => {
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
  const [agentLabel, setAgentLabel] = useState('Ava · live voice agent')
  const [llmStatus, setLlmStatus] = useState<{
    active: boolean
    model?: string
    provider?: string
    message?: string
  } | null>(null)

  useEffect(() => {
    checkLlmStatus().then((status) => {
      setLlmStatus(status)
    })
  }, [])

  useEffect(() => {
    void ensureApiSession()
  }, [])
  const [customJd, setCustomJd] = useState(
    targetJobRaw?.jd
      ? targetJobRaw.jd
      : targetJobRaw?.title
        ? `Target Job: ${targetJobRaw.title} at ${targetJobRaw.company}`
        : '',
  )
  const [roleTrackExplicit, setRoleTrackExplicit] = useState(() => Boolean(targetJobRaw))
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
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
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
  const recordingBlobUrlRef = useRef<string | null>(null)

  const answersRef = useRef<string[]>([])
  const finishingRef = useRef(false)
  const draftRef = useRef('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
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
  const adaptiveRef = useRef(false)
  const questionPlanRef = useRef<'llm-fixed' | 'template-fixed' | 'adaptive'>('llm-fixed')
  const interviewStartedAtRef = useRef<number>(0)
  const historyRef = useRef<{ question: Question; answer: string }[]>([])
  const lastSpeechAtRef = useRef(0)
  const aiSpeakingRef = useRef(false)
  const listeningRef = useRef(false)
  const submitAnswerRef = useRef<() => void>(() => {})
  const bargeCooldownRef = useRef(0)

  const question = questions[current]
  const speechSupported = isSpeechRecognitionSupported()
  const ttsSupported = isSpeechSynthesisSupported()
  const [candidateDisplayName, setCandidateDisplayName] = useState(() => candidateFullName())
  const [resumeNote, setResumeNote] = useState('')
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

  const lastLogTimeRef = useRef<{ [key: string]: number }>({})

  const addIntegrityLog = useCallback(
    (
      eventType: IntegrityLogEvent['eventType'],
      severity: IntegrityLogEvent['severity'],
      message: string,
    ) => {
      const now = Date.now()
      const lastTime = lastLogTimeRef.current[eventType] || 0
      if (now - lastTime < 3000 && eventType !== 'INTERVIEW_BANNED') return
      lastLogTimeRef.current[eventType] = now

      const date = new Date()
      const formattedTime = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })

      const logEvent: IntegrityLogEvent = {
        id: `log-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: date.toISOString(),
        formattedTime,
        eventType,
        severity,
        message,
        questionIndex: stageRef.current === 'interview' ? currentRef.current + 1 : undefined,
      }

      if (!integrityRef.current.logs) {
        integrityRef.current.logs = []
      }
      integrityRef.current.logs.push(logEvent)
    },
    [],
  )

  // Continuous face tracking in lobby + full interview room
  useEffect(() => {
    if (skipCamera || (!streamReady && stage === 'setup')) return
    if (stage === 'analyzing' || stage === 'results') return
    const tracker = new FaceTracker()
    faceTrackerRef.current = tracker
    let alive = true
    const id = window.setInterval(() => {
      void (async () => {
        if (!alive || interviewBanned) return
        const video =
          stageRef.current === 'interview' ? roomVideoRef.current : lobbyVideoRef.current
        const status = await tracker.detect(video)
        if (!alive) return
        setFaceStatus(status)

        integrityRef.current.maxFacesSeen = Math.max(
          integrityRef.current.maxFacesSeen,
          status.faceCount,
        )

        if (status.issue === 'looking_away') {
          integrityRef.current.sideLookWarnings =
            (integrityRef.current.sideLookWarnings || 0) + 1
          addIntegrityLog(
            'SIDE_GAZE_LOOKING_AWAY',
            'warn',
            `Alert: Candidate looking away from screen (Yaw: ${(status.yaw * 57.3).toFixed(1)}°)`,
          )
        }
        if (status.issue === 'too_far') {
          integrityRef.current.tooFarWarnings =
            (integrityRef.current.tooFarWarnings || 0) + 1
          addIntegrityLog(
            'EXCESSIVE_MOVEMENT',
            'warn',
            `Alert: Excessive distance/movement from camera (Face ratio: ${status.faceAreaRatio.toFixed(3)})`,
          )
        }

        if (status.issue === 'multi_person' || status.severity === 'ban') {
          integrityRef.current.faceViolations += 1
          integrityRef.current.singlePersonOk = false
          multiBanRef.current += 1
          void pingInterviewIntegrity(sessionIdRef.current, status.faceCount)

          addIntegrityLog(
            'MULTIPLE_FACES_DETECTED',
            'ban',
            `Alert: MULTIPLE PEOPLE DETECTED: ${status.faceCount} faces in camera frame simultaneously!`,
          )

          // ~2 seconds of multi-person (interval 350ms × 6) → ban live interview
          if (stageRef.current === 'interview' && multiBanRef.current >= 6) {
            const reason =
              'Interview banned: more than one person was detected on camera. Only the candidate may be in frame.'
            integrityRef.current.banned = true
            integrityRef.current.banReason = reason
            addIntegrityLog(
              'INTERVIEW_BANNED',
              'ban',
              `Alert: INTERVIEW BANNED & TERMINATED: Integrity violation (Multiple people detected)`,
            )
            setInterviewBanned(true)
            setBanMessage(reason)
            stopAllSpeech()
            finishingRef.current = true
            const next = [...answersRef.current]
            next[currentRef.current] = draftRef.current.trim()
            answersRef.current = next
            finish(next, true, reason)
          }
        } else {
          multiBanRef.current = Math.max(0, multiBanRef.current - 1)
        }

        if (
          status.severity === 'block' &&
          status.issue === 'no_face' &&
          stageRef.current === 'interview'
        ) {
          integrityRef.current.faceViolations += 1
          void pingInterviewIntegrity(sessionIdRef.current, 0)
          addIntegrityLog(
            'NO_FACE_SEEN',
            'block',
            `Alert: NO FACE DETECTED: Candidate face moved out of camera frame`,
          )
        }
      })()
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
    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore
    }
    recognitionRef.current = null
    setListening(false)
  }

  function stopAllSpeech() {
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

  function startListening(options?: { duringTts?: boolean }) {
    if (!speechSupported || !micOnRef.current) return
    if (aiSpeakingRef.current && !options?.duringTts) return
    stopListening()
    const recognition = getSpeechRecognition()
    if (!recognition) return
    baseDraftRef.current = draftRef.current.trim()
    transcriptCommittedRef.current = baseDraftRef.current
    configureInterviewRecognition(recognition)
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const merged = mergeRecognitionResults(event, transcriptCommittedRef.current)
      transcriptCommittedRef.current = merged.committed

      if (aiSpeakingRef.current) {
        if (merged.bargeIn) {
          handleBargeIn()
          const line = merged.interim
            ? `${merged.committed} ${merged.interim}`.trim()
            : merged.committed.trim()
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
        lastSpeechAtRef.current = Date.now()
      }
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => {
      setListening(false)
      listeningRef.current = false
      window.setTimeout(() => {
        if (
          listenAfterTtsRef.current &&
          stageRef.current === 'interview' &&
          micOnRef.current &&
          !finishingRef.current &&
          !advancingRef.current &&
          !listeningRef.current
        ) {
          startListening()
        }
      }, 100)
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
    listenAfterTtsRef.current = true
    lastSpeechAtRef.current = 0
    setDraft('')
    draftRef.current = ''
    baseDraftRef.current = ''
    transcriptCommittedRef.current = ''
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

    if (micOnRef.current && speechSupported) {
      window.setTimeout(() => startListening({ duringTts: true }), 450)
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
        setAiSpeaking(false)
        aiSpeakingRef.current = false
        listenAfterTtsRef.current = true
        if (stageRef.current === 'interview' && micOnRef.current) {
          startListening()
        }
      },
      onError: () => {
        if (gen !== speakGenRef.current) return
        setAiSpeaking(false)
        aiSpeakingRef.current = false
        listenAfterTtsRef.current = true
        if (stageRef.current === 'interview' && micOnRef.current) {
          startListening()
        }
      },
    })

    return () => {
      speakGenRef.current += 1
      cancelSpeech()
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
    }, 250)
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
      if (freshProfile?.fullName || freshProfile?.name) {
        setCandidateDisplayName(freshProfile.fullName || freshProfile.name || candidateDisplayName)
      }
      historyRef.current = []
      interviewStartedAtRef.current = Date.now()
      const explicitTrack =
        roleTrackExplicitRef.current ||
        Boolean(targetJobRaw) ||
        customJd.trim().length >= 40
      const started = await startInterviewSession(
        role,
        level,
        freshProfile ?? profile,
        customJd,
        explicitTrack,
      )
      adaptiveRef.current = started.adaptive === true
      questionPlanRef.current = started.questionPlan ?? (started.adaptive ? 'adaptive' : 'llm-fixed')
      sessionIdRef.current = started.sessionId
      setAgentLabel(started.agent || 'Ava · interviewer')
      if (started.questionMeta?.questionSource === 'template') {
        console.info(
          `[Interview] First question is server backup (${started.questionMeta.llmFailureReason || 'unknown'}${started.questionMeta.llmLatencyMs ? `, ${started.questionMeta.llmLatencyMs}ms` : ''})`,
        )
      }
      setQuestions(started.questions)
      setCurrent(0)
      setDraft('')
      setResult(null)
      setRecordingNote('')
      setRecordingUrl(null)
      setShowTypeFallback(!speechSupported)
      setStage('interview')

      // Start local webcam recording (saved on finish)
      if (streamRef.current) {
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
    const cur = (draftRef.current || draft || '').trim()
    const next = [...answersRef.current]
    if (cur) {
      next[current] = cur
      answersRef.current = next
      try {
        sessionStorage.setItem('hireright.interviewAnswers', JSON.stringify(next))
      } catch {}
    }
    const answered = next.filter((a) => a?.trim() && !a.startsWith('(Answer skipped')).length
    if (answered < 1 && !next[current]?.trim()) {
      setDeviceError('Answer at least one question, or say "end the interview" after you respond.')
      return
    }
    finishingRef.current = true
    finish(next, false)
  }

  async function submitAnswer(isSkip = false) {
    if (finishingRef.current || stage !== 'interview' || questions.length === 0) {
      return
    }
    if (interviewBanned || advancingRef.current) return
    if (!skipCamera) {
      if (faceStatus.issue === 'multi_person' || faceStatus.severity === 'ban') {
        setDeviceError('Multiple people detected — interview cannot continue.')
        return
      }
      if (faceStatus.issue === 'looking_away') {
        addIntegrityLog('SIDE_GAZE_LOOKING_AWAY', 'warn', 'Looking away during answer submission')
      } else if (faceStatus.severity === 'block') {
        addIntegrityLog('NO_FACE_SEEN', 'warn', 'Face not centered during answer submission')
      }
    }
    listenAfterTtsRef.current = false
    stopAllSpeech()

    const rawAnswer = isSkip ? '' : (draftRef.current || draft || '').trim()
    const answer = rawAnswer || '(Answer skipped by candidate)'
    const next = [...answersRef.current]
    next[current] = rawAnswer || '(Answer skipped by candidate)'
    answersRef.current = next
    try {
      sessionStorage.setItem('hireright.interviewAnswers', JSON.stringify(next))
    } catch {}

    const answeredCount = next.filter((a) => a && a.trim() && !a.startsWith('(Answer skipped')).length
    if (isEndInterviewCommand(rawAnswer)) {
      if (answeredCount < 1 && current === 0 && !rawAnswer.replace(/end|stop|finish|done/gi, '').trim()) {
        setDeviceError('Share at least one answer first, then say "end the interview".')
        return
      }
      finishingRef.current = true
      finish(next, false)
      return
    }

    if (current >= questions.length - 1) {
      finishingRef.current = true
      finish(next, false)
      return
    }

    if (
      adaptiveRef.current &&
      questionPlanRef.current === 'adaptive' &&
      (answeredCount >= MAX_ADAPTIVE_QUESTIONS || current >= MAX_ADAPTIVE_QUESTIONS - 1)
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

    const currentQuestion = questions[current]
    historyRef.current = [
      ...historyRef.current.slice(0, current),
      { question: currentQuestion, answer },
    ]

    try {
      const turn = await processInterviewTurn({
        sessionId: sessionIdRef.current,
        role,
        level,
        question: currentQuestion,
        answer,
        questionIndex: current,
        totalQuestions: questions.length,
        profile: getProfile(),
      })
      bridgeRef.current = turn.spoken?.trim() ? `${turn.spoken.trim()} ` : ''
    } catch {
      bridgeRef.current = `Thanks ${name}. Let's continue. `
    }

    // Fixed LLM or fixed template bank — advance in the prepared list only (no /interview/next).
    if (questionPlanRef.current !== 'adaptive') {
      setCurrent((c) => c + 1)
      advancingRef.current = false
      setAdvancing(false)
      return
    }

    try {
      const { question: nextQuestion, meta: nextMeta } = await fetchNextAdaptiveQuestion({
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
      setQuestions((prev) => [...prev, nextQuestion])
      setCurrent((c) => c + 1)
      setAgentLabel(
        nextMeta.questionSource === 'llm'
          ? `Ava · AI-generated question${nextMeta.llmLatencyMs ? ` · ${nextMeta.llmLatencyMs}ms` : ''}`
          : `Ava · backup question (${nextMeta.llmFailureReason || 'AI unavailable'})`,
      )
    } catch {
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
        let recordingNoteLocal = ''

        try {
          const clip = await recorderRef.current.stop()
          if (clip) {
            await recorderRef.current.saveToIndexedDb({
              blob: clip.blob,
              durationMs: clip.durationMs,
              role,
              level,
              candidateName: firstName(),
            })
            if (recordingBlobUrlRef.current) {
              URL.revokeObjectURL(recordingBlobUrlRef.current)
            }
            recordingBlobUrlRef.current = URL.createObjectURL(clip.blob)
            setRecordingUrl(recordingBlobUrlRef.current)
            recordingNoteLocal = `Video recording saved securely to local storage (${Math.round(clip.blob.size / 1024)} KB)`
          } else {
            recordingNoteLocal = 'Recording not captured — answers were still scored locally.'
          }
        } catch {
          recordingNoteLocal = 'Could not save recording locally.'
        }
        setRecordingNote(recordingNoteLocal)

        const answerCount = finalAnswers.length
        const trimmedQuestions = questions.slice(0, answerCount)
        const trimmedAnswers = finalAnswers.slice(0, trimmedQuestions.length)

        let scored = await scoreInterviewRemote({
          sessionId: sessionIdRef.current,
          role,
          level,
          questions: trimmedQuestions,
          answers: trimmedAnswers,
          profile: getProfile() ?? profile,
          integrity,
        })
        if (integrity.banned) {
          scored = {
            ...scored,
            overall: 0,
            improvements: [
              integrity.banReason || reason,
              ...(scored.improvements || []).slice(0, 4),
            ],
            strengths: ['Integrity rules were enforced for a fair interview.'],
            integrity: {
              faceViolations: integrity.faceViolations,
              singlePersonOk: false,
              maxFacesSeen: integrity.maxFacesSeen,
              banned: true,
              banReason: integrity.banReason || reason,
              sideLookWarnings: integrity.sideLookWarnings,
              tooFarWarnings: integrity.tooFarWarnings,
            },
          }
        }
        saveInterviewResult(scored)
        if (targetJobRaw?.applicantId) {
          attachInterviewToApplicant(targetJobRaw.applicantId, scored)
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
        setResult(scored)
        setStage('results')
      })()
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

  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0
  const faceBlocks =
    !skipCamera &&
    (faceStatus.severity === 'block' ||
      faceStatus.severity === 'ban' ||
      faceStatus.issue === 'multi_person' ||
      (faceStatus.issue === 'looking_away' && Math.abs(faceStatus.yaw) >= 0.48))
  const faceWarnOnly =
    !skipCamera && faceStatus.severity === 'warn' && !faceBlocks
  const canStart =
    checklist.every(Boolean) &&
    !starting &&
    (skipCamera || (streamReady && !faceBlocks && faceStatus.faceCount === 1))
  const hasAnswer = draft.trim().length >= MIN_ANSWER_CHARS
  const callStatus = advancing
    ? 'Moving to your next question…'
    : aiSpeaking
      ? 'Ava speaking — jump in anytime to answer'
      : hasAnswer
        ? 'Answer captured — pause ~2.5s or click Next below'
        : listening
          ? 'Listening — speak your answer anytime'
          : 'Live call with Ava'

  const canSubmit = !advancing && !interviewBanned

  return (
    <div className={styles.page}>
      <header className={styles.appBar}>
        <div className={styles.appBrand}>
          <BrandLogo size="md" />
        </div>

        {stage === 'interview' && question ? (
          <div className={styles.appMeta}>
            <span className={styles.livePill}>
              <i /> Recording
            </span>
            <span className={styles.agentPill}>{agentLabel}</span>
            {isRecording && (
              <span className={styles.recPill}>
                <i /> REC
              </span>
            )}
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
            <span>
              Question {current + 1} of {questions.length}
            </span>
            <span className={secondsLeft < 30 ? styles.timerLow : styles.timer}>
              {timeLabel}
            </span>
          </div>
        ) : (
          <button
            type="button"
            className={styles.exitLink}
            onClick={() => navigate('/dashboard')}
          >
            Exit
          </button>
        )}
      </header>

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
                  <span className={speechSupported ? styles.ok : styles.warn}>Speech</span>
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
                <div className={styles.llmBadge}>
                  <span className={styles.llmDot} />
                  <HrIcon name="check" size={14} />
                  <span>
                    {llmStatus?.message ||
                      'Gemini 2.5 Flash Active (Luna Fallback) & Synchronized with Resume'}
                  </span>
                </div>

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

                <div className={styles.avaCard}>
                  <div className={styles.avaPortrait} aria-hidden="true">
                    <div className={styles.avaFace}>
                      <span className={styles.avaEye} />
                      <span className={styles.avaEye} />
                      <span className={styles.avaSmile} />
                    </div>
                  </div>
                  <div>
                    <h3>Ava</h3>
                    <p>AI Interviewer · Powered by Gemini 2.5 Flash / Luna</p>
                  </div>
                </div>

                {targetJobRaw ? (
                  <div className={styles.lockedNotice}>
                    <span className={styles.lockedIcon}>
                      <HrIcon name="lock" size={22} />
                    </span>
                    <div className={styles.lockedText}>
                      <strong>Role & Level Locked for Application</strong>
                      <p>
                        Targeting <strong>{targetJobRaw.title}</strong> ({role} · {level})
                      </p>
                    </div>
                    <button
                      type="button"
                      className={styles.clearTargetBtn}
                      onClick={() => {
                        sessionStorage.removeItem('hireright.targetJob')
                        window.location.reload()
                      }}
                    >
                      Change Job
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={styles.field}>
                      <span>Role track</span>
                      <div className={styles.chips}>
                        {ROLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            className={r === role ? styles.chipActive : styles.chip}
                            onClick={() => {
                              setRole(r)
                              setRoleTrackExplicit(true)
                            }}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className={styles.field}>
                      <span>Level</span>
                      <div className={styles.chips}>
                        {LEVELS.map((l) => (
                          <button
                            key={l}
                            type="button"
                            className={l === level ? styles.chipActive : styles.chip}
                            onClick={() => {
                              setLevel(l)
                              setRoleTrackExplicit(true)
                            }}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div className={styles.jdContainer}>
                  <label htmlFor="custom-jd-input" className={styles.jdLabel}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <HrIcon name="document" size={18} /> Target Job Description (JD)
                    </span>{' '}
                    <em>— Tailors AI questions to JD + Role</em>
                  </label>
                  <textarea
                    id="custom-jd-input"
                    className={styles.jdTextarea}
                    placeholder="Paste the Job Description (JD) or key responsibilities here (e.g. 'Senior Frontend Dev: React, TypeScript, Performance optimization, State management...'). Ava will generate tailored JD questions!"
                    value={customJd}
                    onChange={(e) => setCustomJd(e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Live Resume Sync Dropzone */}
                <div className={styles.tips} style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <h4
                      style={{
                        margin: 0,
                        color: '#166534',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <HrIcon name="document" size={18} /> Resume Synchronized:{' '}
                      <strong>{candidateDisplayName}</strong>
                    </h4>
                    <label style={{ cursor: 'pointer', background: '#ffffff', border: '1px solid #86efac', padding: '5px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#15803d', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                      Upload / Change Resume PDF
                      <input
                        type="file"
                        accept=".pdf,.docx,.txt"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            const extracted = await parseResumeFile(file)
                            if (extracted.fullName) {
                              updateUserName(extracted.fullName)
                              setCandidateDisplayName(extracted.fullName)
                            }
                            const currentP = getProfile() || {
                              resumeName: file.name,
                              updatedAt: new Date().toISOString(),
                              completedSteps: 1,
                              skills: [],
                              whoAreYou: '',
                              whatDrivesYou: '',
                              keyStrengths: '',
                              currentRole: role,
                              totalExperience: level,
                              currentLocation: 'Remote',
                              noticePeriod: '',
                              experienceSummary: '',
                              workExperiences: [],
                              achievements: [],
                              metrics: [],
                              awards: [],
                              certifications: [],
                              selfRating: 4,
                              preferredRoles: [],
                              preferredLocations: [],
                              workMode: '',
                              salaryExpectation: '',
                              interviewNotes: '',
                              resumeText: '',
                            }
                            const updatedP = {
                              ...currentP,
                              resumeFile: null,
                              resumeName: file.name,
                              resumeText: extracted.resumeText || `Resume: ${file.name}`,
                              fullName: extracted.fullName || currentP.fullName,
                              name: extracted.fullName || currentP.name,
                              skills: extracted.skills?.length ? extracted.skills : currentP.skills,
                              currentRole: extracted.currentRole || currentP.currentRole || role,
                              totalExperience: extracted.totalExperience || currentP.totalExperience || level,
                              workExperiences: extracted.workExperiences !== undefined ? extracted.workExperiences : currentP.workExperiences,
                              certifications: extracted.certifications?.length ? extracted.certifications : currentP.certifications,
                            }
                            saveProfile(updatedP)
                            void syncProfileToApi(updatedP)
                            setResumeNote(
                              `Loaded: ${file.name}${extracted.fullName ? ` (${extracted.fullName})` : ''}`,
                            )
                          } catch (err) {
                            console.warn('Resume upload error:', err)
                          }
                        }}
                      />
                    </label>
                  </div>
                  {resumeNote ? (
                    <p
                      style={{
                        margin: '4px 0',
                        fontSize: '0.8rem',
                        color: '#15803d',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <HrIcon name="check" size={14} /> {resumeNote}
                    </p>
                  ) : profile?.resumeName ? (
                    <p
                      style={{
                        margin: '4px 0',
                        fontSize: '0.8rem',
                        color: '#166534',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <HrIcon name="check" size={14} /> File: {profile.resumeName} (
                      {profileSkills.slice(0, 5).join(', ')}
                      {profileSkills.length > 5 ? '…' : ''})
                    </p>
                  ) : (
                    <p style={{ margin: '4px 0', fontSize: '0.8rem', color: '#64748b' }}>
                      Upload your PDF resume so Ava can extract your real name and tailor questions to your projects.
                    </p>
                  )}
                </div>

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
                    {faceBlocks
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <span className={styles.ccTag}>Ava asks · Gemini 2.5 Flash / Luna</span>
                    {question.resumeAnchor && (
                      <span className={styles.resumeAnchorTag} title={question.resumeAnchor}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <HrIcon name="document" size={14} /> Sourced from Resume:{' '}
                          {question.resumeAnchor.length > 38
                            ? `${question.resumeAnchor.slice(0, 38)}…`
                            : question.resumeAnchor}
                        </span>
                      </span>
                    )}
                  </div>
                  <p>{question.text}</p>
                  {!aiSpeaking && <small>{question.hint}</small>}
                </div>

                {/* Candidate Live Speech Captions Overlay */}
                <div className={styles.webcamCaptionsOverlay}>
                  <span className={styles.ccLiveTag}>● LIVE CAPTION</span>
                  <p className={styles.ccLiveText}>
                    {draft.trim() ? `"${draft}"` : listening ? 'Listening... Speak your answer out loud.' : 'Waiting for Ava to finish question...'}
                  </p>
                </div>

                <div className={styles.youLabel}>
                  <span>You · live</span>
                  {listening && <em>Speaking</em>}
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

            <aside className={styles.sidePanel}>
              <div className={styles.panelHead}>
                <h3>Live transcript</h3>
                <span>{wordCount} words</span>
              </div>
              <div className={styles.panelBody}>
                <p>
                  {draft.trim() ||
                    (aiSpeaking
                      ? 'Ava is asking — speak anytime or click "Next Question" to continue.'
                      : speechSupported
                        ? 'Live transcript. Pause ~2.5s or click "Submit & Next" when finished.'
                        : 'Speech unavailable in this browser. Type your answer.')}
                </p>
                {(showTypeFallback || !speechSupported) && (
                  <textarea
                    className={styles.typeFallback}
                    value={draft}
                    rows={4}
                    placeholder="Type your answer…"
                    onChange={(e) => {
                      setDraft(e.target.value)
                      draftRef.current = e.target.value
                      lastSpeechAtRef.current = Date.now()
                    }}
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
              </div>
            </aside>

            <footer className={styles.dock}>
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
                    onClick={() => (listening ? stopListening() : startListening({ duringTts: true }))}
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

              {Boolean(draft.trim()) && !advancing && (
                <button
                  type="button"
                  className={styles.skipLinkBtn}
                  onClick={() => void submitAnswer(true)}
                  title="Skip this question and move to next"
                >
                  Skip Question
                </button>
              )}

              <motion.button
                type="button"
                className={draft.trim() ? styles.nextBtnPrimary : styles.nextBtnSecondary}
                onClick={() => void submitAnswer(false)}
                disabled={!canSubmit}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {advancing
                  ? 'Loading next question…'
                  : draft.trim()
                    ? 'Submit Answer →'
                    : 'Skip Question →'}
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
              onContinue={() => {
                sessionStorage.removeItem('hireright.returnToWizard')
                if (fromWizard) {
                  sessionStorage.setItem('hireright.wizardStep', '5')
                  navigate('/onboarding')
                } else {
                  navigate('/jobs')
                }
              }}
            />

            {/* Verification & Proctoring Audit Logs */}
            {(recordingUrl || (result.integrity?.logs && result.integrity.logs.length > 0)) && (
              <div style={{ marginTop: '24px', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '24px', textAlign: 'left', boxShadow: '0 2px 8px rgba(15,23,42,0.04)' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', marginBottom: '14px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <HrIcon name="shield-check" size={22} /> Proctoring Verification &amp; Session
                    Recording
                  </span>
                </h3>
                {recordingUrl && (
                  <video
                    className={styles.recordingPreview}
                    src={recordingUrl}
                    controls
                    controlsList="nodownload"
                    disablePictureInPicture
                    playsInline
                    style={{ width: '100%', maxHeight: '360px', borderRadius: '12px', background: '#000', marginBottom: '16px' }}
                  />
                )}
                {result.integrity?.logs && result.integrity.logs.length > 0 && (
                  <div>
                    <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
                      Proctoring Audit Logs ({result.integrity.logs.length})
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                      {result.integrity.logs.map((log) => (
                        <div
                          key={log.id}
                          style={{
                            background: log.severity === 'ban' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(37, 99, 235, 0.06)',
                            border: `1px solid ${log.severity === 'ban' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(37, 99, 235, 0.15)'}`,
                            padding: '8px 12px',
                            borderRadius: '8px',
                            fontSize: '0.78rem',
                            color: log.severity === 'ban' ? '#dc2626' : '#1e293b',
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>[{log.formattedTime}]</span> {log.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
