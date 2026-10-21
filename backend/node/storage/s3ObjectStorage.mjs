import { randomUUID } from 'node:crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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
 * @param {string} ownerEmail
 * @param {string} purpose
 * @param {string} originalFilename
 */
export function buildObjectKey(ownerEmail, purpose, originalFilename) {
  const safeEmail = String(ownerEmail || 'user')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
  const baseName = String(originalFilename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  const extMatch = baseName.match(/(\.[a-z0-9]{1,8})$/i)
  const ext = extMatch ? extMatch[1].toLowerCase() : ''
  const id = randomUUID()
  return `${purpose}/${safeEmail}/${id}${ext}`
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
    const client = getClient()
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata,
      }),
    )
    return { bucket, key }
  }

  async function presignDownload({ key, responseContentDisposition }) {
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

  return { uploadObject, presignDownload, deleteObject, headObject }
}

export const defaultS3ObjectStorage = createS3ObjectStorage()
