ALTER TABLE "ai_chef_meal_state"
  ADD COLUMN IF NOT EXISTS "avoid" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "scenarios" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "last_miss" jsonb,
  ADD COLUMN IF NOT EXISTS "pending_ask" jsonb;
