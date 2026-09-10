ALTER TABLE "families" ALTER COLUMN "settings" SET DEFAULT '{"approvalRequired":false}'::jsonb;--> statement-breakpoint
ALTER TABLE "custom_recipes" ADD COLUMN "popularity" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "official_recipes" ADD COLUMN "popularity" integer DEFAULT 50 NOT NULL;