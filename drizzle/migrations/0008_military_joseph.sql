ALTER TABLE "favorite_items" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "import_usage" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "meal_plans" ALTER COLUMN "proposed_by_user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "meal_plans" ALTER COLUMN "confirmed_by_user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "purchase_history" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "push_tokens" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "recipe_events" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "recipe_notes" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shopping_items" ALTER COLUMN "proposed_by_user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shopping_items" ALTER COLUMN "bought_by_user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "weekly_menu" ALTER COLUMN "set_by_user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN "from_meal_plan_id" integer;