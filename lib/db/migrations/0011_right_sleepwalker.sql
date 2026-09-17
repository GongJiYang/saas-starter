CREATE TABLE "shot_skill_validation_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"shot_skill_version_id" integer NOT NULL,
	"video_job_id" integer NOT NULL,
	"review_id" integer,
	"evidence_type" varchar(30) NOT NULL,
	"passed" boolean NOT NULL,
	"reason" text,
	"detail" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_shot_skill_version_id_shot_skill_versions_id_fk" FOREIGN KEY ("shot_skill_version_id") REFERENCES "public"."shot_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_video_job_id_video_jobs_id_fk" FOREIGN KEY ("video_job_id") REFERENCES "public"."video_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shot_skill_validation_evidence_job_type_unique" ON "shot_skill_validation_evidence" USING btree ("video_job_id","evidence_type");--> statement-breakpoint
CREATE INDEX "shot_skill_validation_evidence_version_created_at_idx" ON "shot_skill_validation_evidence" USING btree ("shot_skill_version_id","created_at");