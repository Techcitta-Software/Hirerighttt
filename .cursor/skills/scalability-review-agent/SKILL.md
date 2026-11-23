---
name: scalability-review-agent
description: >-
  System-design review for 100k+ MAU: DB pooling, pagination, polling, LLM limits, caching,
  horizontal scale. Use for scalability audits or before load testing.
---

# Scalability Review Agent

## Hot paths (read first)

- `backend/app/db/uow.py`, `backend/app/db/store.py`, `backend/app/db/finders.py`
- `backend/app/dispatch/api_dispatch.py` — `/api/jobs`, `/api/interview/start`, vendor applicants
- `backend/app/services/gemini_client.py`
- `frontend/src/lib/requestCache.ts`, `sharedPoller.ts`, notification polling intervals

## System-design checklist (100k+ MAU)

1. **Stateless API** — session in Postgres/Redis; no sticky sessions required.
2. **Connection budget** — `containers × workers × DB_POOL_MAX` < DB max; use PgBouncer/RDS Proxy.
3. **Pagination** — mandatory `limit` + keyset on jobs, applicants, org candidates (no full in-memory lists).
4. **LLM admission** — global concurrency + queue; interview start must not block all workers.
5. **Caching** — shared Redis for rate limits, open-job summaries, ETags; not per-process only.
6. **Polling → push** — replace 20–90s polls with SSE/WebSocket where possible; jitter + pause hidden tabs.
7. **Read replicas** — job board, search, reports on replica; writes on primary.
8. **CDN / S3** — static assets and large artifacts off API workers.
9. **Background jobs** — scoring, ranking, email, alerts via SQS/worker pool.
10. **Observability** — pool wait, p95 latency, Gemini quota errors, saturation alerts.

## Iteration protocol (3 rounds)

1. **Map** — Document current strengths and bottlenecks with file references.
2. **Prioritize** — Top 10 changes: quick wins vs medium-term.
3. **Verify** — Confirm quick wins landed or tickets filed; re-check hot paths.

## Output

Structured report: strengths, bottlenecks, top 10 actions, quick vs medium, what already exists.