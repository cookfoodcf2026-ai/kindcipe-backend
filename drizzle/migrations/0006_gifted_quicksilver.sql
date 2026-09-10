CREATE INDEX "custom_recipes_family_id_idx" ON "custom_recipes" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "custom_recipes_created_at_idx" ON "custom_recipes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "custom_recipes_recipe_category_idx" ON "custom_recipes" USING btree ("recipe_category");--> statement-breakpoint
CREATE INDEX "custom_recipes_popularity_idx" ON "custom_recipes" USING btree ("popularity");--> statement-breakpoint
CREATE INDEX "official_recipes_is_active_idx" ON "official_recipes" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "official_recipes_created_at_idx" ON "official_recipes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "official_recipes_recipe_category_idx" ON "official_recipes" USING btree ("recipe_category");--> statement-breakpoint
CREATE INDEX "official_recipes_popularity_idx" ON "official_recipes" USING btree ("popularity");