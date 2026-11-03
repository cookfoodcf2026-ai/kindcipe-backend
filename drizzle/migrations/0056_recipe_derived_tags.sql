-- Layer 4: deterministic write-time facets (protein / method / diet / tag / main).
-- Safe to add: old rows default to '[]' and retrieval derives facets in memory.
ALTER TABLE "official_recipes" ADD COLUMN IF NOT EXISTS "derived_tags" text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE "custom_recipes" ADD COLUMN IF NOT EXISTS "derived_tags" text NOT NULL DEFAULT '[]';
