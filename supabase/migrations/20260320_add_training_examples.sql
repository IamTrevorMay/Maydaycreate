CREATE TABLE IF NOT EXISTS training_examples (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id     TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  edit_type      TEXT NOT NULL,
  quality        TEXT NOT NULL,
  weight         DOUBLE PRECISION NOT NULL,
  context        JSONB NOT NULL,
  action         JSONB NOT NULL,
  timestamp      BIGINT NOT NULL,
  pushed_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(machine_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_training_examples_quality ON training_examples(quality);
