ALTER TABLE "video_jobs" ADD COLUMN "shot_skill_id" varchar(100);--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "shot_skill_version" varchar(30);--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "shot_skill_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "recipe_snapshot" text;