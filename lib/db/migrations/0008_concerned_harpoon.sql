CREATE TABLE "brand_kit_preference_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_kit_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"version" integer NOT NULL,
	"preference" text NOT NULL,
	"source_batch_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_kit_preference_versions" ADD CONSTRAINT "brand_kit_preference_versions_brand_kit_id_brand_kits_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit_preference_versions" ADD CONSTRAINT "brand_kit_preference_versions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit_preference_versions" ADD CONSTRAINT "brand_kit_preference_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kit_preference_versions_brand_version_unique" ON "brand_kit_preference_versions" USING btree ("brand_kit_id","version");--> statement-breakpoint
CREATE INDEX "brand_kit_preference_versions_team_created_at_idx" ON "brand_kit_preference_versions" USING btree ("team_id","created_at");