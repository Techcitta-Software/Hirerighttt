/**
 * Build proctoring summary for JSONB storage. Does not upload or persist camera snapshots.
 * @param {{ tenantId?: string, sessionId: string, flaggedSections?: Array<Record<string, unknown>> }} opts
 */
export async function persistProctoringFlags(opts) {
  const flaggedSections = Array.isArray(opts.flaggedSections) ? opts.flaggedSections : []
  const processedFlags = []

  for (const flag of flaggedSections) {
    if (!flag || typeof flag !== 'object') continue
    const flagId = String(flag.id || `flag_${processedFlags.length + 1}`)
    const { snapshotDataUrl: _dropUrl, snapshotS3Key: _dropKey, ...cleanFlag } = flag
    void _dropUrl
    void _dropKey
    processedFlags.push({
      ...cleanFlag,
      id: flagId,
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
