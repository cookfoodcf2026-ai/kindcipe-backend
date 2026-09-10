-- Update existing families to disable approval by default
-- This improves UX by reducing double-approval workload for owners
UPDATE families
SET settings = jsonb_set(settings, '{approvalRequired}', 'false'::jsonb)
WHERE settings->>'approvalRequired' IS NOT NULL;
