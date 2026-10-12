ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "language" varchar(16);--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "language" varchar(16);
