ALTER TABLE assets ADD COLUMN IF NOT EXISTS moderation_version integer NOT NULL DEFAULT 1;
