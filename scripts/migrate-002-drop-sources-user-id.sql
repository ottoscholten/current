-- Migration 002: drop sources.user_id
-- sources are shared across all users — subscriptions are handled via user_source_prefs
-- Run in the Supabase SQL editor: https://supabase.com/dashboard/project/zhjplsklqkuccfxagsrf/sql

ALTER TABLE sources DROP COLUMN IF EXISTS user_id;

-- Confirm final sources schema:
-- id, name, url, type, is_platform, selectors, is_active, last_synced_at

-- Confirm user_source_prefs schema (user-source link):
-- user_id (→ profiles.id), source_id (→ sources.id), is_active, last_synced_at
