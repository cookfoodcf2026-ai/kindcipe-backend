ALTER TYPE "public"."source_type" ADD VALUE 'kol';--> statement-breakpoint
CREATE TABLE "user_recipe_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"recipe_id" varchar(64) NOT NULL,
	"recipe_type" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_recipe_collections_user_recipe_unique" ON "user_recipe_collections" USING btree ("user_id","recipe_id","recipe_type");--> statement-breakpoint
CREATE INDEX "user_recipe_collections_user_idx" ON "user_recipe_collections" USING btree ("user_id");