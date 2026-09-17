ALTER TABLE "creative_spec_versions" ADD COLUMN "rejection_code" varchar(50);--> statement-breakpoint
ALTER TABLE "creative_spec_versions" ADD COLUMN "rejection_note" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "creative_spec_version_id" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_creative_spec_version_id_creative_spec_versions_id_fk" FOREIGN KEY ("creative_spec_version_id") REFERENCES "public"."creative_spec_versions"("id") ON DELETE no action ON UPDATE no action;