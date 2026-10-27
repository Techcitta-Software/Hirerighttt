import { createS3ObjectStorage, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'
import { buildFlagSnapshotS3Key } from '../storage/s3KeyLayout.mjs'

/**
 * Upload flag JPEG snapshots to S3 and return structured proctoring summary for JSONB storage.
 * @param {{ tenantId?: string, sessionId: string, flaggedSections?: Array<Record<string, unknown>> }} opts
 */
export async function persistProctoringFlags(opts) {
  const tenantId = opts.tenantId || 'platform'
  const sessionId = String(opts.sessionId || '').trim()
  const flaggedSections = Array.isArray(opts.flaggedSections) ? opts.flaggedSections : []
  const storage = s3StorageConfigured() ? createS3ObjectStorage() : null
  const processedFlags = []

  for (const flag of flaggedSections) {
    if (!flag || typeof flag !== 'object') continue
    let snapshotS3Key = flag.snapshotS3Key ? String(flag.snapshotS3Key) : null
    const flagId = String(flag.id || `flag_${processedFlags.length + 1}`)

    const dataUrl = typeof flag.snapshotDataUrl === 'string' ? flag.snapshotDataUrl : ''
    if (storage && dataUrl.startsWith('data:image/jpeg;base64,')) {
      const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      snapshotS3Key = buildFlagSnapshotS3Key({ tenantId, sessionId, flagId })
      await storage.uploadObject({
        key: snapshotS3Key,
        buffer,
        contentType: 'image/jpeg',
      })
    }

    const { snapshotDataUrl: _drop, ...cleanFlag } = flag
    processedFlags.push({
      ...cleanFlag,
      id: flagId,
      snapshotS3Key,
    })
  }

  const lookSideCount = processedFlags.filter((f) => f.type === 'LOOKING_SIDE').length
  const multiFaceCount = processedFlags.filter((f) => f.type === 'MULTI_FACE').length
  const noFaceCount = processedFlags.filter((f) => f.type === 'NO_FACE').length

  const integrityScore = Math.max(
    0,
    100 - lookSideCount * 5 - multiFaceCount * 15 - noFaceCount * 8,
  )

  return {
    integrityScore,
    status: multiFaceCount > 0 || integrityScore < 70 ? 'FLAGGED' : 'CLEAR',
    counts: {
      total: processedFlags.length,
      lookingSide: lookSideCount,
      multiplePeople: multiFaceCount,
      noFace: noFaceCount,
    },
    flaggedSections: processedFlags,
  }
}
