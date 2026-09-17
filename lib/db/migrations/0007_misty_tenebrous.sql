ALTER TABLE "reviews" ADD COLUMN "quality_failure_cause" varchar(30);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "quality_report" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "quality_report" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "actual_cost_cny" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "retry_of_video_job_id" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "retry_reason" varchar(30);