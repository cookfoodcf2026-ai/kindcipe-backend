ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "legacy_ai_credits" integer;
--> statement-breakpoint
UPDATE "families"
SET "legacy_ai_credits" = 250
WHERE "legacy_ai_credits" IS NULL
  AND "subscription_status" = 'active';
