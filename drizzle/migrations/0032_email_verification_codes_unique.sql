DELETE FROM email_verification_codes a USING email_verification_codes b WHERE a.email = b.email AND a.id < b.id;
--> statement-breakpoint
DROP INDEX IF EXISTS email_verification_codes_email_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX email_verification_codes_email_unique ON email_verification_codes (email);
