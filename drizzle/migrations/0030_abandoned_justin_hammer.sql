CREATE TABLE "ai_chat_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" varchar(128) DEFAULT '新對話' NOT NULL,
	"messages" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_chat_sessions_user_updated_idx" ON "ai_chat_sessions" USING btree ("user_id","updated_at");