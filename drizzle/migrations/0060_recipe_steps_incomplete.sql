ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "steps_incomplete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "steps_incomplete_reason" text;
