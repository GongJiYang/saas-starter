CREATE TYPE "public"."asset_type" AS ENUM('product_image', 'generated_video');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'ready', 'generating', 'review', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('adopted', 'not_adopted');--> statement-breakpoint
CREATE TYPE "public"."shot_card_status" AS ENUM('proposed', 'selected');--> statement-breakpoint
CREATE TYPE "public"."video_job_status" AS ENUM('queued', 'generating', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"type" "asset_type" NOT NULL,
	"object_key" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"brand_voice" text NOT NULL,
	"required_elements" text NOT NULL,
	"forbidden_elements" text NOT NULL,
	"default_shot_preference" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"brand_kit_id" integer NOT NULL,
	"product_asset_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"selling_points" text NOT NULL,
	"target_platform" varchar(50) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_duration_seconds_positive" CHECK ("campaigns"."duration_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"video_job_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"decision" "review_decision" NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_not_adopted_requires_reason" CHECK (("reviews"."decision" <> 'not_adopted' OR length(trim(coalesce("reviews"."reason", ''))) > 0))
);
--> statement-breakpoint
CREATE TABLE "shot_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"position" integer NOT NULL,
	"title" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"status" "shot_card_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shot_cards_position_range" CHECK ("shot_cards"."position" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"shot_card_id" integer NOT NULL,
	"submitted_by" integer NOT NULL,
	"provider" varchar(50) DEFAULT 'minimax' NOT NULL,
	"external_task_id" text,
	"status" "video_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure_code" varchar(100),
	"failure_reason" text,
	"output_asset_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "video_jobs_attempts_nonnegative" CHECK ("video_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_kit_id_brand_kits_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_product_asset_id_assets_id_fk" FOREIGN KEY ("product_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_video_job_id_video_jobs_id_fk" FOREIGN KEY ("video_job_id") REFERENCES "public"."video_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_cards" ADD CONSTRAINT "shot_cards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_cards" ADD CONSTRAINT "shot_cards_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_shot_card_id_shot_cards_id_fk" FOREIGN KEY ("shot_card_id") REFERENCES "public"."shot_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_output_asset_id_assets_id_fk" FOREIGN KEY ("output_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_object_key_unique" ON "assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "assets_team_created_at_idx" ON "assets" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_team_name_unique" ON "brand_kits" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "brand_kits_team_created_at_idx" ON "brand_kits" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "campaigns_team_status_created_at_idx" ON "campaigns" USING btree ("team_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_video_job_unique" ON "reviews" USING btree ("video_job_id");--> statement-breakpoint
CREATE INDEX "reviews_team_decision_created_at_idx" ON "reviews" USING btree ("team_id","decision","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_cards_campaign_position_unique" ON "shot_cards" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_cards_selected_campaign_unique" ON "shot_cards" USING btree ("campaign_id") WHERE "shot_cards"."status" = 'selected';--> statement-breakpoint
CREATE INDEX "shot_cards_team_campaign_idx" ON "shot_cards" USING btree ("team_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_jobs_provider_external_task_id_unique" ON "video_jobs" USING btree ("provider","external_task_id");--> statement-breakpoint
CREATE INDEX "video_jobs_team_status_created_at_idx" ON "video_jobs" USING btree ("team_id","status","created_at");