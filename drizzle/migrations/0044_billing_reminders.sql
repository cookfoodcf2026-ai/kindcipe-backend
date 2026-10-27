CREATE TABLE IF NOT EXISTS "billing_reminders" (
  "id" serial PRIMARY KEY NOT NULL,
  "family_id" integer NOT NULL,
  "kind" varchar(16) NOT NULL,
  "period_end" timestamp NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "channel" varchar(16) DEFAULT 'email' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reminders_family_kind_period_unique"
  ON "billing_reminders" USING btree ("family_id", "kind", "period_end");
