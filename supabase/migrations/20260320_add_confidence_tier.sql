-- Add confidence_tier to cutting_board_joined
ALTER TABLE cutting_board_joined
  ADD COLUMN IF NOT EXISTS confidence_tier TEXT NOT NULL DEFAULT 'low';

-- Index for future fine-tuning queries that filter/weight by tier
CREATE INDEX IF NOT EXISTS idx_cbj_confidence_tier
  ON cutting_board_joined (confidence_tier);

-- Backfill existing rows
UPDATE cutting_board_joined SET confidence_tier = CASE
  WHEN matched = true  AND jsonb_array_length(COALESCE(merged_tags, '[]'::jsonb)) > 0 THEN 'high'
  WHEN matched = true  AND jsonb_array_length(COALESCE(merged_tags, '[]'::jsonb)) = 0 THEN 'medium'
  WHEN matched = false AND jsonb_array_length(COALESCE(merged_tags, '[]'::jsonb)) > 0 THEN 'medium'
  ELSE 'low'
END;
