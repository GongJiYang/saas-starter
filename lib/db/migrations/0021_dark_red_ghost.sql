ALTER TABLE "asset_uploads" ADD COLUMN "production_batch_id" integer;--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD COLUMN "client_file_id" varchar(100);--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD COLUMN "sequence" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "production_batches_id_team_unique" ON "production_batches" ("id", "team_id");--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_batch_team_fk" FOREIGN KEY ("production_batch_id","team_id") REFERENCES "public"."production_batches"("id","team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_uploads_batch_client_file_unique" ON "asset_uploads" USING btree ("production_batch_id","client_file_id");--> statement-breakpoint