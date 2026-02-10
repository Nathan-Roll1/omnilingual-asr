-- Add session_key column to scope transcripts per user
ALTER TABLE transcripts ADD COLUMN session_key TEXT;

-- Index for fast lookups by session
CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_key);
