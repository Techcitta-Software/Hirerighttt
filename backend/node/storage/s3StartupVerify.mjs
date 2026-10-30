import { HeadBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { s3Env, s3StorageConfigured } from './s3ObjectStorage.mjs'

/** @returns {import('@aws-sdk/client-s3').S3ClientConfig['credentials'] | undefined} */
function s3CredentialsFromEnv() {
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim()
  const sessionToken = (process.env.AWS_SESSION_TOKEN || '').trim()
  if (!accessKeyId || !secretAccessKey) return undefined
  return sessionToken
    ? { accessKeyId, secretAccessKey, sessionToken }
    : { accessKeyId, secretAccessKey }
}

function createVerifyClient(region) {
  const credentials = s3CredentialsFromEnv()
  return new S3Client(credentials ? { region, credentials } : { region })
}

function formatAwsError(err) {
  if (!(err instanceof Error)) return String(err)
  const aws = /** @type {{ Code?: string; name?: string; $metadata?: { httpStatusCode?: number } }} */ (err)
  const code = aws.Code || aws.name || 'Error'
  const http = aws.$metadata?.httpStatusCode
  return http ? `${code} (HTTP ${http}): ${err.message}` : `${code}: ${err.message}`
}

/** Key under users/ — matches IAM policies scoped to arn:aws:s3:::BUCKET/users/* */
function startupProbeObjectKey() {
  return 'users/.system/.hireright/startup-probe'
}

/**
 * Confirms the configured bucket is reachable with credentials from env.
 * Uses HeadObject on a users/* probe (404 = OK) so object-scoped IAM without s3:ListBucket still passes.
 *
 * @returns {Promise<{ bucket: string, region: string } | null>}
 */
export async function verifyConfiguredS3Bucket() {
  if (!s3StorageConfigured()) return null
  const { bucket, region } = s3Env()
  const expectedBucket = (process.env.S3_EXPECTED_BUCKET || '').trim()
  if (expectedBucket && expectedBucket !== bucket) {
    throw new Error(
      `S3_BUCKET="${bucket}" does not match S3_EXPECTED_BUCKET="${expectedBucket}". ` +
        'Fix env so only the intended bucket is used.',
    )
  }

  const creds = s3CredentialsFromEnv()
  if (!creds) {
    throw new Error(
      'S3 is configured (AWS_REGION + S3_BUCKET) but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are missing. ' +
        'Set them in Render Environment or repo-root .env.',
    )
  }

  const client = createVerifyClient(region)
  const probeKey = startupProbeObjectKey()

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: probeKey }))
    // Object exists — still proves bucket + credentials work
    return { bucket, region }
  } catch (headErr) {
    const http = headErr?.$metadata?.httpStatusCode
    const code = headErr?.Code || headErr?.name
    if (code === 'NotFound' || http === 404) {
      return { bucket, region }
    }

    // Some accounts allow object IAM but not HeadBucket — try bucket-level only as fallback
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }))
      return { bucket, region }
    } catch (bucketErr) {
      const detail = formatAwsError(headErr)
      const bucketDetail = formatAwsError(bucketErr)
      throw new Error(
        `Cannot access S3 bucket "${bucket}" in ${region} with current AWS credentials. ` +
          `Probe HeadObject on "${probeKey}" failed (${detail}). ` +
          `HeadBucket fallback failed (${bucketDetail}). ` +
          'Ensure IAM allows s3:GetObject (HeadObject) and s3:PutObject on arn:aws:s3:::BUCKET/users/* ' +
          'and that AWS_REGION matches the bucket region. ' +
          'On Render, paste keys without extra quotes; + and = in secrets must be exact.',
      )
    }
  }
}
