-- Derived, deterministic recipe tags (protein:egg / method:steam / difficulty:easy / time:quick).
-- Kept separate from the user-facing `tags` column so UI filters and the 20-tag cap are unaffected.
ALTER TABLE "official_recipes" ADD COLUMN IF NOT EXISTS "derived_tags" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "derived_tags" text NOT NULL DEFAULT '';
