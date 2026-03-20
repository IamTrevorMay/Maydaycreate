-- Add video_id to sessions table (cut-watcher model)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS video_id TEXT;

-- Add video_id to cut_records table (denormalized from session for easier joins)
ALTER TABLE cut_records ADD COLUMN IF NOT EXISTS video_id TEXT;

-- Add video_id index on cut_records for cross-model joins
CREATE INDEX IF NOT EXISTS idx_cut_records_video_id ON cut_records (video_id) WHERE video_id IS NOT NULL;

-- Add video_id index on sessions
CREATE INDEX IF NOT EXISTS idx_sessions_video_id ON sessions (video_id) WHERE video_id IS NOT NULL;
