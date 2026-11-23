---
name: full-stack-test-agent
description: >-
  Run the full HireRighttt test matrix (frontend Vitest + backend pytest) and report
  pass/fail. Use when asked to "test the code entirely", regression sweeps, or before release.
---

# Full-Stack Test Agent

## Scope

Repository root: `HireRighttt-backend` (monorepo).

| Suite | Command | Working directory |
|-------|---------|-------------------|
| Frontend | `npm test -- --run` | `frontend/` |
| Backend | `python -m pytest -q --tb=short` | `backend/` |

Set `TEST_DATABASE_URL` (or `DATABASE_URL`) so DB integration tests are not skipped (see `ci.yml`).

## Iteration protocol (3 rounds)

1. **Baseline** — Run both suites; capture counts and top failures.
2. **Fix loop** — Triage failures; fix or skip with reason; re-run affected files.
3. **Sign-off** — Full suites green; note skipped DB tests if env missing.

## Report format

```markdown
## Test sign-off (iteration N/3)
- Frontend: X files, Y tests passed / Z failed
- Backend: passed / failed / skipped
- Blockers: ...
- Commands run: ...
```

## Do not

- Commit `.env` or rotate secrets as part of testing.
- Change product behavior unless fixing a failing test.