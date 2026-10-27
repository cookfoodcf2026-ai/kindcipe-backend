-- Early-bird founding membership + trial-first promo billing.
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "assigned_family_id" integer;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "auto_issued" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_assigned_family_unique" ON "promo_codes" USING btree ("assigned_family_id");--> statement-breakpoint
DELETE FROM "promo_code_redemptions" a USING "promo_code_redemptions" b WHERE a.user_id = b.user_id AND a.id < b.id;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promo_code_redemptions_user_unique" ON "promo_code_redemptions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD COLUMN IF NOT EXISTS "checkout_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD COLUMN IF NOT EXISTS "promo_code" varchar(24);--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD COLUMN IF NOT EXISTS "price_tier" varchar(16) DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD COLUMN IF NOT EXISTS "trial_end" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_subscriptions_checkout_id_unique" ON "stripe_subscriptions" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_subscriptions_pending_idx" ON "stripe_subscriptions" USING btree ("status","checkout_expires_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "earlybird_redemptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "family_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "stripe_subscription_id" varchar(128),
  "stripe_checkout_session_id" varchar(128),
  "status" varchar(16) DEFAULT 'reserved' NOT NULL,
  "reserved_at" timestamp DEFAULT now() NOT NULL,
  "paid_at" timestamp,
  "released_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "earlybird_redemptions_family_unique" ON "earlybird_redemptions" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "earlybird_redemptions_subscription_unique" ON "earlybird_redemptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "earlybird_redemptions_checkout_unique" ON "earlybird_redemptions" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "earlybird_redemptions_status_idx" ON "earlybird_redemptions" USING btree ("status");
