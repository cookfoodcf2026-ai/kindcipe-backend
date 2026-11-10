-- 0066_chef_query_log_nullable_raw_text.sql
-- Privacy: clearHistory scrubs chef_query_log.raw_text to NULL while keeping
-- the row for billing/quota audit. The original column was NOT NULL.
--
-- DRY-RUN before applying:
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_name = 'chef_query_log' AND column_name = 'raw_text';
ALTER TABLE "chef_query_log" ALTER COLUMN "raw_text" DROP NOT NULL;
