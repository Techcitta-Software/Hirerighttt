# Neon → DynamoDB entity map

Neon Postgres stays online. DynamoDB uses **two physical tables** per environment:

| Physical table | Purpose |
|----------------|---------|
| `{prefix}-{env}-main` | All domain entities (single-table design) |
| `{prefix}-{env}-audit` | `audit_logs`, `assessment_events` (append-only, TTL) |

Default prefix: `hireright`. Example prod: `hireright-prod-main`, `hireright-prod-audit`.

## Main table keys (PK / SK)

| Neon table | PK | SK | GSI usage |
|------------|----|----|-----------|
| `subscription_plans` | `PLATFORM` | `PLAN#<id>` | — |
| `organizations` | `ORG#<id>` | `META` | Gsi1 `SLUG#<slug>` → org |
| `organization_subscriptions` | `ORG#<id>` | `ORG_SUBSCRIPTION` | — |
| `users` | `USER#<id>` | `META` | Gsi1 `EMAIL#<email>` → user |
| `organization_members` | `ORG#<id>` | `MEMBER#<userId>` | query by org PK |
| `organization_invites` | `ORG#<id>` | `INVITE#<id>` | — |
| `profiles` | `USER#<id>` or `EMAIL#<email>` | `PROFILE` | Gsi1 email |
| `jobs` | `ORG#<id>` | `JOB#<jobId>` | Gsi2 `SHARE#<code>`; Gsi2 org job index |
| `employer_applications` | `ORG#<id>` | `APP#<id>` | Gsi3 org timeline |
| `job_applications` | `EMAIL#<email>` | `JOBAPP#<id>` | Gsi3 candidate timeline |
| `interview_results` | `EMAIL#<email>` | `INTERVIEW_RESULT` | Gsi3 org results |
| `interview_result_history` | `EMAIL#<email>` | `INTERVIEW_HIST#<uuid>` | — |
| `interview_sessions` | `EMAIL#<email>` | `INTERVIEW_SESS#<sessionId>` | — |
| `confidential_candidates` | `ORG#<id>` | `VAULT#<id>` | — |
| `hireright_sessions` | `SESSION#<token>` | `META` | TTL `expires_at` |
| `password_reset_tokens` | `RESET#<sha256>` | `META` | TTL `expires_at` |
| `interview_invites` | `ORG#<id>` or `EMAIL#<email>` | `INTERVITE#<token>` | Gsi4 `INVTOKEN#<token>` |
| `candidate_talent_profiles` | `USER#<id>` | `TALENT_PROFILE` | Gsi4 `TALENT#<visibility>` |
| `organization_talent_access` | `ORG#<id>` | `TALENT_ACCESS#<userId>` | — |
| `recruiter_saved_searches` | `ORG#<id>` | `SAVED_SEARCH#<id>` | — |
| `stored_files` | `EMAIL#<email>` or `USER#<id>` | `FILE#<id>` | — |
| `interview_recordings` | `TENANT#<tenantId>` | `RECORDING#<id>` | — |
| `interview_artifacts` | `TENANT#<tenantId>` | `ARTIFACT#<id>` | — |
| `role_skill_library` | `PLATFORM` | `ROLE_SKILL#<role_key>` | — |
| `assessment_*` | `ORG#<id>` or `USER#<id>` | `ASSESS#<type>#<id>` | — |

`data` attribute holds remaining columns (Neon JSONB / scalars), same shape as a Postgres row minus keys inlined above.

## Audit table keys

| Neon table | PK | SK |
|------------|----|----|
| `audit_logs` | `ORG#<id>` or `PLATFORM` | `AUDIT#<isoTime>#<uuid>` |
| `assessment_events` | `ORG#<id>` | `AUDIT#<isoTime>#<id>` |

Set `ttl` from `AUDIT_RETENTION_DAYS` / `DYNAMODB_AUDIT_TTL_DAYS` for automated expiry (mirrors Neon retention job).

## Global secondary indexes (main)

| Index | Partition | Sort | Access pattern |
|-------|-----------|------|----------------|
| Gsi1 | `gsi1pk` | `gsi1sk` | Email → user, slug → org |
| Gsi2 | `gsi2pk` | `gsi2sk` | Share code → job, org → jobs by status |
| Gsi3 | `gsi3pk` | `gsi3sk` | Org applications timeline, candidate applications |
| Gsi4 | `gsi4pk` | `gsi4sk` | Invite token lookup, talent marketplace browse |

## Switching the API (later)

1. `DATABASE_PROVIDER=neon` — current behavior (default).
2. `DATABASE_PROVIDER=dual` — keep Neon authoritative; optional dual-write (implement in `store.py` when ready).
3. `DATABASE_PROVIDER=dynamodb` — read/write DynamoDB only (after parity testing).

`DATABASE_URL` remains required for `neon` and `dual`; for `dynamodb` alone you can omit it once the app layer is wired.