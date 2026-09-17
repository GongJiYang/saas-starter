ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_new_recipe_complete" CHECK ("video_jobs"."shot_skill_version_id" IS NOT NULL
        AND "video_jobs"."shot_skill_id" IS NOT NULL
        AND "video_jobs"."shot_skill_version" IS NOT NULL
        AND "video_jobs"."shot_skill_hash" IS NOT NULL
        AND "video_jobs"."recipe_snapshot" IS NOT NULL) NOT VALID;