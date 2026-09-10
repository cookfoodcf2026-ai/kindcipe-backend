ALTER TABLE "official_recipes" ADD COLUMN "popularity" integer DEFAULT 50 NOT NULL;
ALTER TABLE "custom_recipes" ADD COLUMN "popularity" integer DEFAULT 50 NOT NULL;
