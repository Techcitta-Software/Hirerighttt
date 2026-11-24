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

## Scaling out (Postgres / Aurora)
Each HTTP request gets its own unit of work (`app/db/uow.py`): it loads only the rows it touches through indexed
queries (`app/db/finders.py`) and `save_db` writes only the rows that changed. Nothing is shared in process memory,
so run as many workers and containers as needed behind a load balancer.

* `WEB_CONCURRENCY`: worker processes per container (default 2; about 2 x vCPUs).
* `DB_POOL_MAX`: connections per worker (default 10). Total connections = containers x workers x `DB_POOL_MAX`;
  keep it under the database limit, or put RDS Proxy / PgBouncer in front.
* `REDIS_URL`: required with more than one instance, so rate limits are shared.
* A log line `Full table load of <table>` means some code path iterated a whole table; give it a finder.
* Measured locally (100,000 users, one laptop): API memory 81 MB, flat, regardless of user count (was about 1 GB);
  startup 1.9 s (was 9.9 s); a profile save 28 ms (it never finished before); `/api/me` 400 req/s with 4 workers.

## Deploys
`CI` runs on every push/PR (with a Postgres service). The live path is Vercel for the site and Render for the API.

* Frontend: Vercel project `hire-rightt`, branch `dev1`. `https://hire-rightt.vercel.app`. `/api/*` is forwarded to the Render API. `VITE_API_URL` is set on the Vercel project. Build with `VITE_AUTH_PROVIDER=api` (see `.env.production`).
* API: Render service `https://hireright-backend-0pgv.onrender.com`, branch `main`. `render.yaml` records that service. Set `DATABASE_URL`, `SESSION_SECRET`, `CORS_ORIGINS` (the Vercel origin), `PUBLIC_APP_URL`, `GEMINI_API_KEY`, and the S3/SMTP values in the Render dashboard. `ALLOW_DEMO_ACCOUNTS` stays false.
