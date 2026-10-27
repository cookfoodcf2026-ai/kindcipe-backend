-- Billing hardening: one pending checkout per family + Stripe event ordering.
ALTER TABLE "stripe_subscriptions" ADD COLUMN IF NOT EXISTS "stripe_event_at" timestamp;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD COLUMN IF NOT EXISTS "stripe_created_at" timestamp;--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    "stripe_checkout_session_id",
    row_number() OVER (
      PARTITION BY "family_id"
      ORDER BY "updated_at" DESC NULLS LAST, "id" DESC
    ) AS rn
  FROM "stripe_subscriptions"
  WHERE "status" = 'pending'
), duplicate_pending AS (
  SELECT "id", "stripe_checkout_session_id" FROM ranked WHERE rn > 1
)
UPDATE "earlybird_redemptions" e
SET "status" = 'released', "released_at" = now(), "updated_at" = now()
WHERE e."status" = 'reserved'
  AND e."stripe_checkout_session_id" IN (
    SELECT "stripe_checkout_session_id"
    FROM duplicate_pending
    WHERE "stripe_checkout_session_id" IS NOT NULL
  );--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "family_id"
      ORDER BY "updated_at" DESC NULLS LAST, "id" DESC
    ) AS rn
  FROM "stripe_subscriptions"
  WHERE "status" = 'pending'
)
UPDATE "stripe_subscriptions" s
SET "status" = 'expired', "updated_at" = now()
WHERE s."id" IN (SELECT "id" FROM ranked WHERE rn > 1);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_subscriptions_pending_family_unique"
  ON "stripe_subscriptions" USING btree ("family_id")
  WHERE "status" = 'pending';
