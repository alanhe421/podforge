CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  duration INTEGER NOT NULL,
  style TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL,
  error TEXT,
  script TEXT,
  audio_key TEXT,
  input_keys TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
