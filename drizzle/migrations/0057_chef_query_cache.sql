-- Layer 1: cache the LLM slot parse per normalized sentence.
CREATE TABLE IF NOT EXISTS "chef_query_cache" (
  "normalized_text" text PRIMARY KEY,
  "slots" jsonb NOT NULL,
  "hit_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "last_hit_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_query_cache_last_hit_idx" ON "chef_query_cache" ("last_hit_at");
