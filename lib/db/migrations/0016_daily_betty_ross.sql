CREATE TYPE "public"."asset_upload_source" AS ENUM('legacy', 'local_upload', 'remote_archive', 'csv_import', 'generated');--> statement-breakpoint
CREATE TYPE "public"."asset_upload_stage" AS ENUM('signing', 'transfer', 'verification', 'archive', 'complete');--> statement-breakpoint
CREATE TYPE "public"."asset_upload_status" AS ENUM('signed', 'uploading', 'uploaded', 'archiving', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."production_generation_mode" AS ENUM('single', 'bulk');--> statement-breakpoint
CREATE TABLE "asset_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"asset_id" integer,
	"source" "asset_upload_source" NOT NULL,
	"status" "asset_upload_status" DEFAULT 'signed' NOT NULL,
	"stage" "asset_upload_stage" DEFAULT 'signing' NOT NULL,
	"object_key" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_at" timestamp,
	"archived_at" timestamp,
	"failed_at" timestamp,
	"expires_at" timestamp,
	"error_code" varchar(100),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_uploads_byte_size_positive" CHECK ("asset_uploads"."byte_size" > 0),
	CONSTRAINT "asset_uploads_completed_valid" CHECK ("asset_uploads"."status" <> 'completed' OR ("asset_uploads"."asset_id" IS NOT NULL AND "asset_uploads"."archived_at" IS NOT NULL)),
	CONSTRAINT "asset_uploads_failed_valid" CHECK ("asset_uploads"."status" <> 'failed' OR ("asset_uploads"."error_code" IS NOT NULL AND "asset_uploads"."failed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_primary_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "upload_source" "asset_upload_source" DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "generation_mode" "production_generation_mode";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "production_batches" AS "batch"
		LEFT JOIN "production_batch_items" AS "item" ON "item"."production_batch_id" = "batch"."id"
		GROUP BY "batch"."id"
		HAVING count("item"."id") <> 1 AND count("item"."id") < 3
	) THEN
		RAISE EXCEPTION 'Cannot backfill production generation mode: every Batch must contain exactly one or at least three SKU.';
	END IF;
END;
$$;--> statement-breakpoint
UPDATE "production_batches" AS "batch"
SET "generation_mode" = CASE
	WHEN (SELECT count(*) FROM "production_batch_items" AS "item" WHERE "item"."production_batch_id" = "batch"."id") = 1 THEN 'single'::"production_generation_mode"
	ELSE 'bulk'::"production_generation_mode"
END;--> statement-breakpoint
ALTER TABLE "production_batches" ALTER COLUMN "generation_mode" SET NOT NULL;--> statement-breakpoint
UPDATE "assets" SET "upload_source" = 'generated' WHERE "type" = 'generated_video';--> statement-breakpoint
CREATE UNIQUE INDEX "assets_id_team_unique" ON "assets" USING btree ("id","team_id");--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_asset_team_fk" FOREIGN KEY ("asset_id","team_id") REFERENCES "public"."assets"("id","team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_uploads_team_object_key_unique" ON "asset_uploads" USING btree ("team_id","object_key");--> statement-breakpoint
CREATE INDEX "asset_uploads_team_status_created_at_idx" ON "asset_uploads" USING btree ("team_id","status","created_at");--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_primary_asset_team_fk" FOREIGN KEY ("primary_asset_id","team_id") REFERENCES "public"."assets"("id","team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_ready_requires_primary_asset" CHECK ("catalog_items"."readiness_status" <> 'ready' OR "catalog_items"."primary_asset_id" IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_production_batch_generation_mode_sku_count(target_batch_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	mode_value "production_generation_mode";
	sku_count integer;
BEGIN
	SELECT "generation_mode" INTO mode_value
	FROM "production_batches"
	WHERE "id" = target_batch_id;
	IF NOT FOUND THEN
		RETURN;
	END IF;

	SELECT count(*) INTO sku_count
	FROM "production_batch_items"
	WHERE "production_batch_id" = target_batch_id;

	IF mode_value = 'single' AND sku_count <> 1 THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			CONSTRAINT = 'production_batches_generation_mode_sku_count',
			MESSAGE = format('Single generation Batch %s must contain exactly one SKU; found %s.', target_batch_id, sku_count);
	END IF;
	IF mode_value = 'bulk' AND sku_count < 3 THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			CONSTRAINT = 'production_batches_generation_mode_sku_count',
			MESSAGE = format('Batch production %s must contain at least three SKU; found %s.', target_batch_id, sku_count);
	END IF;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_production_batch_generation_mode_sku_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_TABLE_NAME = 'production_batches' THEN
		PERFORM assert_production_batch_generation_mode_sku_count(CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END);
	ELSIF TG_OP = 'DELETE' THEN
		PERFORM assert_production_batch_generation_mode_sku_count(OLD."production_batch_id");
	ELSIF TG_OP = 'INSERT' THEN
		PERFORM assert_production_batch_generation_mode_sku_count(NEW."production_batch_id");
	ELSE
		PERFORM assert_production_batch_generation_mode_sku_count(OLD."production_batch_id");
		IF NEW."production_batch_id" <> OLD."production_batch_id" THEN
			PERFORM assert_production_batch_generation_mode_sku_count(NEW."production_batch_id");
		END IF;
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "production_batches_generation_mode_sku_count"
AFTER INSERT OR UPDATE ON "production_batches"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_production_batch_generation_mode_sku_count();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "production_batch_items_generation_mode_sku_count"
AFTER INSERT OR UPDATE OR DELETE ON "production_batch_items"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_production_batch_generation_mode_sku_count();