ALTER TABLE "families" ALTER COLUMN "subscription_status" SET DEFAULT 'free';--> statement-breakpoint
UPDATE "families"
SET "subscription_status" = 'free', "max_members" = 2
WHERE "subscription_status" = 'trial'
  AND "trial_ends_at" IS NULL
  AND ("subscription_expires_at" IS NULL OR "subscription_expires_at" < now());
