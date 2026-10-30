CREATE TABLE IF NOT EXISTS "ai_chef_family_safety" (
  "family_id" integer PRIMARY KEY,
  "allergens" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
