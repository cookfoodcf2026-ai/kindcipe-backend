WITH legacy_imports AS (
  SELECT family_id, year_month, SUM(count)::int AS total
  FROM "import_usage"
  GROUP BY family_id, year_month
), new_import_events AS (
  SELECT family_id, year_month, SUM(imports)::int AS total
  FROM "usage_events"
  WHERE kind = 'import' AND status = 'consumed'
  GROUP BY family_id, year_month
)
UPDATE "family_usage_monthly" monthly
SET
  "ai_credits" = monthly."ai_credits" + GREATEST(
    0,
    COALESCE(legacy_imports.total, 0) - COALESCE(new_import_events.total, 0)
  ),
  "updated_at" = now()
FROM legacy_imports
LEFT JOIN new_import_events
  ON new_import_events.family_id = legacy_imports.family_id
 AND new_import_events.year_month = legacy_imports.year_month
WHERE monthly.family_id = legacy_imports.family_id
  AND monthly.year_month = legacy_imports.year_month;
