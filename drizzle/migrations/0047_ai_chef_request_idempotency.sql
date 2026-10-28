CREATE TABLE IF NOT EXISTS "ai_chef_requests" (
  "id" serial PRIMARY KEY,
  "family_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "chat_id" varchar(64) DEFAULT '' NOT NULL,
  "client_message_id" varchar(128) NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "status" varchar(24) NOT NULL,
  "requested_total" integer DEFAULT 0 NOT NULL,
  "served" integer DEFAULT 0 NOT NULL,
  "llm_calls" integer DEFAULT 0 NOT NULL,
  "cost_micros" integer DEFAULT 0 NOT NULL,
  "response_json" jsonb,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_chef_requests_family_chat_client_message_unique"
  ON "ai_chef_requests" ("family_id","chat_id","client_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_chef_requests_expires_idx"
  ON "ai_chef_requests" ("expires_at");
