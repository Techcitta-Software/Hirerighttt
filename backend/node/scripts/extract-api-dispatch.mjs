import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const nodeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = path.join(nodeDir, 'index.mjs')
const lines = fs.readFileSync(indexPath, 'utf8').split(/\r?\n/)
const start = lines.findIndex((l) => l.includes('app.use(async (req, res) =>'))
const end = lines.findIndex((l, i) => i > start && l === '})')
const body = lines.slice(start + 1, end).join('\n')

const header = `import { randomBytes } from 'node:crypto'
import { evaluateResumeAgainstJd, generateVendorAssessmentSheet, vendorReportNeedsRefresh } from '../vendor/aiEvaluation.mjs'
import { pingDatabase, appendInterviewHistory, upsertJobRecord, deleteJobRecord, dbPool, loadDb as reloadDbFromStore } from '../db/store.mjs'
import { smtpConfigured, smtpConfigSummary, verifySmtpConnection, publicAppOrigin } from '../mail.mjs'
import { sendMail } from '../mail.mjs'
import { groqWhisperConfigured, transcribeWithGroqWhisper } from '../groqWhisper.mjs'
import { supabaseStorageConfigured, uploadResumeToSupabase } from '../resumeStorage.mjs'
import {
  newInviteToken,
  insertInterviewInvite,
  getInterviewInviteByToken,
  inviteAccessState,
  sendInterviewInviteEmail,
  invitePublicUrl,
  inviteJoinWindowEnd,
  INVITE_JOIN_WINDOW_MINUTES,
  buildInterviewInviteEmail,
  parseInviteContext,
} from '../interviewInvites.mjs'
import {
  upsertCandidateTalent,
  searchCandidateTalent,
  getCandidateTalentById,
  grantOrganizationTalentAccess,
} from '../db/talentIndex.mjs'
import {
  createVendorJob,
  deleteVendorJob,
  resolvePublicJob,
  parsePublicJobPath,
  listOrgJobs,
  listOpenJobs,
  listOpenJobsPage,
  publicJobListPayload,
  getOrgJob,
  getOrgApplication,
  createJobApplication,
  listJobApplications,
  updateApplicationInterview,
  publicJobPayload,
} from '../vendor/jobs.mjs'
import { listJobCandidates, listOrganizationCandidates } from '../vendor/orgCandidates.mjs'
import {
  generateAdaptiveQuestion,
  generateAdaptiveQuestionLocal,
  analyzeInterviewSkillMatch,
  resolveInterviewQuestionMode,
  INTERVIEW_TURN_COUNT,
  generateInterviewTurn,
  getInterviewInteractiveFlowJson,
  processInterviewInteractive,
  llmConfigured,
  publicModelConfig,
  geminiKeyFormatWarning,
  parseResumeWithAI,
  summarizeProfile,
  scoreInterviewSession,
} from '../interviewAgent.mjs'
import { geminiChat, resolveGeminiApiKey } from '../geminiClient.mjs'
import { isGeminiProvider } from '../llmModels.mjs'

/** @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx */
export function createApiDispatchMiddleware(ctx) {
  const {
    config,
    PORT,
    json,
    readBody,
    rateLimit,
    clientIp,
    requireAuth,
    registerSession,
    loadDb,
    saveDb,
    setDbCache,
    tenantContextForUser,
    requireEmployerTenant,
    mergeInterviewProfile,
    mergeTurnIntoInterviewHistory,
    buildEmployerInviteContext,
    buildJobSeekerInviteContext,
    runPaddleOcrParser,
    serveSpaStatic,
    assessmentHandler,
    personalizedHandler,
    authHelpers,
  } = ctx
  const {
    hashPassword,
    verifyPassword,
    registerAccount,
    UniqueAccountError,
    validateEmployerSignup,
    loginRoleMismatchMessage,
    normalizePhone,
    isValidPhoneInput,
    findUserByPhone,
    deleteSessionToken,
  } = authHelpers

  return async function apiDispatch(req, res) {
`

const footer = `
  }
}
`

let transformed = body
  .replace(/\bdbCache\b/g, 'ctx.getDbCache()')
  .replace(/loadDbFromStore/g, 'reloadDbFromStore')
  .replace(/ctx\.getDbCache\(\)\.users/g, 'loadDb().users')

// Fix: dbCache assignments should use setDbCache
transformed = transformed.replace(
  /setDbCache\(await reloadDbFromStore\(config\.databaseUrl\)\)/g,
  'setDbCache(await reloadDbFromStore(config.databaseUrl))',
)

// Original had dbCache = await loadDbFromStore - fix pattern
transformed = transformed.replace(
  /ctx\.getDbCache\(\) = await reloadDbFromStore\(config\.databaseUrl\)/g,
  'setDbCache(await reloadDbFromStore(config.databaseUrl))',
)

// vault uses dbCache.users - use loadDb()
transformed = transformed.replace(
  /const user = ctx\.getDbCache\(\)\.users\.find/g,
  'const user = loadDb().users.find',
)

const outPath = path.join(nodeDir, 'routes', 'apiDispatch.mjs')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, header + transformed + footer)
console.log('Wrote', outPath, 'lines', (header + transformed + footer).split('\n').length)
