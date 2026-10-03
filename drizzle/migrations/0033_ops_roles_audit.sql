-- Extend role enum with cs / auditor (idempotent: ADD VALUE IF NOT EXISTS)
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'cs';
--> statement-breakpoint
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'auditor';
--> statement-breakpoint
-- Admin audit log (append-only) — all sensitive back-office actions
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" serial PRIMARY KEY,
  "actor_id" text NOT NULL,
  "actor_role" varchar(32) NOT NULL,
  "action" varchar(64) NOT NULL,
  "target_user_id" text,
  "detail" jsonb,
  "reason" text,
  "ip" varchar(64),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_actor_idx" ON "admin_audit_logs" ("actor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_idx" ON "admin_audit_logs" ("target_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_idx" ON "admin_audit_logs" ("created_at");
