CREATE TYPE "public"."shot_skill_status" AS ENUM('draft', 'testing', 'active', 'deprecated', 'retired');--> statement-breakpoint
CREATE TABLE "shot_skill_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"shot_skill_id" integer NOT NULL,
	"parent_version_id" integer,
	"version" varchar(30) NOT NULL,
	"spec_version" varchar(20) NOT NULL,
	"status" "shot_skill_status" DEFAULT 'draft' NOT NULL,
	"normalized_definition" jsonb NOT NULL,
	"definition_hash" varchar(64) NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_by" integer NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shot_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"stable_id" varchar(100) NOT NULL,
	"owner_team_id" integer,
	"name" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "shot_skill_version_id" integer;--> statement-breakpoint
ALTER TABLE "shot_skill_versions" ADD CONSTRAINT "shot_skill_versions_shot_skill_id_shot_skills_id_fk" FOREIGN KEY ("shot_skill_id") REFERENCES "public"."shot_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skill_versions" ADD CONSTRAINT "shot_skill_versions_parent_version_id_shot_skill_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."shot_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skill_versions" ADD CONSTRAINT "shot_skill_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skills" ADD CONSTRAINT "shot_skills_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_skills" ADD CONSTRAINT "shot_skills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shot_skill_versions_skill_version_unique" ON "shot_skill_versions" USING btree ("shot_skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_skill_versions_one_active_per_skill" ON "shot_skill_versions" USING btree ("shot_skill_id") WHERE "shot_skill_versions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "shot_skill_versions_skill_status_created_at_idx" ON "shot_skill_versions" USING btree ("shot_skill_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_skills_official_stable_id_unique" ON "shot_skills" USING btree ("stable_id") WHERE "shot_skills"."owner_team_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shot_skills_team_stable_id_unique" ON "shot_skills" USING btree ("owner_team_id","stable_id") WHERE "shot_skills"."owner_team_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "shot_skills_owner_team_created_at_idx" ON "shot_skills" USING btree ("owner_team_id","created_at");--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_shot_skill_version_id_shot_skill_versions_id_fk" FOREIGN KEY ("shot_skill_version_id") REFERENCES "public"."shot_skill_versions"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
CREATE FUNCTION "prevent_published_shot_skill_version_mutation"() RETURNS trigger AS $$
BEGIN
	IF OLD.status <> 'draft' AND (
		NEW.version IS DISTINCT FROM OLD.version
		OR NEW.spec_version IS DISTINCT FROM OLD.spec_version
		OR NEW.normalized_definition IS DISTINCT FROM OLD.normalized_definition
		OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
		OR NEW.provenance IS DISTINCT FROM OLD.provenance
	) THEN
		RAISE EXCEPTION 'Published Shot Skill versions are immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "shot_skill_versions_immutable_after_draft"
BEFORE UPDATE ON "shot_skill_versions"
FOR EACH ROW EXECUTE FUNCTION "prevent_published_shot_skill_version_mutation"();