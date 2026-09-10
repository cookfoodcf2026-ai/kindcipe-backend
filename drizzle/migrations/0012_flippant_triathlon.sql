CREATE TABLE "ai_chat_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"year_month" varchar(7) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_chat_usage_family_month_unique" ON "ai_chat_usage" USING btree ("family_id","year_month");