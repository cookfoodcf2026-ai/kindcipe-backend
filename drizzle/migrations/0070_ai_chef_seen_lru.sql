-- 0070_ai_chef_seen_lru.sql
-- AI_CHEF_SEEN_LRU: keep a cumulative serve count per family+name and index the
-- LRU read path (family_id, seen_at). DO NOT APPLY until the flag rollout is
-- approved; the app keeps legacy behaviour while AI_CHEF_SEEN_LRU is unset.
--
-- DRY-RUN before applying:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'ai_chef_seen_recipes';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'ai_chef_seen_recipes';

ALTER TABLE "ai_chef_seen_recipes"
  ADD COLUMN IF NOT EXISTS "seen_count" integer NOT NULL DEFAULT 1;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_chef_seen_recipes_family_seen_at_idx"
  ON "ai_chef_seen_recipes" USING btree ("family_id", "seen_at");
