CREATE TABLE "iap_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"product_id" varchar(128) NOT NULL,
	"plan_type" varchar(16) DEFAULT 'monthly' NOT NULL,
	"receipt" text NOT NULL,
	"purchase_token" text,
	"transaction_id" varchar(256) NOT NULL,
	"transaction_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirect_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer,
	"user_id" text,
	"platform" varchar(64) NOT NULL,
	"keyword" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "subscription_plan" varchar(16);--> statement-breakpoint
CREATE UNIQUE INDEX "iap_transactions_transaction_id_unique" ON "iap_transactions" USING btree ("transaction_id");