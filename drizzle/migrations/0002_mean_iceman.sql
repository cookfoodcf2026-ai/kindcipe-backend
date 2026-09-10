ALTER TABLE "family_members" ALTER COLUMN "family_role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "family_members" ALTER COLUMN "family_role" SET DEFAULT 'member'::text;--> statement-breakpoint
DROP TYPE "public"."family_role";--> statement-breakpoint
CREATE TYPE "public"."family_role" AS ENUM('owner', 'admin', 'helper', 'member');--> statement-breakpoint
ALTER TABLE "family_members" ALTER COLUMN "family_role" SET DEFAULT 'member'::"public"."family_role";--> statement-breakpoint
ALTER TABLE "family_members" ALTER COLUMN "family_role" SET DATA TYPE "public"."family_role" USING "family_role"::"public"."family_role";--> statement-breakpoint
ALTER TABLE "custom_recipes" ALTER COLUMN "created_by_user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "custom_recipes" ALTER COLUMN "approved_by_user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "family_members" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "official_recipes" ALTER COLUMN "imported_by_user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "settings" jsonb DEFAULT '{"approvalRequired":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_menu" ADD COLUMN "family_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "family_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "family_role";