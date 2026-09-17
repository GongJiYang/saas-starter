CREATE TYPE "public"."production_prompt_mode" AS ENUM('inherit', 'override');--> statement-breakpoint
CREATE TYPE "public"."production_source_mode" AS ENUM('catalog', 'uploaded_images');--> statement-breakpoint
DROP INDEX "production_batch_items_batch_catalog_unique";--> statement-breakpoint
ALTER TABLE "production_batch_items" ALTER COLUMN "catalog_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ALTER COLUMN "shot_card_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD COLUMN "input_asset_id" integer;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD COLUMN "sequence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD COLUMN "prompt_mode" "production_prompt_mode" DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD COLUMN "prompt_override" text;--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "source_mode" "production_source_mode" DEFAULT 'catalog' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "shared_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "shared_prompt_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "production_batch_item_id" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "input_asset_id" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" DROP CONSTRAINT "video_jobs_new_recipe_complete";--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_input_asset_id_assets_id_fk" FOREIGN KEY ("input_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_input_asset_team_fk" FOREIGN KEY ("input_asset_id","team_id") REFERENCES "public"."assets"("id","team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_batch_items_id_team_unique" ON "production_batch_items" USING btree ("id","team_id");--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_batch_item_team_fk" FOREIGN KEY ("production_batch_item_id","team_id") REFERENCES "public"."production_batch_items"("id","team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_input_asset_team_fk" FOREIGN KEY ("input_asset_id","team_id") REFERENCES "public"."assets"("id","team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_batch_items_batch_input_asset_unique" ON "production_batch_items" USING btree ("production_batch_id","input_asset_id") WHERE "production_batch_items"."input_asset_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "video_jobs_active_batch_item_unique" ON "video_jobs" USING btree ("production_batch_item_id") WHERE "video_jobs"."status" IN ('queued', 'generating');--> statement-breakpoint
CREATE INDEX "video_jobs_batch_item_created_at_idx" ON "video_jobs" USING btree ("production_batch_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "production_batch_items_batch_catalog_unique" ON "production_batch_items" USING btree ("production_batch_id","catalog_item_id") WHERE "production_batch_items"."catalog_item_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_sequence_positive" CHECK ("production_batch_items"."sequence" > 0);--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_source_shape" CHECK (("production_batch_items"."catalog_item_id" IS NOT NULL AND "production_batch_items"."input_asset_id" IS NULL)
        OR ("production_batch_items"."catalog_item_id" IS NULL AND "production_batch_items"."input_asset_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_prompt_shape" CHECK (("production_batch_items"."prompt_mode" = 'inherit' AND "production_batch_items"."prompt_override" IS NULL)
        OR ("production_batch_items"."prompt_mode" = 'override' AND length(trim("production_batch_items"."prompt_override")) > 0));--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_shared_prompt_version_positive" CHECK ("production_batches"."shared_prompt_version" > 0);--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_context_shape" CHECK (("video_jobs"."campaign_id" IS NULL AND "video_jobs"."shot_card_id" IS NULL AND "video_jobs"."creative_spec_version_id" IS NULL)
        OR ("video_jobs"."campaign_id" IS NOT NULL AND "video_jobs"."shot_card_id" IS NOT NULL));
WITH ranked_items AS (
  SELECT id, row_number() OVER (PARTITION BY production_batch_id ORDER BY id)::integer AS sequence
  FROM production_batch_items
)
UPDATE production_batch_items
SET sequence = ranked_items.sequence
FROM ranked_items
WHERE production_batch_items.id = ranked_items.id;--> statement-breakpoint
UPDATE video_jobs
SET production_batch_item_id = production_batch_items.id,
    input_asset_id = campaigns.product_asset_id
FROM production_batch_items
INNER JOIN campaigns ON campaigns.id = production_batch_items.campaign_id
WHERE video_jobs.team_id = production_batch_items.team_id
  AND video_jobs.campaign_id = production_batch_items.campaign_id;--> statement-breakpoint