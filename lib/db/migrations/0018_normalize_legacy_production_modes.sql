UPDATE "production_batches" AS "batch"
SET
  "status" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "production_batch_items" AS "item"
      WHERE "item"."production_batch_id" = "batch"."id"
    ) AND NOT EXISTS (
      SELECT 1 FROM "production_batch_items" AS "item"
      WHERE
        "item"."production_batch_id" = "batch"."id"
        AND "item"."status" NOT IN ('completed', 'excluded')
    ) THEN 'completed'::"production_batch_status"
    WHEN EXISTS (
      SELECT 1
      FROM "production_batch_items" AS "item"
      JOIN "video_jobs" AS "job" ON "job"."campaign_id" = "item"."campaign_id"
      LEFT JOIN "reviews" AS "review" ON "review"."video_job_id" = "job"."id"
      WHERE
        "item"."production_batch_id" = "batch"."id"
        AND "job"."status" = 'succeeded'
        AND "review"."id" IS NULL
    ) THEN 'review'::"production_batch_status"
    WHEN EXISTS (
      SELECT 1
      FROM "production_batch_items" AS "item"
      JOIN "video_jobs" AS "job" ON "job"."campaign_id" = "item"."campaign_id"
      WHERE
        "item"."production_batch_id" = "batch"."id"
        AND "job"."status" IN ('queued', 'generating')
    ) THEN 'generating'::"production_batch_status"
    WHEN EXISTS (
      SELECT 1 FROM "production_batch_items" AS "item"
      WHERE
        "item"."production_batch_id" = "batch"."id"
        AND "item"."creative_spec_version_id" IS NOT NULL
    ) THEN 'ready_to_generate'::"production_batch_status"
    WHEN EXISTS (
      SELECT 1 FROM "production_batch_items" AS "item"
      WHERE
        "item"."production_batch_id" = "batch"."id"
        AND "item"."campaign_id" IS NOT NULL
    ) THEN 'ready_for_spec'::"production_batch_status"
    ELSE 'draft'::"production_batch_status"
  END,
  "paused_from_status" = NULL,
  "updated_at" = now()
WHERE
  "batch"."generation_mode" = 'single'
  AND "batch"."status" IN ('calibrating', 'pilot_review', 'ready', 'producing', 'reviewing');