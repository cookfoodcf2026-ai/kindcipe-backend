CREATE TABLE IF NOT EXISTS "deletion_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "step" varchar(32),
  "last_error" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deletion_requests_user_id_unique" ON "deletion_requests" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "r2_deletion_queue" (
  "id" serial PRIMARY KEY NOT NULL,
  "family_id" integer,
  "key" text NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "r2_deletion_queue_key_unique" ON "r2_deletion_queue" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "r2_deletion_queue_status_idx" ON "r2_deletion_queue" ("status");
