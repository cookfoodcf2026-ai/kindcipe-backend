CREATE INDEX "meal_plans_family_date_idx" ON "meal_plans" USING btree ("family_id","date");--> statement-breakpoint
CREATE INDEX "recipe_events_recipe_id_idx" ON "recipe_events" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_events_family_created_idx" ON "recipe_events" USING btree ("family_id","created_at");--> statement-breakpoint
CREATE INDEX "shopping_items_family_status_idx" ON "shopping_items" USING btree ("family_id","status");--> statement-breakpoint
CREATE INDEX "shopping_items_family_date_idx" ON "shopping_items" USING btree ("family_id","planned_date");