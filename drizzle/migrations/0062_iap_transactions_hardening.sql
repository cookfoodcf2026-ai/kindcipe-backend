ALTER TABLE "iap_transactions" ADD COLUMN IF NOT EXISTS "original_transaction_id" varchar(256);--> statement-breakpoint
ALTER TABLE "iap_transactions" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "iap_transactions" ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "iap_transactions" ADD COLUMN IF NOT EXISTS "environment" varchar(16);--> statement-breakpoint
ALTER TABLE "iap_transactions" ADD COLUMN IF NOT EXISTS "revocation_date" timestamp;--> statement-breakpoint
ALTER TABLE "iap_transactions" ADD COLUMN IF NOT EXISTS "app_account_token" varchar(128);--> statement-breakpoint
ALTER TABLE "iap_transactions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();--> statement-breakpoint
UPDATE "iap_transactions" SET "original_transaction_id" = substring("transaction_id" from 7) WHERE "original_transaction_id" IS NULL AND "transaction_id" LIKE 'apple\_%' ESCAPE '\';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "iap_transactions_original_product_unique" ON "iap_transactions" ("original_transaction_id","product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "iap_transactions_app_account_token_idx" ON "iap_transactions" ("app_account_token");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "apple_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "notification_uuid" varchar(128) NOT NULL,
  "notification_type" varchar(64) NOT NULL,
  "subtype" varchar(64),
  "family_id" integer,
  "original_transaction_id" varchar(256),
  "transaction_id" varchar(256),
  "environment" varchar(16),
  "status" varchar(32),
  "signed_date" timestamp,
  "received_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "apple_notifications_uuid_unique" ON "apple_notifications" ("notification_uuid");
