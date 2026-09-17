ALTER TYPE "public"."production_batch_status" ADD VALUE 'ready_for_spec' BEFORE 'calibrating';--> statement-breakpoint
ALTER TYPE "public"."production_batch_status" ADD VALUE 'ready_to_generate' BEFORE 'calibrating';--> statement-breakpoint
ALTER TYPE "public"."production_batch_status" ADD VALUE 'generating' BEFORE 'calibrating';--> statement-breakpoint
ALTER TYPE "public"."production_batch_status" ADD VALUE 'review' BEFORE 'calibrating';--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "paused_from_status" "production_batch_status";