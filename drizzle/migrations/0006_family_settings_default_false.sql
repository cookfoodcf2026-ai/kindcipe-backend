-- Change column default to disable approval by default for new families
ALTER TABLE families ALTER COLUMN settings SET DEFAULT '{"approvalRequired":false}'::jsonb;
