-- OmniTranscribe D1 schema
-- Stores transcripts, segments, and edit history

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  summary TEXT,
  detected_languages TEXT, -- JSON array
  audio_key TEXT           -- R2 object key for audio file
);

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  speaker TEXT,
  content TEXT,
  start_time REAL NOT NULL DEFAULT 0,
  end_time REAL NOT NULL DEFAULT 0,
  language TEXT,
  language_code TEXT,
  languages TEXT, -- JSON array of {name, code}
  emotion TEXT DEFAULT 'neutral',
  translation TEXT,
  words TEXT,     -- JSON array of word-level data (if available)
  UNIQUE(transcript_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_segments_transcript ON segments(transcript_id);

CREATE TABLE IF NOT EXISTS edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  segment_sort_order INTEGER,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_edits_transcript ON edits(transcript_id);
