CREATE TYPE "public"."catalog_item_status" AS ENUM('needs_input', 'ready', 'archived');--> statement-breakpoint
CREATE TYPE "public"."creative_reference_mode" AS ENUM('structure', 'owned_template');--> statement-breakpoint
CREATE TYPE "public"."creative_reference_rights" AS ENUM('owned', 'licensed', 'inspiration_only');--> statement-breakpoint
CREATE TYPE "public"."creative_spec_status" AS ENUM('draft', 'awaiting_approval', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('uploaded', 'validating', 'needs_fix', 'ready', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('pending', 'ready', 'needs_fix', 'excluded', 'committed');--> statement-breakpoint
CREATE TYPE "public"."production_batch_item_status" AS ENUM('pending', 'pilot', 'ready', 'queued', 'producing', 'quality_review', 'review', 'completed', 'failed', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."production_batch_status" AS ENUM('draft', 'calibrating', 'pilot_review', 'ready', 'producing', 'paused', 'reviewing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reference_analysis_status" AS ENUM('draft', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "catalog_item_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"catalog_item_id" integer NOT NULL,
	"asset_id" integer,
	"purpose" varchar(50) NOT NULL,
	"position" integer NOT NULL,
	"source_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_item_assets_position_positive" CHECK ("catalog_item_assets"."position" > 0),
	CONSTRAINT "catalog_item_assets_has_source" CHECK ("catalog_item_assets"."asset_id" IS NOT NULL OR "catalog_item_assets"."source_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"external_sku" varchar(160) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"category" varchar(100) NOT NULL,
	"primary_image_url" text NOT NULL,
	"product_page_url" text,
	"primary_asset_id" integer,
	"readiness_status" "catalog_item_status" DEFAULT 'needs_input' NOT NULL,
	"readiness_errors" text DEFAULT '[]' NOT NULL,
	"approved_claims" text DEFAULT '[]' NOT NULL,
	"prohibited_claims" text DEFAULT '[]' NOT NULL,
	"must_show_elements" text DEFAULT '[]' NOT NULL,
	"immutable_elements" text DEFAULT '[]' NOT NULL,
	"target_audience" text NOT NULL,
	"campaign_goal" text NOT NULL,
	"platform" varchar(50) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"brand_kit_id" integer NOT NULL,
	"cta" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_duration_seconds_positive" CHECK ("catalog_items"."duration_seconds" BETWEEN 4 AND 15)
);
--> statement-breakpoint
CREATE TABLE "creative_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"catalog_item_id" integer,
	"source_id" varchar(160) NOT NULL,
	"object_key" text NOT NULL,
	"source_url" text,
	"rights" "creative_reference_rights" NOT NULL,
	"mode" "creative_reference_mode" NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"status" varchar(30) DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creative_references_byte_size_positive" CHECK ("creative_references"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "creative_spec_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"reference_analysis_id" integer,
	"parent_version_id" integer,
	"created_by" integer NOT NULL,
	"approved_by" integer,
	"version" varchar(30) NOT NULL,
	"status" "creative_spec_status" DEFAULT 'draft' NOT NULL,
	"spec_hash" varchar(64) NOT NULL,
	"spec_snapshot" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"file_object_key" text NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"template_version" varchar(20) NOT NULL,
	"status" "import_batch_status" DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"committed_at" timestamp,
	CONSTRAINT "import_batches_counts_nonnegative" CHECK ("import_batches"."total_rows" >= 0 AND "import_batches"."valid_rows" >= 0 AND "import_batches"."invalid_rows" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"import_batch_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"raw_values" text NOT NULL,
	"normalized_values" text,
	"errors" text DEFAULT '[]' NOT NULL,
	"status" "import_row_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_row_number_positive" CHECK ("import_rows"."row_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_batch_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"production_batch_id" integer NOT NULL,
	"catalog_item_id" integer NOT NULL,
	"campaign_id" integer,
	"creative_spec_version_id" integer,
	"status" "production_batch_item_status" DEFAULT 'pending' NOT NULL,
	"is_pilot" boolean DEFAULT false NOT NULL,
	"wave_number" integer DEFAULT 0 NOT NULL,
	"result_summary" text DEFAULT '{}' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_batch_items_wave_number_nonnegative" CHECK ("production_batch_items"."wave_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" "production_batch_status" DEFAULT 'draft' NOT NULL,
	"default_brand_kit_id" integer,
	"target_platform" varchar(50) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"campaign_goal" text NOT NULL,
	"wave_size" integer DEFAULT 10 NOT NULL,
	"stop_loss_config" text DEFAULT '{}' NOT NULL,
	"spec_hash" varchar(64),
	"max_estimated_cost_cny" numeric(12, 2),
	"cost_confirmation" text,
	"cost_confirmed_at" timestamp,
	"paused_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_batches_duration_seconds_valid" CHECK ("production_batches"."duration_seconds" BETWEEN 4 AND 15),
	CONSTRAINT "production_batches_wave_size_positive" CHECK ("production_batches"."wave_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "reference_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"creative_reference_id" integer NOT NULL,
	"version" varchar(30) NOT NULL,
	"status" "reference_analysis_status" DEFAULT 'draft' NOT NULL,
	"analysis_snapshot" text NOT NULL,
	"borrowed_structure" text DEFAULT '[]' NOT NULL,
	"excluded_content" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_item_assets" ADD CONSTRAINT "catalog_item_assets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_assets" ADD CONSTRAINT "catalog_item_assets_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_assets" ADD CONSTRAINT "catalog_item_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_primary_asset_id_assets_id_fk" FOREIGN KEY ("primary_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_brand_kit_id_brand_kits_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_references" ADD CONSTRAINT "creative_references_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_references" ADD CONSTRAINT "creative_references_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_references" ADD CONSTRAINT "creative_references_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_spec_versions" ADD CONSTRAINT "creative_spec_versions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_spec_versions" ADD CONSTRAINT "creative_spec_versions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_spec_versions" ADD CONSTRAINT "creative_spec_versions_reference_analysis_id_reference_analyses_id_fk" FOREIGN KEY ("reference_analysis_id") REFERENCES "public"."reference_analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_spec_versions" ADD CONSTRAINT "creative_spec_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_spec_versions" ADD CONSTRAINT "creative_spec_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_production_batch_id_production_batches_id_fk" FOREIGN KEY ("production_batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_creative_spec_version_id_creative_spec_versions_id_fk" FOREIGN KEY ("creative_spec_version_id") REFERENCES "public"."creative_spec_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_default_brand_kit_id_brand_kits_id_fk" FOREIGN KEY ("default_brand_kit_id") REFERENCES "public"."brand_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_analyses" ADD CONSTRAINT "reference_analyses_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_analyses" ADD CONSTRAINT "reference_analyses_creative_reference_id_creative_references_id_fk" FOREIGN KEY ("creative_reference_id") REFERENCES "public"."creative_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_item_assets_item_purpose_position_unique" ON "catalog_item_assets" USING btree ("catalog_item_id","purpose","position");--> statement-breakpoint
CREATE INDEX "catalog_item_assets_team_item_idx" ON "catalog_item_assets" USING btree ("team_id","catalog_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_team_external_sku_unique" ON "catalog_items" USING btree ("team_id","external_sku");--> statement-breakpoint
CREATE INDEX "catalog_items_team_readiness_created_at_idx" ON "catalog_items" USING btree ("team_id","readiness_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_references_team_source_id_unique" ON "creative_references" USING btree ("team_id","source_id");--> statement-breakpoint
CREATE INDEX "creative_references_team_catalog_item_idx" ON "creative_references" USING btree ("team_id","catalog_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_spec_versions_campaign_version_unique" ON "creative_spec_versions" USING btree ("campaign_id","version");--> statement-breakpoint
CREATE INDEX "creative_spec_versions_team_status_created_at_idx" ON "creative_spec_versions" USING btree ("team_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_team_file_hash_unique" ON "import_batches" USING btree ("team_id","file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_team_idempotency_unique" ON "import_batches" USING btree ("team_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "import_batches_team_status_created_at_idx" ON "import_batches" USING btree ("team_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_row_number_unique" ON "import_rows" USING btree ("import_batch_id","row_number");--> statement-breakpoint
CREATE INDEX "import_rows_team_batch_status_idx" ON "import_rows" USING btree ("team_id","import_batch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "production_batch_items_batch_catalog_unique" ON "production_batch_items" USING btree ("production_batch_id","catalog_item_id");--> statement-breakpoint
CREATE INDEX "production_batch_items_team_status_wave_idx" ON "production_batch_items" USING btree ("team_id","status","wave_number");--> statement-breakpoint
CREATE UNIQUE INDEX "production_batches_team_name_unique" ON "production_batches" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "production_batches_team_status_created_at_idx" ON "production_batches" USING btree ("team_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_analyses_reference_version_unique" ON "reference_analyses" USING btree ("creative_reference_id","version");--> statement-breakpoint
CREATE INDEX "reference_analyses_team_status_created_at_idx" ON "reference_analyses" USING btree ("team_id","status","created_at");