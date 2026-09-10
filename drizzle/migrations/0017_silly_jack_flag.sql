CREATE TABLE "ai_chef_seen_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"name" text NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_chef_seen_recipes_family_name_unique" ON "ai_chef_seen_recipes" USING btree ("family_id","name");