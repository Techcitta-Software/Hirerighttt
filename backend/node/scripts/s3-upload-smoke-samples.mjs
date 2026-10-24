/**
 * Upload labeled sample objects to the configured S3 bucket (repo-root .env).
 * Objects are LEFT in the bucket so you can verify layout + AWS account in the S3 console.
 *
 *   node backend/node/scripts/s3-upload-smoke-samples.mjs
 *   npm run s3:smoke-samples
 */
import { loadEnv } from '../loadEnv.mjs'
import { verifyConfiguredS3Bucket } from '../storage/s3StartupVerify.mjs'
import {
  buildS3UserMetadata,
  describeS3Layout,
  S3_OBJECT_PURPOSES,
} from '../storage/s3Namespace.mjs'
import {
  buildCandidateResumeObjectKey,
  buildInterviewReportObjectKey,
  buildInterviewRecordingObjectKey,
  buildInterviewTranscriptObjectKey,
} from '../storage/s3KeyLayout.mjs'
import { defaultS3ObjectStorage, s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

loadEnv()

const SMOKE_TENANT = 'platform'
const SMOKE_CANDIDATE = 'smoke-verification'
const SMOKE_SESSION = 'smoke-session-demo'

if (!s3StorageConfigured()) {
  console.error('[s3-smoke] Set AWS_REGION + S3_BUCKET in repo-root .env')
  process.exit(1)
}

async function main() {
  const { bucket, region } = s3Env()
  console.log('[s3-smoke] layout version:', describeS3Layout().version)
  console.log('[s3-smoke] target bucket:', bucket)
  console.log('[s3-smoke] region:', region)
  try {
    console.log('[s3-smoke] verifying bucket access (HeadBucket)…')
    await verifyConfiguredS3Bucket()
    console.log('[s3-smoke] HeadBucket OK\n')
  } catch (headErr) {
    console.warn(
      '[s3-smoke] HeadBucket skipped (add s3:ListBucket on the bucket if you want this check):',
      headErr instanceof Error ? headErr.message : headErr,
    )
    console.warn('[s3-smoke] Continuing with PutObject uploads…\n')
  }

  const s3 = defaultS3ObjectStorage
  const uploaded = []

  const resumeKey = buildCandidateResumeObjectKey({
    tenantId: SMOKE_TENANT,
    candidateId: SMOKE_CANDIDATE,
    originalFilename: 'sample-resume.pdf',
    versionNumber: 1,
  })
  await s3.uploadObject({
    key: resumeKey,
    buffer: Buffer.from('%PDF-1.4\nHireRight S3 smoke sample — resume (safe to delete)\n'),
    contentType: 'application/pdf',
    metadata: buildS3UserMetadata({
      purpose: S3_OBJECT_PURPOSES.resume,
      tenantId: SMOKE_TENANT,
      candidateId: SMOKE_CANDIDATE,
    }),
  })
  uploaded.push({ kind: 'resume', key: resumeKey })

  const transcriptKey = buildInterviewTranscriptObjectKey({
    tenantId: SMOKE_TENANT,
    interviewId: SMOKE_SESSION,
    candidateId: SMOKE_CANDIDATE,
  })
  const transcriptBody = {
    smoke: true,
    message: 'Sample transcript JSON — real interviews store Q&A here in S3 only',
    sessionId: SMOKE_SESSION,
    questions: ['Sample question?'],
    answers: ['Sample answer.'],
  }
  await s3.uploadObject({
    key: transcriptKey,
    buffer: Buffer.from(JSON.stringify(transcriptBody, null, 2), 'utf8'),
    contentType: 'application/json',
    metadata: buildS3UserMetadata({
      purpose: S3_OBJECT_PURPOSES.interview_transcript,
      tenantId: SMOKE_TENANT,
      candidateId: SMOKE_CANDIDATE,
      interviewId: SMOKE_SESSION,
    }),
  })
  uploaded.push({ kind: 'transcript', key: transcriptKey })

  const reportKey = buildInterviewReportObjectKey({
    tenantId: SMOKE_TENANT,
    interviewId: SMOKE_SESSION,
    candidateId: SMOKE_CANDIDATE,
  })
  await s3.uploadObject({
    key: reportKey,
    buffer: Buffer.from('%PDF-1.4\nHireRight S3 smoke sample — scorecard PDF (safe to delete)\n'),
    contentType: 'application/pdf',
    metadata: buildS3UserMetadata({
      purpose: S3_OBJECT_PURPOSES.interview_report,
      tenantId: SMOKE_TENANT,
      candidateId: SMOKE_CANDIDATE,
      interviewId: SMOKE_SESSION,
    }),
  })
  uploaded.push({ kind: 'report', key: reportKey })

  const recordingKey = buildInterviewRecordingObjectKey({
    tenantId: SMOKE_TENANT,
    interviewId: SMOKE_SESSION,
    candidateId: SMOKE_CANDIDATE,
    contentType: 'video/webm',
    originalFilename: 'sample.webm',
  })
  const webm = Buffer.alloc(320, 0)
  webm.write('webm-smoke-sample', 0)
  await s3.uploadObject({
    key: recordingKey,
    buffer: webm,
    contentType: 'video/webm',
    metadata: buildS3UserMetadata({
      purpose: S3_OBJECT_PURPOSES.interview_recording,
      tenantId: SMOKE_TENANT,
      candidateId: SMOKE_CANDIDATE,
      interviewId: SMOKE_SESSION,
    }),
  })
  uploaded.push({ kind: 'recording', key: recordingKey })

  console.log('[s3-smoke] Uploaded', uploaded.length, 'sample objects (not deleted):\n')
  for (const u of uploaded) {
    console.log(`  ${u.kind.padEnd(12)} s3://${bucket}/${u.key}`)
  }
  console.log('\n[s3-smoke] In AWS Console → S3 →', bucket, '→ prefix tenants/platform/candidates/smoke-verification/')
  console.log('[s3-smoke] Confirm the account ID in the console matches your NEW AWS account.')
  console.log('[s3-smoke] Neon only stores pointers in stored_files / interview_artifacts / interview_recordings after real uploads — this script does not write Neon.')
}

main().catch((err) => {
  console.error('[s3-smoke] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
