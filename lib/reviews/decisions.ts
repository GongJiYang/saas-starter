import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  activityLogs,
  ActivityType,
  campaigns,
  productionBatchItems,
  productionBatches,
  reviews,
  shotSkillValidationEvidence,
  videoJobs,
} from '@/lib/db/schema';
import { assertProductionBatchModeTransition } from '@/lib/production-batches/state';
import { createReviewDecisionEvidencePlan, parseFrozenRecipeSnapshot, parseRecordedQualityReport, type ReviewDecisionEvidencePlan } from '@/lib/quality/gates';
import type { ReviewRejectionCause } from './remediation';

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function recordReviewDecision(input: {
  decision: 'adopted' | 'not_adopted';
  reason: string | null;
  reviewerId: number;
  teamId: number;
  videoJobId: number;
  qualityFailureCause: ReviewRejectionCause | null;
  productionBatchId?: number;
}): Promise<number | null> {
  return db.transaction(async (transaction) => {
    const videoJob = (await transaction.select().from(videoJobs).where(and(
      eq(videoJobs.id, input.videoJobId),
      eq(videoJobs.teamId, input.teamId),
    )).limit(1))[0];
    if (!videoJob || videoJob.status !== 'succeeded' || !videoJob.outputAssetId) {
      throw new Error('Video job is not ready for review.');
    }

    const isUploadedImageJob = videoJob.campaignId === null && videoJob.productionBatchItemId !== null;
    if (isUploadedImageJob) {
      const latestJob = (await transaction.select({ id: videoJobs.id, status: videoJobs.status }).from(videoJobs).where(and(
        eq(videoJobs.teamId, input.teamId),
        eq(videoJobs.productionBatchItemId, videoJob.productionBatchItemId!),
      )).orderBy(sql`${videoJobs.createdAt} DESC`).limit(1))[0];
      if (!latestJob || latestJob.id !== videoJob.id) throw new Error('Only the latest Image-to-Video Job can be reviewed.');
    }
    let decisionPlan: ReviewDecisionEvidencePlan | {
      review: ReviewDecisionEvidencePlan['review'];
      evidence: null;
      batchItemStatus: 'completed' | 'ready';
    };
    if (isUploadedImageJob) {
      if (input.decision === 'not_adopted' && (!input.reason?.trim() || !input.qualityFailureCause)) {
        throw new Error('Rejection requires a structured cause and reason.');
      }
      decisionPlan = {
        review: {
          decision: input.decision,
          reason: input.reason,
          qualityFailureCause: input.qualityFailureCause,
          qualityReport: videoJob.qualityReport !== '{}' ? videoJob.qualityReport : JSON.stringify({
            kind: 'image_to_video_review',
            recipeSnapshot: videoJob.recipeSnapshot,
            outputAssetId: videoJob.outputAssetId,
          }),
        },
        evidence: null,
        batchItemStatus: input.decision === 'adopted' ? 'completed' : 'ready',
      };
    } else {
      const recipe = parseFrozenRecipeSnapshot(videoJob.recipeSnapshot, {
        skillId: videoJob.shotSkillId,
        skillVersion: videoJob.shotSkillVersion,
        skillHash: videoJob.shotSkillHash,
      });
      const quality = recipe ? parseRecordedQualityReport(parseJson(videoJob.qualityReport), {
        observationHash: videoJob.qualityObservationHash,
        skillId: videoJob.shotSkillId,
        skillVersion: videoJob.shotSkillVersion,
        skillHash: videoJob.shotSkillHash,
        recipeHash: recipe.recipeHash,
        qualityChecks: recipe.qualityChecks,
      }) : null;
      if (!quality) throw new Error('VideoJob does not have a valid frozen quality report.');
      decisionPlan = createReviewDecisionEvidencePlan({
        decision: input.decision,
        reason: input.reason,
        rejectionCause: input.qualityFailureCause,
      }, quality);
    }

    const batchContext = (await transaction.select({
      batch: productionBatches,
      item: productionBatchItems,
    }).from(productionBatchItems)
      .innerJoin(productionBatches, eq(productionBatchItems.productionBatchId, productionBatches.id))
      .where(and(
        eq(productionBatchItems.teamId, input.teamId),
        eq(productionBatches.teamId, input.teamId),
        ...(input.productionBatchId === undefined ? [] : [eq(productionBatches.id, input.productionBatchId)]),
        isUploadedImageJob
          ? eq(productionBatchItems.id, videoJob.productionBatchItemId!)
          : eq(productionBatchItems.campaignId, videoJob.campaignId!),
      ))
      .limit(1))[0];
    if (!batchContext) throw new Error('Video job is not available in the requested Production Batch.');
    if (batchContext?.batch.generationMode === 'single' && batchContext.batch.status !== 'review') {
      throw new Error('Resume Single production and wait for review before recording a decision.');
    }

    const existingReview = await transaction.select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.videoJobId, videoJob.id), eq(reviews.teamId, input.teamId)))
      .limit(1);
    if (existingReview[0]) throw new Error('Video job has already been reviewed.');

    const createdReview = await transaction.insert(reviews).values({
      ...decisionPlan.review,
      reviewerId: input.reviewerId,
      teamId: input.teamId,
      videoJobId: videoJob.id,
    }).returning({ id: reviews.id });
    if (!isUploadedImageJob && videoJob.shotSkillVersionId && createdReview[0] && decisionPlan.evidence) {
      await transaction.insert(shotSkillValidationEvidence).values({
        teamId: input.teamId,
        shotSkillVersionId: videoJob.shotSkillVersionId,
        videoJobId: videoJob.id,
        reviewId: createdReview[0].id,
        ...decisionPlan.evidence,
      });
    }
    await transaction.update(productionBatchItems).set({
      status: batchContext?.batch.generationMode === 'single' && input.decision === 'not_adopted'
        ? 'ready'
        : decisionPlan.batchItemStatus,
      updatedAt: new Date(),
    }).where(and(
      eq(productionBatchItems.teamId, input.teamId),
      isUploadedImageJob
        ? eq(productionBatchItems.id, videoJob.productionBatchItemId!)
        : eq(productionBatchItems.campaignId, videoJob.campaignId!),
    ));
    if (!isUploadedImageJob && batchContext.batch.generationMode === 'single') {
      const nextStatus = input.decision === 'adopted' ? 'completed' as const : 'ready_to_generate' as const;
      assertProductionBatchModeTransition('single', batchContext.batch.status, nextStatus);
      await transaction.update(productionBatches).set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(productionBatches.id, batchContext.batch.id));
      await transaction.update(campaigns).set({
        status: input.decision === 'adopted' ? 'completed' : 'ready',
        updatedAt: new Date(),
      }).where(and(eq(campaigns.id, videoJob.campaignId!), eq(campaigns.teamId, input.teamId)));
    }
    if (isUploadedImageJob && batchContext.batch.status === 'producing') {
      const remaining = await transaction.select({ id: productionBatchItems.id }).from(productionBatchItems).where(and(
        eq(productionBatchItems.teamId, input.teamId),
        eq(productionBatchItems.productionBatchId, batchContext.batch.id),
        inArray(productionBatchItems.status, ['pending', 'pilot', 'ready', 'queued', 'producing', 'quality_review', 'review', 'failed']),
      )).limit(1);
      if (remaining.length === 0) {
        assertProductionBatchModeTransition('bulk', 'producing', 'reviewing');
        assertProductionBatchModeTransition('bulk', 'reviewing', 'completed');
        await transaction.update(productionBatches).set({ status: 'completed', updatedAt: new Date() }).where(and(
          eq(productionBatches.id, batchContext.batch.id),
          eq(productionBatches.teamId, input.teamId),
        ));
      }
    }
    await transaction.insert(activityLogs).values({
      action: input.decision === 'adopted' ? ActivityType.ADOPT_VIDEO : ActivityType.REJECT_VIDEO,
      teamId: input.teamId,
      userId: input.reviewerId,
    });
    return batchContext?.batch.id ?? null;
  });
}
