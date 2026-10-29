CREATE TABLE IF NOT EXISTS "ai_chef_meal_state" (
  "family_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "shape" jsonb NOT NULL,
  "card_names" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_chef_meal_state_family_user_unique" ON "ai_chef_meal_state" ("family_id","user_id");
CREATE INDEX IF NOT EXISTS "ai_chef_meal_state_updated_at_idx" ON "ai_chef_meal_state" ("updated_at");
