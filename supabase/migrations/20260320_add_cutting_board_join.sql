-- Cut-finder cuts synced from local analysis (Model B)
CREATE TABLE IF NOT EXISTS cf_cuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  analysis_local_id TEXT NOT NULL,
  video_id TEXT,
  cut_index INTEGER NOT NULL,
  timestamp REAL NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  diff_score REAL NOT NULL,
  intent_tags JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (machine_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_cuts_video_id ON cf_cuts (video_id) WHERE video_id IS NOT NULL;

-- Joined records from both models
CREATE TABLE IF NOT EXISTS cutting_board_joined (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL,
  timestamp REAL NOT NULL,
  model_a_id BIGINT,
  model_b_id UUID,
  matched BOOLEAN NOT NULL DEFAULT false,
  merged_tags JSONB DEFAULT '[]'::jsonb,
  model_a_rating TEXT,
  model_b_confidence TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cbj_video_id ON cutting_board_joined (video_id);
