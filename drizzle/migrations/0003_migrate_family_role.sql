-- Migration: Update family_role enum, add missing columns, convert housewife -> owner

-- 1. Update family_role enum: add 'owner' and 'admin'
ALTER TYPE "public"."family_role" ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE "public"."family_role" ADD VALUE IF NOT EXISTS 'owner';

-- 2. Convert existing 'housewife' values to 'owner'
UPDATE "public"."family_members" SET "family_role" = 'owner' WHERE "family_role" = 'housewife';
UPDATE "public"."users" SET "family_role" = 'owner' WHERE "family_role" = 'housewife';

-- 3. Add settings column to families if missing
ALTER TABLE "public"."families" ADD COLUMN IF NOT EXISTS "settings" jsonb DEFAULT '{"approvalRequired":true}'::jsonb NOT NULL;

-- 4. Add is_default column to family_members if missing
ALTER TABLE "public"."family_members" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;

-- 5. Add family_id column to weekly_menu if missing
ALTER TABLE "public"."weekly_menu" ADD COLUMN IF NOT EXISTS "family_id" integer;
-- Set default family_id for existing weekly_menu rows (use first family)
UPDATE "public"."weekly_menu" SET "family_id" = (SELECT id FROM "public"."families" LIMIT 1) WHERE "family_id" IS NULL;
ALTER TABLE "public"."weekly_menu" ALTER COLUMN "family_id" SET NOT NULL;

-- 6. Change ID columns from integer to text (safe if they already contain text)
ALTER TABLE "public"."custom_recipes" ALTER COLUMN "created_by_user_id" SET DATA TYPE text USING "created_by_user_id"::text;
ALTER TABLE "public"."custom_recipes" ALTER COLUMN "approved_by_user_id" SET DATA TYPE text USING "approved_by_user_id"::text;
ALTER TABLE "public"."family_members" ALTER COLUMN "user_id" SET DATA TYPE text USING "user_id"::text;
ALTER TABLE "public"."official_recipes" ALTER COLUMN "imported_by_user_id" SET DATA TYPE text USING "imported_by_user_id"::text;
ALTER TABLE "public"."families" ALTER COLUMN "owner_id" SET DATA TYPE text USING "owner_id"::text;

-- 7. Drop family_id and family_role from users table (moved to family_members)
ALTER TABLE "public"."users" DROP COLUMN IF EXISTS "family_id";
ALTER TABLE "public"."users" DROP COLUMN IF EXISTS "family_role";
