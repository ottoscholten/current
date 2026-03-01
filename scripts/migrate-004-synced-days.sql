-- Add synced_days to track which dates have been fetched per user+source.
-- This replaces the delete-all-and-reinsert sync model with a per-day append model.
-- Past unsaved events are cleaned up on each sync run instead.

ALTER TABLE user_source_prefs
  ADD COLUMN IF NOT EXISTS synced_days jsonb NOT NULL DEFAULT '[]'::jsonb;
