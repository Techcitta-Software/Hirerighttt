# Operations guide

## Environment variables (new)
| Variable | Purpose |
|---|---|
| `REDIS_URL` | Shared rate limiter across API instances. Unset = per-process in-memory limiter. Redis outages fail open. |
| `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | Error tracking. No PII or request bodies are sent. |
| `LOG_LEVEL` | Default `INFO`. Production logs are one JSON line each, carrying `request_id`. |
| `AUDIT_RETENTION_DAYS` | Audit rows older than this are deleted (default 730). |
| `RECORDING_RETENTION_DAYS` | Interview recordings/reports older than this are deleted from S3 and the database. Unset = keep. |
| `TEST_DATABASE_URL` | Local/CI Postgres for the DB tests. Neon URLs are refused unless `ALLOW_REMOTE_TEST_DB=1`. |
| `CRON_SECRET` | Guards `/api/internal/*` (reminders, maintenance). |

`ALLOW_DEMO_ACCOUNTS` must not be set in production; the API refuses to start if it is.

## DynamoDB (alongside Neon)
* Two tables per env: `hireright-{env}-main` + `hireright-{env}-audit`. Neon is not dropped when these are created.
* Provision: `npm run db:dynamo:init` (or CloudFormation `infra/dynamodb/hireright-tables.yaml`).
* Seed catalog rows: `npm run db:dynamo:seed`
* Copy data from Neon (read-only on Postgres): `npm run db:dynamo:migrate` (optional `--dry-run`).
* Entity map: `backend/app/db/dynamo/neon_entity_map.md`
* Switch runtime later with `DATABASE_PROVIDER` (`neon` | `dual` | `dynamodb`).

## Schema migrations
Add `backend/db/migrations/NNNN_description.sql` (idempotent SQL). They are applied once, in order, at startup /
`python db_init.py`, and recorded in `schema_migrations` with a checksum. Never edit an applied file: startup fails
if its checksum changes. Add a new numbered file instead.

## Backups and restore
* Neon: point-in-time restore from the Neon console (Branches -> Restore). Keep the history window at 7+ days.
* Manual: `pg_dump --format=custom "$DATABASE_URL" > hireright.dump`; restore with `pg_restore --clean --dbname "$TARGET_URL" hireright.dump`.
* S3: enable bucket versioning and a lifecycle rule aligned with `RECORDING_RETENTION_DAYS`.
* Test a restore into a scratch database at least once per quarter.

## Retention and data deletion
The `Data maintenance` GitHub workflow calls `POST /api/internal/maintenance` daily. It always removes expired
sessions and reset tokens, and applies the audit/recording retention periods above. Each run is itself audited
(`retention.purged`). For a candidate's delete-on-request, delete their rows and S3 objects under their tenant
prefix, then record the action in `audit_logs`.

## Single-instance caveat
The API holds its working dataset in process memory and persists it to Postgres, so run **one** API instance.
Scaling out needs that cache replaced with direct queries first.

## Deploys
`CI` runs on every push/PR (with a Postgres service). Render and Vercel deploy only from `main`, only after CI succeeds.
