-- Migration A — 0064_normalize_meal_plan_recipe_refs.sql
-- Purpose:
--   Normalise legacy colon recipe refs in meal_plans.recipe_id:
--     official:<n> -> official_<n>
--     user:<n>     -> user_<n>
--   ONLY when <n> is a positive integer with no leading zero.
--   Every other format (bare numbers, other prefixes, malformed refs) is left
--   untouched and is deliberately NOT guessed.
--
-- Expected row count (production baseline 2026-11-10):
--   rows matching ^(official|user):[1-9][0-9]*$ = 112
--   first run: updated = 112, residual colon = 0
--   rerun:     updated = 0,   residual colon = 0 (idempotent)
--
-- DRY-RUN — run BEFORE applying (must show 112 for colon_positive_no_leading_zero):
--   SELECT CASE
--            WHEN recipe_id ~ '^(official|user):[1-9][0-9]*$' THEN 'colon_positive_no_leading_zero'
--            WHEN recipe_id ~ '^(official|user):' THEN 'colon_other_kept'
--            WHEN recipe_id ~ '^[0-9]+$' THEN 'bare_number_kept'
--            ELSE 'other_kept'
--          END AS format,
--          count(*) AS rows
--     FROM meal_plans
--    GROUP BY 1
--    ORDER BY 1;
--
-- VERIFICATION — run AFTER applying:
--   SELECT count(*) AS residual_colon
--     FROM meal_plans
--    WHERE recipe_id ~ '^(official|user):[1-9][0-9]*$';  -- must be 0
--   Re-run the dry-run query: colon_other_kept / bare_number_kept / other_kept
--   counts must be unchanged from before.
--
-- ROLLBACK — only rows written by this migration (uses the backup table below):
--   UPDATE meal_plans mp
--      SET recipe_id = b.old_recipe_id
--     FROM _migration_0064_meal_plan_ref_backup b
--    WHERE mp.id = b.meal_plan_id
--      AND mp.recipe_id = b.new_recipe_id;
--   -- Keep the backup table until verification is signed off.
--   -- Drop it manually afterwards: DROP TABLE _migration_0064_meal_plan_ref_backup;
--
-- Idempotent: a second run backs up 0 rows and updates 0 rows.

CREATE TABLE IF NOT EXISTS "_migration_0064_meal_plan_ref_backup" (
  "meal_plan_id" integer PRIMARY KEY,
  "old_recipe_id" text NOT NULL,
  "new_recipe_id" text NOT NULL,
  "migrated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
DECLARE
  before_count integer;
  after_count integer;
  backup_inserted integer;
  updated_count integer;
BEGIN
  SELECT count(*) INTO before_count
    FROM meal_plans
   WHERE recipe_id ~ '^(official|user):[1-9][0-9]*$';

  INSERT INTO "_migration_0064_meal_plan_ref_backup" (meal_plan_id, old_recipe_id, new_recipe_id)
  SELECT id,
         recipe_id,
         regexp_replace(recipe_id, '^(official|user):', '\1_')
    FROM meal_plans
   WHERE recipe_id ~ '^(official|user):[1-9][0-9]*$'
  ON CONFLICT (meal_plan_id) DO NOTHING;
  GET DIAGNOSTICS backup_inserted = ROW_COUNT;

  UPDATE meal_plans
     SET recipe_id = regexp_replace(recipe_id, '^(official|user):', '\1_')
   WHERE recipe_id ~ '^(official|user):[1-9][0-9]*$';
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  SELECT count(*) INTO after_count
    FROM meal_plans
   WHERE recipe_id ~ '^(official|user):[1-9][0-9]*$';

  RAISE NOTICE '[0064] meal_plans colon refs before=% after=% updated=% backed_up=% (expected before=112 on first run, 0 on rerun)',
    before_count, after_count, updated_count, backup_inserted;

  IF after_count <> 0 THEN
    RAISE EXCEPTION '[0064] residual colon refs after update: %', after_count;
  END IF;
END $$;
