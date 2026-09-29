CREATE TABLE "stripe_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"stripe_customer_id" varchar(128),
	"stripe_subscription_id" varchar(128),
	"stripe_checkout_session_id" varchar(128),
	"product_id" varchar(64) NOT NULL,
	"plan_type" varchar(16) DEFAULT 'monthly' NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"current_period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_subscriptions_sub_id_unique" ON "stripe_subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "stripe_subscriptions_customer_idx" ON "stripe_subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "stripe_subscriptions_family_idx" ON "stripe_subscriptions" USING btree ("family_id");