CREATE TABLE "reference_benchmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"creative_reference_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"provider" varchar(50) DEFAULT 'minimax' NOT NULL,
	"model" varchar(80) DEFAULT 'h3' NOT NULL,
	"status" varchar(30) DEFAULT 'recorded' NOT NULL,
	"cost_cny" numeric(12, 2),
	"continuity_score" numeric(5, 4),
	"product_accuracy_score" numeric(5, 4),
	"notes" text,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"outperforms_structure" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reference_benchmarks_cost_nonnegative" CHECK ("reference_benchmarks"."cost_cny" IS NULL OR "reference_benchmarks"."cost_cny" >= 0),
	CONSTRAINT "reference_benchmarks_continuity_range" CHECK ("reference_benchmarks"."continuity_score" IS NULL OR ("reference_benchmarks"."continuity_score" BETWEEN 0 AND 1)),
	CONSTRAINT "reference_benchmarks_product_accuracy_range" CHECK ("reference_benchmarks"."product_accuracy_score" IS NULL OR ("reference_benchmarks"."product_accuracy_score" BETWEEN 0 AND 1))
);
--> statement-breakpoint
ALTER TABLE "creative_references" ADD COLUMN "duration_seconds" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "creative_references" ADD COLUMN "ratio" varchar(10);--> statement-breakpoint
ALTER TABLE "creative_references" ADD COLUMN "video_codec" varchar(50);--> statement-breakpoint
ALTER TABLE "creative_references" ADD COLUMN "audio_codec" varchar(50);--> statement-breakpoint
ALTER TABLE "creative_references" ADD COLUMN "has_audio_track" boolean;--> statement-breakpoint
ALTER TABLE "creative_references" ADD COLUMN "readability_status" varchar(30) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "creative_references" ADD COLUMN "readability_error" text;--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD COLUMN "creative_reference_id" integer;--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "default_creative_reference_id" integer;--> statement-breakpoint
ALTER TABLE "reference_analyses" ADD COLUMN "model" varchar(80) DEFAULT 'heuristic-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "reference_analyses" ADD COLUMN "prompt_version" varchar(30);--> statement-breakpoint
ALTER TABLE "reference_analyses" ADD COLUMN "analysis_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "reference_benchmarks" ADD CONSTRAINT "reference_benchmarks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_benchmarks" ADD CONSTRAINT "reference_benchmarks_creative_reference_id_creative_references_id_fk" FOREIGN KEY ("creative_reference_id") REFERENCES "public"."creative_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_benchmarks" ADD CONSTRAINT "reference_benchmarks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reference_benchmarks_team_reference_unique" ON "reference_benchmarks" USING btree ("team_id","creative_reference_id");--> statement-breakpoint
CREATE INDEX "reference_benchmarks_team_created_at_idx" ON "reference_benchmarks" USING btree ("team_id","created_at");--> statement-breakpoint
ALTER TABLE "production_batch_items" ADD CONSTRAINT "production_batch_items_creative_reference_id_creative_references_id_fk" FOREIGN KEY ("creative_reference_id") REFERENCES "public"."creative_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_default_creative_reference_id_creative_references_id_fk" FOREIGN KEY ("default_creative_reference_id") REFERENCES "public"."creative_references"("id") ON DELETE no action ON UPDATE no action;