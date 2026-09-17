CREATE TABLE "shot_skill_release_validations" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"shot_skill_version_id" integer NOT NULL,
	"definition_hash" varchar(64) NOT NULL,
	"fixture" jsonb NOT NULL,
	"fixture_hash" varchar(64) NOT NULL,
	"eligible" boolean NOT NULL,
	"reasons" jsonb NOT NULL,
	"fallback_skill_id" varchar(100),
	"fallback_eligible" boolean,
	"selection_reason" text NOT NULL,
	"compiled_recipe" jsonb,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shot_skill_release_validations_hashes_valid" CHECK ("shot_skill_release_validations"."definition_hash" ~ '^[a-f0-9]{64}$' AND "shot_skill_release_validations"."fixture_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" DROP CONSTRAINT "shot_skill_validation_evidence_reason_consistent";--> statement-breakpoint
ALTER TABLE "shot_skill_release_validations" ADD CONSTRAINT "shot_skill_release_validations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skill_release_validations" ADD CONSTRAINT "shot_skill_release_validations_shot_skill_version_id_shot_skill_versions_id_fk" FOREIGN KEY ("shot_skill_version_id") REFERENCES "public"."shot_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skill_release_validations" ADD CONSTRAINT "shot_skill_release_validations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shot_skill_release_validations_version_created_at_idx" ON "shot_skill_release_validations" USING btree ("shot_skill_version_id","created_at");--> statement-breakpoint
CREATE INDEX "shot_skill_release_validations_team_version_idx" ON "shot_skill_release_validations" USING btree ("team_id","shot_skill_version_id");--> statement-breakpoint
ALTER TABLE "shot_skill_validation_evidence" ADD CONSTRAINT "shot_skill_validation_evidence_reason_consistent" CHECK (("shot_skill_validation_evidence"."evidence_type" <> 'rejected' OR (
          length(trim(coalesce("shot_skill_validation_evidence"."reason", ''))) > 0
          AND "shot_skill_validation_evidence"."detail"->>'rejectionCause' IN ('technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change')
        ))
        AND ("shot_skill_validation_evidence"."evidence_type" <> 'adopted' OR "shot_skill_validation_evidence"."reason" IS NULL));