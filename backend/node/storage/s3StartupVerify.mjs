import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { s3Env, s3StorageConfigured } from './s3ObjectStorage.mjs'

/**
 * Confirms the configured bucket is reachable with credentials from repo-root .env.
 * The app never uses Neon `bucket` columns for SDK calls — only S3_BUCKET + object_key.
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
        'Fix repo-root .env so only the new bucket is used.',
    )
  }
  const client = new S3Client({ region })
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Cannot access S3 bucket "${bucket}" in ${region} with current AWS credentials. ` +
        'If you moved to a new AWS account, update S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, ' +
        'AWS_SECRET_ACCESS_KEY in repo-root .env and restart the API. ' +
        `(AWS: ${detail})`,
    )
  }
  return { bucket, region }
}
