-- Add structured taste tags column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS taste_parsed JSONB DEFAULT '[]';
