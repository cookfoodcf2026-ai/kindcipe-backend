CREATE TABLE "kol_creators" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" varchar(320),
	"display_name" varchar(128),
	"added_by_user_id" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
