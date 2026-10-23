# HireRighttt

End-to-end AI hiring product: candidate onboarding, live AI video interview, ranked job matches, employer ATS, and admin pipeline.

**Architecture & agent notes:** [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md) · **Database (Neon SaaS):** [docs/DATABASE.md](docs/DATABASE.md) · **Environment:** [env/README.md](env/README.md)

## Demo accounts

| Role | Email | Password |
|------|--------|----------|
| Job seeker | `demo@hireright.com` | `password123` |
| Employer | `employer@hireright.com` | `password123` |

## Run locally

```bash
cp .env.example .env    # edit DATABASE_URL + GEMINI_API_KEY
npm install             # also downloads Playwright Chromium (~300MB) for scorecard PDFs
npm run dev:all
```

`npm install` runs `backend/node` `postinstall` and installs Chromium so the API can write HireRight report PDFs to S3. Skip with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Retry later with `npm run playwright:install-chromium`.

- App: http://localhost:5173
- API: http://localhost:8787/api/health

Use **one** config file: `.env` at the **repo root** (not under `frontend/` or `backend/node/`).

## Product loop

1. **Candidate** signs up → profile → Ava AI interview → jobs → apply.
2. **Employer** signs up → workspace (tenant) → jobs → share `/apply/{code}` → review scores.
3. **Admin ATS** (`/admin`) → pipeline and analytics.

## Stack

- React 19 + TypeScript + Vite
- **Node API** (`backend/node`) — auth, Neon Postgres, AI interview (default: `npm run dev:all`)
- **FastAPI** (`backend/python`) — optional; reads the same root `.env`

---

## Production

| Requirement | Purpose |
|-------------|---------|
| **Neon PostgreSQL** | `DATABASE_URL` with `?sslmode=require` |
| **SESSION_SECRET** | 32+ random characters |
| **CORS_ORIGINS** | Exact frontend URL(s) |
| **GEMINI_API_KEY** | Server-side interview, resume, scoring |

```bash
cp .env.production.example .env   # fill secrets at repo root
docker compose -f docker-compose.prod.yml up -d --build
```

See `.env.example` and `.env.production.example` for all variables.
