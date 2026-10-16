# Structured assessment backend

Implemented from the backend/database portions of `chatgpt-backend.md`. The existing Node API remains the primary server; the optional Python API and frontend are unchanged. New routes use the existing Bearer authentication and `users`, `organizations`, and `organization_members` records.

## Architecture and boundaries

`routes.mjs` handles HTTP, `service.mjs` owns workflow, `repository.mjs` handles PostgreSQL transactions and authorization, `contracts.mjs` validates model/input data and computes scores, `provider.mjs` provides the replaceable AI boundary, and `prompts.mjs` versions the prompts. `quickResponses.mjs` handles simple interactions without AI calls. PDF/DOCX extraction runs in a memory-limited worker with a 15-second deadline.

The new tables in `db/schema-assessment.sql` are additive. They deliberately avoid the legacy in-memory snapshot store: saving an old profile or interview cannot overwrite an assessment. Job competencies and approved question rubrics are immutable once the interview starts. Questions, answers, evaluations, reviews, reports, and events are stored separately. Competencies and rubric anchors are validated JSON within the job/question records rather than duplicate standalone entities. Tenant-owned sessions have composite foreign keys to the matching tenant's plan and job.

## Setup

Use the existing repository-root `.env`. No secrets belong in this directory.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
GEMINI_API_KEY=YOUR_PROVIDER_KEY
ASSESSMENT_PLAN_MODEL=YOUR_CONFIGURED_MODEL
ASSESSMENT_EVALUATION_MODEL=YOUR_CONFIGURED_MODEL
MAX_REQUEST_BYTES=3000000
ALLOW_DEMO_ACCOUNTS=false
```

Model overrides are optional; existing model settings are reused. The provider supports Gemini native JSON mode and OpenAI-compatible JSON mode, including the existing OpenRouter key/base URL configuration. It makes at most two attempts, with a 30-second deadline per attempt. Invalid model output returns a controlled error; it never invents a successful evaluation. Provider response schemas are validated locally. Exact evidence excerpts are required, but human review is still needed to assess semantic grounding and question quality.

From the repository root:

```text
npm run db:init
npm run db:verify
npm run dev:backend
npm --prefix backend/node test
```

Schema application is also performed once at API startup. Back up a deployed database before applying migrations. Live Neon migrations and paid provider requests were not run during implementation.

## API workflow

All paths below begin `/api/assessments`. All require `Authorization: Bearer <token>`. JSON is used throughout. The UI has not been connected to these routes.

1. Recruiter: `POST /jobs` with `organization_id`, `title`, `description`, `experience_level`, and seven `competencies`. Each competency has `id`, `name`, `requirement`, and positive `weight`; weights total 100. The same job competencies are reused across candidates. Only tenant owners, admins, and recruiters can create jobs or review assessments; viewers cannot.
2. Candidate: `POST /resumes` with `filename` and `file_base64` (no data-URL prefix). Accepts text-based PDF and DOCX, up to 2 MB, 30 PDF pages, and 100,000 extracted characters. Returns extracted text for correction. Scanned PDFs require an external OCR step; no fabricated OCR result is returned.
3. Candidate: `POST /resumes/text` with `filename` and corrected `text` saves a new resume version. Optional `POST /resumes/{resume_id}/analyze` returns validated, source-quoted skills, experience, projects, education, certifications, achievements, tools, and uncertainty flags. `DELETE /resumes/{resume_id}` removes an owned resume.
4. Candidate: `POST /generate` with `job_id`, `resume_id`, and `consent:true`. Consent authorizes sharing the resulting assessment with that job's organization. Generates and saves seven questions once, returning `session_id`, `plan_id`, and `version`. Recruiter approval is required; no hidden rubric is returned to the candidate.
5. Recruiter: `GET /{session_id}/plan` previews questions/rubrics. `POST /{session_id}/approve` with `version` approves them. Optional `questions` replaces the full seven-question plan after validation. Changes cannot be made after starting.
6. Candidate: `POST /{session_id}/start` with `version`. `GET /{session_id}` recovers state, saved answers, and the exact current question after reconnection. `pause` and `start` pause/resume without changing the question.
7. Candidate: `POST /{session_id}/messages` or `/answers` with `message`, `question_id`, `version`, and a unique `request_id`. Reuse the same request ID and content when retrying a lost response. Stale versions/questions or conflicting reuse return 409. Greetings/repetition/apologies/hints/help/thanks return deterministic responses without consuming a question. `POST /{session_id}/repeat-question` requires no body.
8. Candidate: `POST /{session_id}/skip-question` with `confirm:true`, `question_id`, `version`, `request_id`. Skips remain unassessed. `complete` or `cancel` requires `confirm:true` and `version`. The seventh answer completes the session automatically. `transcription_failed:true` rejects an answer without advancing or scoring it.
9. Answer saves commit before evaluation. If AI fails, the response includes `evaluation_status:pending_retry` and `retry_answer_id`. Retry with `POST /{session_id}/retry-evaluation` and `answer_id`. An already evaluated answer is reused. Refresh the session if another request advances it while evaluation is in flight.
10. Recruiter: `GET /?organization_id=...&limit=25&offset=0` lists tenant interviews. `GET /{session_id}/report` or `/export` returns the completed report as authorized JSON, including immutable AI scores, excerpts, rubric/model versions, and review history. Candidates can see their own session/status but cannot retrieve hidden report content.
11. Recruiter: `POST /{evaluation_id}/review` with integer `score:0..4` and nonempty `reason`. Overrides are append-only, do not overwrite the AI evaluation, and trigger report recalculation. Latest review is used per evaluation.

Scores use `sum(score / 4 * weight)`. Missing/skipped/unavailable evaluations yield `overall:null` plus evaluated coverage, not a fabricated zero or a renormalized high score. Reports are decision support, not automated hiring decisions.

## Privacy and deployment limitations

- Original uploaded files stay in memory and are discarded after extraction. Resume rows expire after 30 days and cannot be used after expiry; operators must schedule deletion of expired rows using `DELETE FROM assessment_resumes WHERE expires_at < NOW()`. Deleting a resume does not delete evidence already included in an approved assessment.
- Assessment answers/reports/audit history are retained until an organization-defined retention/deletion policy is implemented. No automatic destructive cleanup is enabled. A complete candidate data-access/deletion administration workflow remains outstanding.
- Follow-ups are disabled in this initial implementation (maximum zero). The suggested follow-up is retained for recruiter review. A separately persisted bounded follow-up workflow remains outstanding.
- Clarification/hints currently provide fixed general guidance. Rich question-specific clarification, optional STT/TTS adapters, and sandboxed coding execution remain outstanding.
- Candidate/recruiter UI integration, administrator management UI/API, configurable per-organization models, background evaluation workers, distributed rate limits, cost pricing and dashboards, PostgreSQL RLS policies, and automated consent/retention administration are not implemented here.
- Legacy `/api/interview/*` endpoints remain compatible and separate. They still use the legacy adaptive/heuristic workflow; they do not become rubric-based assessments merely by deploying these files. Legacy snapshot persistence remains single-process and should not be scaled across replicas. The new transactional assessment routes do not use that cache.
- The API now secures confidential vault routes by tenant, awaits legacy writes, preserves retained job/history links, and upgrades legacy passwords to scrypt on login. Camera telemetry no longer changes legacy scores. Other legacy heuristic scoring remains outside the new validated workflow.
- Tests use synthetic model responses; they do not establish model accuracy, fairness, or immunity to prompt injection. Recruiter approval and human calibration are required before production use. A qualified human-reviewed weak/average/strong answer dataset still needs to be supplied and validated; none is falsely labeled human-reviewed.
- Dependency audit reports three moderate advisories through Mammoth's `argparse` → `sprintf-js` dependency chain (GHSA-hp3w-g68c-fv3c). The reported issue concerns unbounded formatting precision. This backend calls Mammoth's text-extraction library in a bounded worker, not its CLI argument parser. The upstream dependency advisory remains unresolved; the audit's suggested Mammoth downgrade is breaking and was not applied.

## Database integration tests

Set `ASSESSMENT_TEST_DATABASE_URL` to a **disposable local** PostgreSQL server, then run the backend test command. Tests refuse non-loopback hosts, use randomized schemas, and drop only those test schemas. They never default to the live `DATABASE_URL`. Without the test URL, database/HTTP integration tests are explicitly skipped.

Tests cover validation, deterministic intents, grounded excerpts, weighted aggregation, upload limits and extraction, scrypt/legacy password verification, real PostgreSQL lifecycle/recovery, tenant permissions, duplicate answers, provider outages, recruiter overrides, job-history preservation, and HTTP authentication/vault isolation. Live model tests and Docker image execution are separate deployment checks.
