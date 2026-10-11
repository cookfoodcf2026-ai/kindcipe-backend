ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "is_ai_generated" boolean NOT NULL DEFAULT false;
