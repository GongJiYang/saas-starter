ALTER TABLE "reviews" DROP CONSTRAINT "reviews_not_adopted_requires_reason";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "quality_report" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD COLUMN "observation_hash" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD COLUMN "observation_snapshot" text NOT NULL;--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD COLUMN "evidence_snapshot" text NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "quality_observation_hash" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_evidence_identity_unique" ON "reviews" USING btree ("id","video_job_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_jobs_evidence_identity_unique" ON "video_jobs" USING btree ("id","team_id","shot_skill_version_id");--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_job_identity_fk" FOREIGN KEY ("video_job_id","team_id","shot_skill_version_id") REFERENCES "public"."video_jobs"("id","team_id","shot_skill_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_review_identity_fk" FOREIGN KEY ("review_id","video_job_id","team_id") REFERENCES "public"."reviews"("id","video_job_id","team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_decision_cause_consistent" CHECK ((
        "reviews"."decision" = 'adopted'
        AND "reviews"."reason" IS NULL
        AND "reviews"."quality_failure_cause" IS NULL
      ) OR (
        "reviews"."decision" = 'not_adopted'
        AND length(trim(coalesce("reviews"."reason", ''))) > 0
        AND "reviews"."quality_failure_cause" IN ('technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change')
      )) NOT VALID;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_quality_report_frozen" CHECK (length(trim("reviews"."quality_report")) > 2 AND trim("reviews"."quality_report") <> '{}') NOT VALID;--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_type_consistent" CHECK ((
        "shot_skill_validation_evidence"."evidence_type" = 'quality_gate'
        AND "shot_skill_validation_evidence"."review_id" IS NULL
      ) OR (
        "shot_skill_validation_evidence"."evidence_type" IN ('adopted', 'rejected')
        AND "shot_skill_validation_evidence"."review_id" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_passed_consistent" CHECK (("shot_skill_validation_evidence"."evidence_type" <> 'adopted' OR "shot_skill_validation_evidence"."passed")
        AND ("shot_skill_validation_evidence"."evidence_type" <> 'rejected' OR NOT "shot_skill_validation_evidence"."passed"));--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_reason_consistent" CHECK (("shot_skill_validation_evidence"."evidence_type" <> 'rejected' OR length(trim(coalesce("shot_skill_validation_evidence"."reason", ''))) > 0)
        AND ("shot_skill_validation_evidence"."evidence_type" <> 'adopted' OR "shot_skill_validation_evidence"."reason" IS NULL));--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_snapshots_valid" CHECK ("shot_skill_validation_evidence"."observation_hash" ~ '^[a-f0-9]{64}$'
        AND length(trim("shot_skill_validation_evidence"."observation_snapshot")) > 2
        AND length(trim("shot_skill_validation_evidence"."evidence_snapshot")) > 2);--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_quality_observation_hash_format" CHECK ("video_jobs"."quality_observation_hash" IS NULL OR "video_jobs"."quality_observation_hash" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_shot_skill_validation_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Shot Skill validation evidence is append-only' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER shot_skill_validation_evidence_append_only
BEFORE UPDATE OR DELETE ON "shot_skill_validation_evidence"
FOR EACH ROW
EXECUTE FUNCTION prevent_shot_skill_validation_evidence_mutation();