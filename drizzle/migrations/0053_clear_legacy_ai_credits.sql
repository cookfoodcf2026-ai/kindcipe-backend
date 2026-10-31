-- 2026-10-31 product decision: all users see 150 AI credits + 100 imports.
-- Remove every legacy grandfather override; effectivePlanLimits stays for future use.
UPDATE "families" SET "legacy_ai_credits" = NULL WHERE "legacy_ai_credits" IS NOT NULL;
