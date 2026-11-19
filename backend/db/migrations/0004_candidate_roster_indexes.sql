-- Vendor candidate roster (app/services/vendor/org_candidates.py): newest job seekers, joined to their profile and
-- interview result by case-insensitive email. Without these the join compared lower(email) row by row (a full scan
-- of profiles / interview_results per user) and the role filter could not use idx_users_role.
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON profiles (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_interview_results_email_lower ON interview_results (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_jobseeker_created ON users (created_at DESC)
  WHERE LOWER(COALESCE(role, 'jobseeker')) = 'jobseeker';
