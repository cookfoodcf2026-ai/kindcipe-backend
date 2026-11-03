-- One row per AI Chef request. raw_text is only the latest user sentence.
CREATE TABLE IF NOT EXISTS "chef_query_log" (
  "id" serial PRIMARY KEY,
  "family_id" integer,
  "user_id" text,
  "raw_text" text NOT NULL,
  "slots" jsonb,
  "relax_level" integer,
  "candidates" integer,
  "served" integer NOT NULL DEFAULT 0,
  "credits" integer NOT NULL DEFAULT 0,
  "llm_calls" integer NOT NULL DEFAULT 0,
  "duration_ms" integer,
  "reason" text,
  "served_sources" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_query_log_created_at_idx" ON "chef_query_log" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_query_log_family_created_idx" ON "chef_query_log" ("family_id", "created_at");
