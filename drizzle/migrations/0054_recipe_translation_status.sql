-- Additive translation status columns for background 4-language fill.
-- pending = needs translation, ready = all target languages present, failed = gave up after retries.
ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "translation_status" text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "translation_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "translation_updated_at" timestamptz NULL;
--> statement-breakpoint
UPDATE "custom_recipes"
SET "translation_status" = 'ready'
WHERE "name_en" IS NOT NULL AND "name_fil" IS NOT NULL AND "name_id" IS NOT NULL
  AND "steps_en" IS NOT NULL AND "steps_fil" IS NOT NULL AND "steps_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "custom_recipes"
SET "translation_status" = 'pending'
WHERE NOT (
  "name_en" IS NOT NULL AND "name_fil" IS NOT NULL AND "name_id" IS NOT NULL
  AND "steps_en" IS NOT NULL AND "steps_fil" IS NOT NULL AND "steps_id" IS NOT NULL
);
