# Local secrets (team handoff)

**Do not commit real credentials.** Use a single file: **`.env` at the repo root** (copy from [`.env.example`](../.env.example)).

Remove any legacy files if they still exist on your machine:

- `backend/node/.env`
- `frontend/.env`
- `backend/python/.env`

Run `npm run check:env` to verify.

## Required for Node API + Neon

```env
DATABASE_URL=postgresql://...@ep-....neon.tech/neondb?sslmode=require
SESSION_SECRET=at_least_32_random_characters
GEMINI_API_KEY=AIza...
CORS_ORIGINS=http://localhost:5173
```

## Optional Vite vars (same `.env`, `VITE_` prefix)

```env
VITE_API_URL=
VITE_AUTH_PROVIDER=api
```

See [env/README.md](../env/README.md) and [DATABASE.md](./DATABASE.md).
