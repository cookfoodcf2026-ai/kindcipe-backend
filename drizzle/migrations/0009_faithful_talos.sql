--> statement-breakpoint
CREATE TABLE "family_eat_out" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"date" varchar(16) NOT NULL,
	"set_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "removed_family_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"removed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_usage" ADD COLUMN "family_id" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- ─── Data migration: move eatOut flags to new table ───────────────────────────
INSERT INTO family_eat_out (family_id, date, set_by_user_id)
SELECT 
  family_id,
  to_char((week_start::date + (day_of_week - 1)), 'YYYY-MM-DD'),
  set_by_user_id
FROM weekly_menu
WHERE eat_out = true AND family_id <> 0
ON CONFLICT (family_id, date) DO NOTHING;

-- ─── Data migration: remove non-official weekly_menu rows ─────────────────────
DELETE FROM weekly_menu WHERE family_id <> 0;

-- ─── Dedupe: keep lowest id per (week_start, day_of_week) for official rows ───
DELETE FROM weekly_menu a USING weekly_menu b
  WHERE a.week_start = b.week_start AND a.day_of_week = b.day_of_week AND a.id > b.id;

-- ─── Dedupe: keep lowest id per (family_id, user_id) ──────────────────────────
DELETE FROM family_members a USING family_members b
  WHERE a.family_id = b.family_id AND a.user_id = b.user_id AND a.id > b.id;

-- ─── Dedupe: merge legacy import_usage rows per (family_id, year_month) ───────
-- Legacy rows all have family_id = 0 (column just added); merge counts before
-- the unique index, otherwise index creation fails on duplicate (0, year_month).
UPDATE import_usage target
SET count = sub.total
FROM (
  SELECT family_id, year_month, SUM(count) AS total, MIN(id) AS keep_id
  FROM import_usage
  GROUP BY family_id, year_month
) sub
WHERE target.id = sub.keep_id;

DELETE FROM import_usage a USING import_usage b
  WHERE a.family_id = b.family_id AND a.year_month = b.year_month AND a.id > b.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "family_eat_out_family_date_unique" ON "family_eat_out" USING btree ("family_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "removed_family_members_family_user_unique" ON "removed_family_members" USING btree ("family_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "family_members_family_user_unique" ON "family_members" USING btree ("family_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_usage_family_month_unique" ON "import_usage" USING btree ("family_id","year_month");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_menu_week_day_unique" ON "weekly_menu" USING btree ("week_start","day_of_week");
