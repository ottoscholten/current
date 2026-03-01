-- Migration 001: multi-user schema
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/zhjplsklqkuccfxagsrf/sql

-- 1. profiles table
--    id will map to auth.users.id once login is added.
--    For now, insert a row manually and store the UUID as USER_ID in .env
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taste_profile TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Extend sources table
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS is_platform BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_id UUID,  -- null for platform sources
  ADD COLUMN IF NOT EXISTS selectors JSONB; -- future: CSS selectors for custom scraping

-- Mark all existing sources as platform integrations
UPDATE sources SET is_platform = TRUE WHERE is_platform IS FALSE OR is_platform IS NULL;

-- 3. user_source_prefs — joins users to platform sources (their subscriptions)
--    Not needed for custom sources (those have user_id set directly on sources row)
CREATE TABLE IF NOT EXISTS user_source_prefs (
  user_id UUID NOT NULL,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, source_id)
);

-- 4. Add user_id to events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- Notes:
-- - user_id FKs to auth.users will be added when login is wired up
-- - After running this, insert your profile row and copy the UUID into .env as USER_ID:
--     INSERT INTO profiles (taste_profile) VALUES ('your taste profile here') RETURNING id;
