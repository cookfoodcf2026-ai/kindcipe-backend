CREATE TABLE "common_ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_key" varchar(32) NOT NULL,
	"default_unit_key" varchar(32),
	"name_yue" varchar(128) NOT NULL,
	"name_zh" varchar(128) NOT NULL,
	"name_en" varchar(128) NOT NULL,
	"name_fil" varchar(128),
	"name_id" varchar(128),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "common_ingredients_name_yue_unique" UNIQUE("name_yue")
);
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN "common_ingredient_id" integer;