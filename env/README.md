# Environment

Copy **`.env.example`** → **`.env`** at the **repo root** (one file for Vite + Python).

Required for full app behavior:

- `DATABASE_URL` — Neon PostgreSQL connection string  
- `SESSION_SECRET` — 32+ random characters (production)  

Common optional keys: `GEMINI_API_KEY`, `S3_BUCKET`, `AWS_*`, `SMTP_EMAIL` / `RESEND_API_KEY`.

Python loads env via `app/load_env.py`. Vite reads `VITE_*` from the same file (`envDir` = repo root).
