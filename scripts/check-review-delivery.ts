import assert from 'node:assert/strict';
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import {
  activityLogs,
  assets,
  ActivityType,
  campaigns,
  catalogItems,
  creativeSpecVersions,
  productionBatchItems,
  productionBatches,
  reviews,
  shotSkillValidationEvidence,
  videoJobs,
} from '../lib/db/schema';
import { evaluateProductionBatchPilot } from '../lib/production-batches/actions';
import { getGuidedProductionBatchDetailForTeam } from '../lib/production-batches/detail';
import { parseFrozenRecipeSnapshot, parseRecordedQualityReport } from '../lib/quality/gates';
import { recordReviewDecision } from '../lib/reviews/decisions';
import { getSingleReviewRemediation } from '../lib/reviews/remediation';

function hasValidFrozenQuality(job: typeof videoJobs.$inferSelect): boolean {
  const recipe = parseFrozenRecipeSnapshot(job.recipeSnapshot, {
    skillId: job.shotSkillId,
    skillVersion: job.shotSkillVersion,
    skillHash: job.shotSkillHash,
  });
  if (!recipe) return false;
  try {
    return parseRecordedQualityReport(JSON.parse(job.qualityReport), {
      observationHash: job.qualityObservationHash,
      skillId: job.shotSkillId,
      skillVersion: job.shotSkillVersion,
      skillHash: job.shotSkillHash,
      recipeHash: recipe.recipeHash,
      qualityChecks: recipe.qualityChecks,
    }) !== null;
  } catch {
    return false;
  }
}

async function main() {
  const candidates = await db.select({
    batch: productionBatches,
    campaign: campaigns,
    item: productionBatchItems,
    job: videoJobs,
  }).from(videoJobs)
    .innerJoin(campaigns, eq(campaigns.id, videoJobs.campaignId))
    .innerJoin(productionBatchItems, eq(productionBatchItems.campaignId, campaigns.id))
    .innerJoin(productionBatches, eq(productionBatches.id, productionBatchItems.productionBatchId))
    .leftJoin(reviews, eq(reviews.videoJobId, videoJobs.id))
    .where(and(
      eq(videoJobs.status, 'succeeded'),
      eq(productionBatches.status, 'review'),
      isNull(reviews.id),
      eq(productionBatches.generationMode, 'single'),
      isNotNull(videoJobs.outputAssetId),
    ))
    .orderBy(desc(videoJobs.completedAt))
    .limit(20);
  const selectedFixture = candidates.find((candidate) => hasValidFrozenQuality(candidate.job));
  if (!selectedFixture) throw new Error('A pending Single review fixture with valid frozen QA is required.');
  const fixture = selectedFixture;
  if (fixture.item.catalogItemId === null) throw new Error('Review delivery fixture requires a CatalogItem.');

  const activityMarker = (await db.select({ id: activityLogs.id }).from(activityLogs)
    .orderBy(desc(activityLogs.id)).limit(1))[0]?.id ?? 0;
  const original = {
    batchStatus: fixture.batch.status,
    generationMode: fixture.batch.generationMode,
    batchUpdatedAt: fixture.batch.updatedAt,
    campaignStatus: fixture.campaign.status,
    campaignUpdatedAt: fixture.campaign.updatedAt,
    itemStatus: fixture.item.status,
    itemIsPilot: fixture.item.isPilot,
    itemUpdatedAt: fixture.item.updatedAt,
  };
  let extraItemIds: number[] = [];

  async function cleanup() {
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`ALTER TABLE shot_skill_validation_evidence DISABLE TRIGGER shot_skill_validation_evidence_append_only`);
      await transaction.delete(shotSkillValidationEvidence).where(and(
        eq(shotSkillValidationEvidence.videoJobId, fixture.job.id),
        inArray(shotSkillValidationEvidence.evidenceType, ['adopted', 'rejected']),
      ));
      await transaction.execute(sql`ALTER TABLE shot_skill_validation_evidence ENABLE TRIGGER shot_skill_validation_evidence_append_only`);
    });
    await db.delete(reviews).where(eq(reviews.videoJobId, fixture.job.id));
    await db.delete(activityLogs).where(and(
      gt(activityLogs.id, activityMarker),
      eq(activityLogs.teamId, fixture.job.teamId),
      eq(activityLogs.userId, fixture.job.submittedBy),
      inArray(activityLogs.action, [ActivityType.ADOPT_VIDEO, ActivityType.REJECT_VIDEO]),
    ));
    await db.transaction(async (transaction) => {
      await transaction.update(productionBatchItems).set({
        status: original.itemStatus,
        isPilot: original.itemIsPilot,
        updatedAt: original.itemUpdatedAt,
      }).where(eq(productionBatchItems.id, fixture.item.id));
      if (extraItemIds.length) {
        await transaction.delete(productionBatchItems).where(inArray(productionBatchItems.id, extraItemIds));
      }
      await transaction.update(productionBatches).set({
        status: original.batchStatus,
        generationMode: original.generationMode,
        updatedAt: original.batchUpdatedAt,
      }).where(eq(productionBatches.id, fixture.batch.id));
      await transaction.update(campaigns).set({
        status: original.campaignStatus,
        updatedAt: original.campaignUpdatedAt,
      }).where(eq(campaigns.id, fixture.campaign.id));
    });
    extraItemIds = [];
  }

  try {
    const adoptedBatchId = await recordReviewDecision({
      decision: 'adopted',
      reason: null,
      reviewerId: fixture.job.submittedBy,
      teamId: fixture.job.teamId,
      videoJobId: fixture.job.id,
      qualityFailureCause: null,
    });
    assert.equal(adoptedBatchId, fixture.batch.id);
    const adopted = (await db.select({
      batchStatus: productionBatches.status,
      itemStatus: productionBatchItems.status,
      campaignStatus: campaigns.status,
      decision: reviews.decision,
    }).from(reviews)
      .innerJoin(videoJobs, eq(videoJobs.id, reviews.videoJobId))
      .innerJoin(campaigns, eq(campaigns.id, videoJobs.campaignId))
      .innerJoin(productionBatchItems, eq(productionBatchItems.campaignId, campaigns.id))
      .innerJoin(productionBatches, eq(productionBatches.id, productionBatchItems.productionBatchId))
      .where(eq(reviews.videoJobId, fixture.job.id)).limit(1))[0];
    assert.deepEqual(adopted, {
      batchStatus: 'completed',
      itemStatus: 'completed',
      campaignStatus: 'completed',
      decision: 'adopted',
    });
    const completedDetail = await getGuidedProductionBatchDetailForTeam(fixture.job.teamId, fixture.batch.id);
    assert.equal(completedDetail?.batch.status, 'completed');
    assert.equal(completedDetail?.items.length, 1);
    assert.equal(completedDetail?.items[0]?.latestReview?.decision, 'adopted');
    assert.equal(completedDetail?.items[0]?.latestJob?.outputAssetId, fixture.job.outputAssetId);
    const singleDeliveryRows = await db.select({
      outputAssetId: videoJobs.outputAssetId,
      outputObjectKey: assets.objectKey,
      specVersion: creativeSpecVersions.version,
      decision: reviews.decision,
    }).from(productionBatchItems)
      .innerJoin(campaigns, eq(campaigns.id, productionBatchItems.campaignId))
      .innerJoin(creativeSpecVersions, eq(creativeSpecVersions.id, productionBatchItems.creativeSpecVersionId))
      .innerJoin(videoJobs, eq(videoJobs.campaignId, campaigns.id))
      .innerJoin(assets, eq(assets.id, videoJobs.outputAssetId))
      .innerJoin(reviews, eq(reviews.videoJobId, videoJobs.id))
      .where(and(
        eq(productionBatchItems.teamId, fixture.job.teamId),
        eq(productionBatchItems.productionBatchId, fixture.batch.id),
        eq(reviews.decision, 'adopted'),
      ));
    assert.equal(singleDeliveryRows.length, 1);
    assert.equal(singleDeliveryRows[0]?.outputAssetId, fixture.job.outputAssetId);
    assert.ok(singleDeliveryRows[0]?.outputObjectKey);
    assert.ok(singleDeliveryRows[0]?.specVersion);
    assert.equal(singleDeliveryRows[0]?.decision, 'adopted');
    await cleanup();

    await recordReviewDecision({
      decision: 'not_adopted',
      reason: 'Provider output contains a technical playback defect.',
      reviewerId: fixture.job.submittedBy,
      teamId: fixture.job.teamId,
      videoJobId: fixture.job.id,
      qualityFailureCause: 'technical',
    });
    const rejected = (await db.select({
      batchStatus: productionBatches.status,
      itemStatus: productionBatchItems.status,
      campaignStatus: campaigns.status,
      decision: reviews.decision,
      cause: reviews.qualityFailureCause,
      reason: reviews.reason,
    }).from(reviews)
      .innerJoin(videoJobs, eq(videoJobs.id, reviews.videoJobId))
      .innerJoin(campaigns, eq(campaigns.id, videoJobs.campaignId))
      .innerJoin(productionBatchItems, eq(productionBatchItems.campaignId, campaigns.id))
      .innerJoin(productionBatches, eq(productionBatches.id, productionBatchItems.productionBatchId))
      .where(eq(reviews.videoJobId, fixture.job.id)).limit(1))[0];
    assert.equal(rejected?.batchStatus, 'ready_to_generate');
    assert.equal(rejected?.itemStatus, 'ready');
    assert.equal(rejected?.campaignStatus, 'ready');
    assert.equal(rejected?.decision, 'not_adopted');
    assert.equal(rejected?.cause, 'technical');
    assert.match(rejected?.reason ?? '', /playback defect/);
    const rejectedDetail = await getGuidedProductionBatchDetailForTeam(fixture.job.teamId, fixture.batch.id);
    assert.ok(rejectedDetail?.blockers.some((blocker) => blocker.code === 'review_retry_technical' && blocker.href?.endsWith('#next-action')));
    await cleanup();

    const extraCatalogs = await db.select({ id: catalogItems.id }).from(catalogItems).where(and(
      eq(catalogItems.teamId, fixture.job.teamId),
      ne(catalogItems.id, fixture.item.catalogItemId),
    )).limit(2);
    assert.equal(extraCatalogs.length, 2, 'Bulk Pilot preservation check requires two additional Workspace SKU.');
    await db.transaction(async (transaction) => {
      await transaction.update(productionBatches).set({ generationMode: 'bulk', status: 'pilot_review' })
        .where(eq(productionBatches.id, fixture.batch.id));
      await transaction.update(productionBatchItems).set({ isPilot: true, status: 'review' })
        .where(eq(productionBatchItems.id, fixture.item.id));
      const inserted = await transaction.insert(productionBatchItems).values(extraCatalogs.map((catalog) => ({
        teamId: fixture.job.teamId,
        productionBatchId: fixture.batch.id,
        catalogItemId: catalog.id,
        status: 'pending' as const,
        isPilot: true,
        waveNumber: 0,
      }))).returning({ id: productionBatchItems.id });
      extraItemIds = inserted.map((row) => row.id);
    });
    await recordReviewDecision({
      decision: 'adopted',
      reason: null,
      reviewerId: fixture.job.submittedBy,
      teamId: fixture.job.teamId,
      videoJobId: fixture.job.id,
      qualityFailureCause: null,
    });
    const pilot = await evaluateProductionBatchPilot({ teamId: fixture.job.teamId, userId: fixture.job.submittedBy, batchId: fixture.batch.id });
    assert.equal(pilot.adoptedPilotSkuCount, 1);
    assert.equal(pilot.passed, false);
    const bulkBatch = (await db.select({ status: productionBatches.status }).from(productionBatches)
      .where(eq(productionBatches.id, fixture.batch.id)).limit(1))[0];
    assert.equal(bulkBatch?.status, 'pilot_review');

    for (const cause of ['technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change'] as const) {
      const remediation = getSingleReviewRemediation({
        cause,
        batchId: fixture.batch.id,
        catalogItemId: fixture.item.catalogItemId,
        campaignId: fixture.campaign.id,
        specVersionId: fixture.item.creativeSpecVersionId!,
      });
      assert.ok(remediation.href.startsWith('/dashboard/'));
      assert.ok(remediation.label.length > 0);
    }
  } finally {
    await cleanup();
  }
  console.info('Review completion and delivery checks passed.');
}

void main();
