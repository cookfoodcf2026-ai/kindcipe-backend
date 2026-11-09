-- Migration B — 0065_backfill_shopping_from_meal_plan.sql
-- Purpose:
--   Backfill shopping_items.from_recipe_id from the linked meal plan.
--   Only use meal_plans.recipe_id when it is canonical (official_<n>/user_<n>).
--   Link by (meal_plans.id, family_id) only. No recipe-name matching anywhere.
--   Rows whose plan ref is missing or non-canonical keep their current value.
--
-- Expected row count (production baseline 2026-11-10):
--   rows updatable by this migration = 95
--   first run: updated = 95, rows with canonical plan but non-canonical link = 0
--   rerun:     updated = 0  (idempotent)
--
-- DRY-RUN — run BEFORE applying:
--   -- by orphan status (all shopping items that have a meal plan link)
--   SELECT CASE
--            WHEN si.from_recipe_id IS NULL THEN 'orphan_null'
--            WHEN si.from_recipe_id ~ '^(official|user)_[1-9][0-9]*$' THEN 'canonical'
--            ELSE 'orphan_non_canonical'
--          END AS link_status,
--          count(*) AS rows
--     FROM shopping_items si
--    WHERE si.from_meal_plan_id IS NOT NULL
--    GROUP BY 1
--    ORDER BY 1;
--
--   -- exact rows this migration will update (expected 95)
--   SELECT count(*) AS will_update
--     FROM shopping_items si
--     JOIN meal_plans mp
--       ON si.from_meal_plan_id = mp.id
--      AND si.family_id = mp.family_id
--    WHERE mp.recipe_id ~ '^(official|user)_[1-9][0-9]*$'
--      AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*$');
--
-- VERIFICATION — run AFTER applying (must be 0):
--   SELECT count(*) AS canonical_plan_noncanonical_link
--     FROM shopping_items si
--     JOIN meal_plans mp
--       ON si.from_meal_plan_id = mp.id
--      AND si.family_id = mp.family_id
--    WHERE mp.recipe_id ~ '^(official|user)_[1-9][0-9]*$'
--      AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*$');
--
-- ROLLBACK — only rows written by this migration (uses the backup table below):
--   UPDATE shopping_items si
--      SET from_recipe_id = b.old_from_recipe_id
--     FROM _migration_0065_shopping_ref_backup b
--    WHERE si.id = b.shopping_item_id
--      AND si.from_recipe_id = b.new_from_recipe_id;
--   -- Keep the backup table until verification is signed off.
--   -- Drop it manually afterwards: DROP TABLE _migration_0065_shopping_ref_backup;
--
-- Idempotent: rerun updates 0 rows because canonical links are excluded.

CREATE TABLE IF NOT EXISTS "_migration_0065_shopping_ref_backup" (
  "shopping_item_id" integer PRIMARY KEY,
  "old_from_recipe_id" text,
  "new_from_recipe_id" text NOT NULL,
  "migrated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
DECLARE
  before_orphans integer;
  updatable_before integer;
  backup_inserted integer;
  updated_count integer;
  after_violations integer;
BEGIN
  SELECT count(*) INTO before_orphans
    FROM shopping_items si
   WHERE si.from_meal_plan_id IS NOT NULL
     AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*$');

  SELECT count(*) INTO updatable_before
    FROM shopping_items si
    JOIN meal_plans mp
      ON si.from_meal_plan_id = mp.id
     AND si.family_id = mp.family_id
   WHERE mp.recipe_id ~ '^(official|user)_[1-9][0-9]*$'
     AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*$');

  INSERT INTO "_migration_0065_shopping_ref_backup" (shopping_item_id, old_from_recipe_id, new_from_recipe_id)
  SELECT si.id,
         si.from_recipe_id,
         mp.recipe_id
    FROM shopping_items si
    JOIN meal_plans mp
      ON si.from_meal_plan_id = mp.id
     AND si.family_id = mp.family_id
   WHERE mp.recipe_id ~ '^(official|user)_[1-9][0-9]*$'
     AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*$')
  ON CONFLICT (shopping_item_id) DO NOTHING;
  GET DIAGNOSTICS backup_inserted = ROW_COUNT;

  UPDATE shopping_items si
     SET from_recipe_id = mp.recipe_id
    FROM meal_plans mp
   WHERE si.from_meal_plan_id = mp.id
     AND si.family_id = mp.family_id
     AND mp.recipe_id ~ '^(official|user)_[1-9][0-9]*$'
     AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*$');
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  SELECT count(*) INTO after_violations
    FROM shopping_items si
    JOIN meal_plans mp
      ON si.from_meal_plan_id = mp.id
     AND si.family_id = mp.family_id
   WHERE mp.recipe_id ~ '^(official|user)_[1-9][0-9]*$'
     AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*$');

  RAISE NOTICE '[0065] shopping orphan/canonical-mismatch before=% updatable=% updated=% backed_up=% after_violations=% (expected updatable=95 first run, 0 rerun)',
    before_orphans, updatable_before, updated_count, backup_inserted, after_violations;

  IF after_violations <> 0 THEN
    RAISE EXCEPTION '[0065] rows with canonical plan but non-canonical link: %', after_violations;
  END IF;
END $$;
