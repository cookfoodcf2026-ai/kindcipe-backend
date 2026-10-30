ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "scenario_tags_user" text DEFAULT '';
--> statement-breakpoint
ALTER TABLE "official_recipes" ADD COLUMN IF NOT EXISTS "scenario_tags_user" text DEFAULT '';
