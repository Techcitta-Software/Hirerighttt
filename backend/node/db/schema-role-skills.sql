-- Role → skills map for adaptive interviews (mirrors backend/node/data/roleSkills.json)
CREATE TABLE IF NOT EXISTS role_skill_library (
  role_key text PRIMARY KEY,
  display_role text NOT NULL,
  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'seed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_skill_library_display_role_lower_idx
  ON role_skill_library (lower(display_role));
