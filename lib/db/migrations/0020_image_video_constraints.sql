CREATE UNIQUE INDEX "production_batch_items_batch_sequence_unique"
  ON "production_batch_items" ("production_batch_id", "sequence");--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_new_recipe_complete" CHECK (
  "shot_skill_version_id" IS NOT NULL
  AND "shot_skill_id" IS NOT NULL
  AND "shot_skill_version" IS NOT NULL
  AND "shot_skill_hash" IS NOT NULL
  AND "recipe_snapshot" IS NOT NULL
) NOT VALID;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_execution_source_complete" CHECK (
  "production_batch_item_id" IS NOT NULL
  AND "input_asset_id" IS NOT NULL
) NOT VALID;