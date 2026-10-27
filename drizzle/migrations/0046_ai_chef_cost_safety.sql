CREATE TABLE IF NOT EXISTS "llm_cost_events" (
  "id" serial PRIMARY KEY,
  "request_id" varchar(64),
  "family_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "route" varchar(48) NOT NULL,
  "model" varchar(64) NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cost_micros" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_cost_events_family_created_idx" ON "llm_cost_events" ("family_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_cost_events_request_idx" ON "llm_cost_events" ("request_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_cost_monthly" (
  "id" serial PRIMARY KEY,
  "family_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "year_month" varchar(7) NOT NULL,
  "actual_cost_micros" integer DEFAULT 0 NOT NULL,
  "reserved_cost_micros" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_cost_monthly_family_user_month_unique" ON "llm_cost_monthly" ("family_id","user_id","year_month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_cost_monthly_family_month_idx" ON "llm_cost_monthly" ("family_id","year_month");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_budget_reservations" (
  "id" serial PRIMARY KEY,
  "family_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "year_month" varchar(7) NOT NULL,
  "estimate_micros" integer NOT NULL,
  "status" varchar(16) DEFAULT 'reserved' NOT NULL,
  "reserved_until" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_budget_reservations_family_idx" ON "llm_budget_reservations" ("family_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_chef_flags" (
  "id" serial PRIMARY KEY,
  "scope" varchar(16) NOT NULL,
  "family_id" integer DEFAULT 0 NOT NULL,
  "mode" varchar(16) DEFAULT 'normal' NOT NULL,
  "flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_chef_flags_scope_family_unique" ON "ai_chef_flags" ("scope","family_id");
--> statement-breakpoint
ALTER TABLE "family_usage_monthly" ADD COLUMN IF NOT EXISTS "llm_reserved_micros" integer DEFAULT 0 NOT NULL;
