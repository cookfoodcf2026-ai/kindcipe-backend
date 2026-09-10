ALTER TABLE "ai_chat_usage" ADD COLUMN "user_id" text NOT NULL DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "ai_chat_usage" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
DROP INDEX IF EXISTS "ai_chat_usage_family_month_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "ai_chat_usage_family_month_user_unique" ON "ai_chat_usage" USING btree ("family_id","year_month","user_id");
