/**
 * API smoke: start session → next question → score → recording upload-url.
 * Usage (API running): node backend/node/scripts/test-interview-api-flow.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import { defaultS3ObjectStorage, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

loadEnv()

const base = `http://127.0.0.1:${process.env.PORT || 8787}`

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

const health = await req('/api/health')
if (!health.res.ok) {
  console.error('[interview-flow] API not running at', base)
  process.exit(1)
}

const stamp = Date.now()
const email = `interview.flow.${stamp}@example.test`
const password = 'InterviewFlow1!'

const signup = await req('/api/signup', {
  method: 'POST',
  body: {
    name: 'Interview Flow',
    email,
    password,
    phone: `+9197${String(stamp).slice(-8)}`,
    role: 'jobseeker',
  },
})
if (signup.res.status !== 201 || !signup.data.token) {
  console.error('[interview-flow] signup failed', signup.res.status, signup.data.error)
  process.exit(1)
}
const token = signup.data.token

const start = await req('/api/interview/start', {
  method: 'POST',
  token,
  body: { role: 'fullstack', level: 'mid', consent: true },
})
if (!start.res.ok || !start.data.sessionId) {
  console.error('[interview-flow] start failed', start.res.status, start.data.error)
  process.exit(1)
}
const sessionId = start.data.sessionId
console.log('[interview-flow] session started', sessionId.slice(0, 8) + '…')

const q0 = start.data.questions?.[0]
if (!q0?.text) {
  console.error('[interview-flow] no first question')
  process.exit(1)
}

const turn = await req('/api/interview/turn', {
  method: 'POST',
  token,
  body: {
    sessionId,
    role: 'fullstack',
    level: 'mid',
    question: q0,
    answer: 'I built a React dashboard with measurable latency wins and owned the API layer.',
    questionIndex: 0,
    totalQuestions: 6,
  },
})
if (!turn.res.ok) {
  console.error('[interview-flow] turn failed', turn.res.status, turn.data.error)
  process.exit(1)
}

const answerText =
  'I built a React dashboard with measurable latency wins and owned the API layer.'
const next = await req('/api/interview/next', {
  method: 'POST',
  token,
  body: {
    sessionId,
    role: 'fullstack',
    level: 'mid',
    history: [],
    lastQuestion: q0,
    lastAnswer: answerText,
  },
})
if (!next.res.ok) {
  console.error('[interview-flow] next failed', next.res.status, next.data.error)
  process.exit(1)
}
if (next.data.complete) {
  console.log('[interview-flow] next returned complete (unexpected on turn 1)')
} else if (next.data.question?.text) {
  console.log('[interview-flow] next question OK')
}

const uploadUrl = await req('/api/interview/recordings/upload-url', {
  method: 'POST',
  token,
  body: {
    sessionId,
    filename: 'flow_smoke.webm',
    contentType: 'video/webm',
    fileSize: 512,
  },
})
if (uploadUrl.res.status === 503 && uploadUrl.data.skipped) {
  console.log('[interview-flow] recording upload-url skipped (S3 off)')
} else if (!uploadUrl.res.ok || !uploadUrl.data.uploadUrl) {
  console.error('[interview-flow] upload-url failed', uploadUrl.res.status, uploadUrl.data.error)
  process.exit(1)
} else {
  const put = await fetch(uploadUrl.data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': uploadUrl.data.contentType || 'video/webm' },
    body: Buffer.alloc(512, 0),
  })
  if (!put.ok) {
    console.error('[interview-flow] S3 PUT failed', put.status, await put.text().catch(() => ''))
    process.exit(1)
  }
  const complete = await req('/api/interview/recordings/complete', {
    method: 'POST',
    token,
    body: {
      sessionId,
      recordingId: uploadUrl.data.recordingId,
      durationSeconds: 1,
    },
  })
  if (!complete.res.ok) {
    console.error('[interview-flow] recording complete failed', complete.res.status, complete.data.error)
    process.exit(1)
  }
  const objectKey = complete.data.objectKey || uploadUrl.data.objectKey
  console.log('[interview-flow] recording S3 path OK', objectKey)

  if (s3StorageConfigured() && objectKey) {
    const head = await defaultS3ObjectStorage.headObject({ key: objectKey })
    if (!head) {
      console.error('[interview-flow] S3 HeadObject: object missing after complete —', objectKey)
      process.exit(1)
    }
    console.log(
      '[interview-flow] S3 HeadObject OK —',
      head.ContentLength,
      'bytes,',
      head.ContentType || 'video/webm',
    )
  }

  const playback = await req(
    `/api/interview/recordings/playback?sessionId=${encodeURIComponent(sessionId)}`,
    { token },
  )
  if (!playback.res.ok || !playback.data.playbackUrl) {
    console.error(
      '[interview-flow] candidate playback failed',
      playback.res.status,
      playback.data.error,
    )
    process.exit(1)
  }
  console.log('[interview-flow] candidate playback URL OK (presigned GET)')
}

const score = await req('/api/interview/score', {
  method: 'POST',
  token,
  body: {
    sessionId,
    role: 'fullstack',
    level: 'mid',
    questions: [q0],
    answers: ['I built a React dashboard with measurable latency wins and owned the API layer.'],
    integrity: { faceViolations: 0, singlePersonOk: true, maxFacesSeen: 1 },
  },
})
if (!score.res.ok || !score.data.interview) {
  console.error('[interview-flow] score failed', score.res.status, score.data.error)
  process.exit(1)
}

console.log('[interview-flow] score OK overall=', score.data.interview.overall)
console.log('[interview-flow] All interview API checks passed.')
