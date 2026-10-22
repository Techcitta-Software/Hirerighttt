-- Read-only migration blockers. Returns aggregate counts, never candidate content.
-- Run on the existing public schema. Any nonzero result requires investigation.
SELECT 'application_job_tenant_mismatch' AS issue, count(*) AS rows
FROM public.employer_applications a JOIN public.jobs j ON j.id=a.job_id
WHERE a.organization_id IS DISTINCT FROM j.organization_id
UNION ALL
SELECT 'applications_without_candidate_id', count(*) FROM public.employer_applications WHERE candidate_user_id IS NULL
UNION ALL
SELECT 'profile_missing_identity', count(*) FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email)=lower(p.email))
UNION ALL
SELECT 'case_insensitive_email_collisions', count(*) FROM (
 SELECT lower(email) FROM public.users GROUP BY lower(email) HAVING count(*)>1
) duplicates
UNION ALL
SELECT 'session_column_json_tenant_disagreement', count(*) FROM public.interview_sessions
WHERE NULLIF(data->>'organizationId','') IS DISTINCT FROM organization_id
UNION ALL
SELECT 'recording_unknown_session', count(*) FROM public.interview_recordings r
WHERE NOT EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.session_id=r.interview_id)
  AND NOT EXISTS (SELECT 1 FROM public.assessment_sessions s WHERE s.id::text=r.interview_id)
UNION ALL
SELECT 'file_missing_bucket', count(*) FROM public.stored_files WHERE bucket IS NULL OR bucket=''
UNION ALL
SELECT 'artifact_missing_bucket', count(*) FROM public.interview_artifacts WHERE bucket IS NULL OR bucket=''
UNION ALL
SELECT 'recording_missing_bucket', count(*) FROM public.interview_recordings WHERE bucket IS NULL OR bucket=''
UNION ALL
SELECT 'non_array_review_events', count(*) FROM public.interview_sessions
WHERE data ? 'reviewEvents' AND jsonb_typeof(data->'reviewEvents') <> 'array';
