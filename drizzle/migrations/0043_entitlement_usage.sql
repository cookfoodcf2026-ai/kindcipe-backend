CREATE TABLE IF NOT EXISTS "family_usage_monthly" (
  "id" serial PRIMARY KEY NOT NULL,
  "family_id" integer NOT NULL,
  "year_month" varchar(7) NOT NULL,
  "ai_credits" integer DEFAULT 0 NOT NULL,
  "imports" integer DEFAULT 0 NOT NULL,
  "custom_recipes" integer DEFAULT 0 NOT NULL,
  "estimated_cost_micros" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_usage_monthly_family_month_unique"
  ON "family_usage_monthly" USING btree ("family_id", "year_month");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "family_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "year_month" varchar(7) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "credits" integer DEFAULT 0 NOT NULL,
  "imports" integer DEFAULT 0 NOT NULL,
  "custom_recipes" integer DEFAULT 0 NOT NULL,
  "estimated_cost_micros" integer DEFAULT 0 NOT NULL,
  "status" varchar(16) DEFAULT 'reserved' NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "reserved_until" timestamp,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_family_idempotency_unique"
  ON "usage_events" USING btree ("family_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_family_month_idx"
  ON "usage_events" USING btree ("family_id", "year_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_status_idx"
  ON "usage_events" USING btree ("status", "reserved_until");--> statement-breakpoint
WITH combined AS (
  SELECT family_id, year_month, SUM(ai_credits)::int AS ai_credits, SUM(imports)::int AS imports
  FROM (
    SELECT family_id, year_month, count AS ai_credits, 0 AS imports FROM "ai_chat_usage"
    UNION ALL
    SELECT family_id, year_month, 0 AS ai_credits, count AS imports FROM "import_usage"
  ) usage
  GROUP BY family_id, year_month
)
INSERT INTO "family_usage_monthly" ("family_id", "year_month", "ai_credits", "imports", "updated_at")
SELECT family_id, year_month, ai_credits, imports, now() FROM combined
ON CONFLICT ("family_id", "year_month") DO UPDATE SET
  "ai_credits" = GREATEST("family_usage_monthly"."ai_credits", EXCLUDED."ai_credits"),
  "imports" = GREATEST("family_usage_monthly"."imports", EXCLUDED."imports"),
  "updated_at" = now();--> statement-breakpoint
WITH custom AS (
  SELECT family_id, to_char(date_trunc('month', created_at), 'YYYY-MM') AS year_month, COUNT(*)::int AS custom_recipes
  FROM "custom_recipes"
  WHERE source_type = 'manual'
  GROUP BY family_id, to_char(date_trunc('month', created_at), 'YYYY-MM')
)
INSERT INTO "family_usage_monthly" ("family_id", "year_month", "custom_recipes", "updated_at")
SELECT family_id, year_month, custom_recipes, now() FROM custom
ON CONFLICT ("family_id", "year_month") DO UPDATE SET
  "custom_recipes" = GREATEST("family_usage_monthly"."custom_recipes", EXCLUDED."custom_recipes"),
  "updated_at" = now();
