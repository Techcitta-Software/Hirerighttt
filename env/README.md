# Environment

HireRight uses **one** secrets file: **`.env` at the repository root**.

- Node API (`backend/node`) loads it via `env/loadEnv.mjs`.
- Vite (`frontend`) reads `VITE_*` from the same file (`envDir` in `vite.config.ts`).
- Python API reads the same path when configured in `backend/python/app/config.py`.

Do **not** create `backend/node/.env`, `frontend/.env`, or `backend/python/.env`.

Copy [`.env.example`](../.env.example) to `.env` and fill in `DATABASE_URL`, `SESSION_SECRET`, and `GEMINI_API_KEY`.

Verify: `npm run check:env` from the repo root.
