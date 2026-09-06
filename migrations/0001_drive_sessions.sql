CREATE TABLE IF NOT EXISTS drive_sessions (
  session_hash TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS drive_sessions_expires_at
  ON drive_sessions (expires_at);
