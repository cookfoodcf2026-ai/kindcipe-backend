ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "scenario_tags" text;--> statement-breakpoint
ALTER TABLE "official_recipes" ADD COLUMN IF NOT EXISTS "scenario_tags" text;
