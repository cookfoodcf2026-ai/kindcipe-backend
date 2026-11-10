CREATE TABLE IF NOT EXISTS "custom_recipe_usage" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "family_id" integer DEFAULT 0 NOT NULL,
  "year_month" varchar(7) NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_recipe_usage_family_month_user_unique"
  ON "custom_recipe_usage" USING btree ("family_id", "year_month", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_recipe_usage_user_month_idx"
  ON "custom_recipe_usage" USING btree ("user_id", "year_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_usage_user_month_idx"
  ON "import_usage" USING btree ("user_id", "year_month");
