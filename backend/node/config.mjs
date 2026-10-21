/**
 * Production-safe runtime configuration for the Node interview API.
 */
import { loadEnv, envFilePath } from './loadEnv.mjs'

if (!loadEnv()) {
  console.warn(`[config] No ${envFilePath()} — copy .env.example to .env at repo root.`)
}

const env = process.env.ENVIRONMENT || process.env.NODE_ENV || 'development'
export const isProduction = env === 'production'
export const isStaging = env === 'staging'
export const isProdLike = isProduction || isStaging

export const config = {
  environment: env,
  port: Number(process.env.PORT) || 8787,
  corsOrigins: (process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || process.env.SECRET_KEY || '',
  /** Demo logins (demo@ / employer@) only when explicitly enabled — never re-seed after db:purge. */
  allowDemoAccounts: process.env.ALLOW_DEMO_ACCOUNTS === 'true',
  signupEnabled: process.env.SIGNUP_ENABLED !== 'false',
  maxBodyBytes: Number(process.env.MAX_REQUEST_BYTES) || 3_000_000,
  trustProxy: process.env.TRUST_PROXY === 'true' || isProdLike,
}

/** Neon Postgres is mandatory for all environments (no db.json). */
export function assertDatabaseConfig() {
  if (!config.databaseUrl?.trim()) {
    console.error(
      '[config] DATABASE_URL is required.\n' +
        '  Set DATABASE_URL in repo-root .env (see .env.example)\n' +
        '  Example: postgresql://USER:PASS@ep-xxx.region.aws.neon.tech/neondb?sslmode=require\n' +
        '  Then run: npm run db:init',
    )
    process.exit(1)
  }
}

export function assertProductionConfig() {
  assertDatabaseConfig()

  if (!isProdLike) return

  const errors = []
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    errors.push('SESSION_SECRET (or SECRET_KEY) must be at least 32 random characters in production.')
  }
  if (config.corsOrigins.length === 0 || config.corsOrigins.includes('*')) {
    errors.push('Set CORS_ORIGINS to your exact frontend URL(s) — no wildcards in production.')
  }
  const hasLlm =
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.LLM_API_KEY
  if (!hasLlm) {
    errors.push(
      'GEMINI_API_KEY (or OPENAI_API_KEY / OPENROUTER_API_KEY) is required in production.',
    )
  }

  if (errors.length) {
    if (process.env.STRICT_PRODUCTION_CONFIG === 'true') {
      console.error('[config] Production configuration errors (strict mode):\n', errors.map((e) => `  - ${e}`).join('\n'))
      process.exit(1)
    } else {
      console.warn('[config] ⚠️ Production notices / recommendations:\n', errors.map((e) => `  - ${e}`).join('\n'))
      console.warn('[config] Continuing with built-in fallbacks (local storage & local AI agent). To enforce strict failure, set STRICT_PRODUCTION_CONFIG=true.\n')
    }
  }
}
