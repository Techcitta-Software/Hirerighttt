import { randomUUID } from 'node:crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { buildCandidateResumeObjectKey, sanitizePathSegment } from './s3KeyLayout.mjs'
import { assertWritableTenantObjectKey, buildS3UserMetadata } from './s3Namespace.mjs'

export { buildS3UserMetadata, describeS3Layout } from './s3Namespace.mjs'

export { buildCandidateResumeObjectKey, sanitizePathSegment }

export function s3Env() {
  const region = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim()
  const bucket = (process.env.S3_BUCKET || '').trim()
  const presignSeconds = Number(process.env.S3_PRESIGN_EXPIRES_SECONDS || 900)
  return {
    region,
    bucket,
    presignSeconds: Number.isFinite(presignSeconds) && presignSeconds > 0 ? presignSeconds : 900,
  }
}

export function s3StorageConfigured() {
  const { region, bucket } = s3Env()
  return Boolean(region && bucket)
}

/**
 * Legacy key layout (pre-tenant). New uploads use buildCandidateResumeObjectKey.
 * @deprecated
 */
export function buildObjectKey(ownerEmail, purpose, originalFilename) {
  const safeEmail = sanitizePathSegment(String(ownerEmail || 'user').toLowerCase())
  const ext = extensionFromLegacyFilename(originalFilename)
  const id = randomUUID()
  return `${purpose}/${safeEmail}/${id}${ext}`
}

function extensionFromLegacyFilename(filename) {
  const baseName = String(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  const extMatch = baseName.match(/(\.[a-z0-9]{1,8})$/i)
  return extMatch ? extMatch[1].toLowerCase() : ''
}

/**
 * @param {{ getClient?: () => import('@aws-sdk/client-s3').S3Client }} [options]
 */
export function createS3ObjectStorage(options = {}) {
  const getClient =
    options.getClient ||
    (() => {
      const { region } = s3Env()
      return new S3Client({ region })
    })

  async function uploadObject({ key, buffer, contentType, metadata = {} }) {
    const { bucket } = s3Env()
    if (!bucket) {
      const err = new Error('S3_BUCKET is not configured.')
      err.status = 503
      throw err
    }
    const safeKey = assertWritableTenantObjectKey(key)
    const client = getClient()
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: safeKey,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata,
        ServerSideEncryption: 'AES256',
      }),
    )
    return { bucket, key: safeKey }
  }

  async function presignUpload({ key, contentType, contentLength, metadata = {} }) {
    const { bucket, presignSeconds } = s3Env()
    if (!bucket) {
      const err = new Error('S3_BUCKET is not configured.')
      err.status = 503
      throw err
    }
    const safeKey = assertWritableTenantObjectKey(key)
    const client = getClient()
    // Do not set ServerSideEncryption here — browser PUT must send matching x-amz-* headers
    // or S3 returns SignatureDoesNotMatch. Bucket default encryption still applies when enabled.
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: safeKey,
      ContentType: contentType,
      ContentLength: contentLength,
      ...(Object.keys(metadata).length ? { Metadata: metadata } : {}),
    })
    const url = await getSignedUrl(client, command, { expiresIn: presignSeconds })
    return { url, expiresInSeconds: presignSeconds, method: 'PUT', key: safeKey }
  }

  async function presignDownload({ key, responseContentDisposition, responseContentType }) {
    const { bucket, presignSeconds } = s3Env()
    if (!bucket) {
      const err = new Error('S3_BUCKET is not configured.')
      err.status = 503
      throw err
    }
    const client = getClient()
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
      ...(responseContentType ? { ResponseContentType: responseContentType } : {}),
    })
    const url = await getSignedUrl(client, command, { expiresIn: presignSeconds })
    return { url, expiresInSeconds: presignSeconds }
  }

  async function deleteObject({ key }) {
    const { bucket } = s3Env()
    if (!bucket) return
    const client = getClient()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  }

  async function headObject({ key }) {
    const { bucket } = s3Env()
    if (!bucket) return null
    const client = getClient()
    try {
      const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return out
    } catch (err) {
      if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null
      throw err
    }
  }

  return { uploadObject, presignUpload, presignDownload, deleteObject, headObject }
}

export const defaultS3ObjectStorage = createS3ObjectStorage()
