# HireRighttt

**Frontend** (`frontend/`) · **Backend** (`backend/`) · **Database** (Neon Postgres, SQL in `backend/db/sql/`)

## Run locally

```bash
cp .env.example .env          # set DATABASE_URL, API keys
npm install
npm run db:init               # once — creates tables
npm run dev:all               # Vite :5173 + API :8787
```

- App: http://localhost:5173  
- API: http://localhost:8787/api/health  

One **repo-root `.env`** for Vite and Python (`env/README.md`).

## Demo logins (`ALLOW_DEMO_ACCOUNTS=true`, after `db:init`)

| Email | Password |
|-------|----------|
| `demo@hireright.com` | `password123` |
| `employer@hireright.com` | `password123` |

## Commands

| npm script | Purpose |
|------------|---------|
| `dev:all` | Frontend + API |
| `dev:backend` | API only |
| `db:init` / `db:verify` | Postgres schema |
| `build` | Frontend production build |
