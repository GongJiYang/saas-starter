ALTER TABLE "video_jobs" DROP CONSTRAINT "video_jobs_new_recipe_complete";--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_new_recipe_complete" CHECK (
  (
    "shot_skill_version_id" IS NOT NULL
    AND "shot_skill_id" IS NOT NULL
    AND "shot_skill_version" IS NOT NULL
    AND "shot_skill_hash" IS NOT NULL
    AND "recipe_snapshot" IS NOT NULL
  ) OR (
    "production_batch_item_id" IS NOT NULL
    AND "input_asset_id" IS NOT NULL
    AND "recipe_snapshot" IS NOT NULL
  )
) NOT VALID;