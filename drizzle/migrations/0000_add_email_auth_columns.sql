-- Add email/password auth columns to existing users table (safe for already-deployed DBs)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" varchar(320);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false;
