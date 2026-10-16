# HireRight PostgreSQL (Neon)

## Apply schema

From repo root (loads `DATABASE_URL` from `.env`):

```bash
npm run db:init
npm run db:verify
```

The API also runs the same SQL on startup via `store.mjs`.

## Files

| File | Purpose |
|------|---------|
| `schema.sql` | SaaS core: users, orgs, billing, jobs, profiles, interviews, vault |
| `schema-talent-search.sql` | Employer candidate search (FTS + skills) |
| `schema-assessment.sql` | Saved plans, transactional sessions, answers, rubric evaluations, reviews, audit events |
| `applySchema.mjs` | Single entry — all schema files in order |
| `store.mjs` | Load/save app state to these tables |
| `talentIndex.mjs` | `candidate_talent_profiles` upsert + search queries |

## Code ↔ table map

| Feature | Tables |
|---------|--------|
| Login / signup | `users`, `hireright_sessions` |
| Employer workspace | `organizations`, `organization_members`, `organization_subscriptions` |
| Candidate profile | `profiles` → sync → `candidate_talent_profiles` |
| AI interview | `interview_sessions`, `interview_results`, `interview_result_history` |
| Apply to jobs | `job_applications`, `employer_applications` |
| Vendor job posts | `jobs` |
| Vendor search talent | `candidate_talent_profiles`, `organization_talent_access` |
| Resume vault | `confidential_candidates` (per `organization_id`) |

See [docs/DATABASE.md](../../../docs/DATABASE.md) for the legacy model and [structured assessment API](../assessment/README.md) for the new workflow and its limitations.
