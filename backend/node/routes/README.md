# HTTP routes (Express)

| File | Mount | Endpoints |
|------|--------|-----------|
| `registerRoutes.mjs` | — | Wires all routers on the Express app |
| `health.routes.mjs` | `/api` | `GET /health` |
| `plans.routes.mjs` | `/api` | `GET /plans` |
| `mail.routes.mjs` | `/api` | `GET /mail/status` |
| `organization.routes.mjs` | `/api` | `GET /organization` |
| `llm.routes.mjs` | `/api` | `GET /llm-status` |
| `auth.routes.mjs` | `/api` | `POST /signup`, `/login`, `/logout`, `GET /me`, `PUT /profile` |
| `apiDispatch.mjs` | `/` | Jobs, vendor, interview, resume, talent, confidential vault, SPA fallback |
| `../assessment/routes.mjs` | (middleware) | `/api/assessments/*` |

Shared dependencies live in `server/appContext.mjs` (DB cache, auth, JSON/CORS helpers).
