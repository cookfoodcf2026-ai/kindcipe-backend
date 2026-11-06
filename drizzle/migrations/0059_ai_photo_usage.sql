CREATE TABLE IF NOT EXISTS "ai_photo_usage" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "kind" varchar(16) NOT NULL,
  "day" varchar(10) NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_photo_usage_user_kind_day_unique" ON "ai_photo_usage" ("user_id","kind","day");
