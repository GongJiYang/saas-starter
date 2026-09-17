ALTER TABLE "production_batches" ADD COLUMN "skill_version_lock" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "shot_cards" ADD COLUMN "shot_skill_version_id" integer;--> statement-breakpoint
ALTER TABLE "shot_cards" ADD COLUMN "skill_selection_reason" text;--> statement-breakpoint
ALTER TABLE "shot_cards" ADD COLUMN "skill_eligibility" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "shot_cards" AS card
SET
  "shot_skill_version_id" = latest."shot_skill_version_id",
  "skill_selection_reason" = latest."selection_reason"
FROM (
  SELECT DISTINCT ON ("shot_card_id")
    "shot_card_id",
    "shot_skill_version_id",
    ("recipe_snapshot"::jsonb ->> 'selectionReason') AS "selection_reason"
  FROM "video_jobs"
  WHERE "shot_skill_version_id" IS NOT NULL AND "recipe_snapshot" IS NOT NULL
  ORDER BY "shot_card_id", "created_at" DESC
) AS latest
WHERE card."id" = latest."shot_card_id";--> statement-breakpoint
ALTER TABLE "shot_cards" ADD CONSTRAINT "shot_cards_shot_skill_version_id_shot_skill_versions_id_fk" FOREIGN KEY ("shot_skill_version_id") REFERENCES "public"."shot_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shot_cards_skill_version_idx" ON "shot_cards" USING btree ("shot_skill_version_id");