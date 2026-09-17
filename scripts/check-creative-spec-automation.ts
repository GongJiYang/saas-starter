import assert from 'node:assert/strict';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import {
  approveCreativeSpec,
  approveCreativeSpecs,
  listCreativeSpecsForTeam,
  submitCreativeSpecForApproval,
} from '../lib/creative-spec/actions';
import { createProductionBatch, selectProductionBatchPilots } from '../lib/production-batches/actions';
import {
  createPilotSpecDrafts,
  createProductionBatchItemSpecDraft,
  ensureProductionBatchItemCampaign,
} from '../lib/production-batches/spec-automation';
import { db } from '../lib/db/drizzle';
import {
  activityLogs,
  campaigns,
  catalogItems,
  creativeSpecVersions,
  productionBatchItems,
  productionBatches,
  shotCards,
  teamMembers,
} from '../lib/db/schema';

async function findFixture() {
  const owners = await db.select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.role, 'owner'));
  for (const owner of owners) {
    const items = await db.select({ id: catalogItems.id })
      .from(catalogItems)
      .where(and(
        eq(catalogItems.teamId, owner.teamId),
        eq(catalogItems.readinessStatus, 'ready'),
      ))
      .orderBy(desc(catalogItems.createdAt))
      .limit(3);
    if (items.length === 3) return { ...owner, catalogItemIds: items.map((item) => item.id) };
  }
  throw new Error('A Workspace owner with three ready SKU is required for the Spec automation check.');
}

async function main() {
  const fixture = await findFixture();
  const stamp = Date.now();
  const lastLogId = (await db.select({ id: activityLogs.id }).from(activityLogs).orderBy(desc(activityLogs.id)).limit(1))[0]?.id ?? 0;
  const batchIds: number[] = [];
  try {
    const single = await createProductionBatch({
      teamId: fixture.teamId,
      userId: fixture.userId,
      data: {
        name: `spec-automation-single-${stamp}`,
        catalogItemIds: [fixture.catalogItemIds[0]],
        targetPlatform: 'tiktok',
        durationSeconds: 5,
        campaignGoal: 'Verify automatic Single Spec binding.',
        waveSize: 10,
        stopLossConfig: {},
      },
    });
    batchIds.push(single.id);
    const singleItem = (await db.select().from(productionBatchItems).where(eq(
      productionBatchItems.productionBatchId,
      single.id,
    )).limit(1))[0];
    assert.ok(singleItem);

    const singleDraft = await createProductionBatchItemSpecDraft({
      teamId: fixture.teamId,
      userId: fixture.userId,
      batchId: single.id,
      itemId: singleItem.id,
    });
    const repeatedSingleDraft = await createProductionBatchItemSpecDraft({
      teamId: fixture.teamId,
      userId: fixture.userId,
      batchId: single.id,
      itemId: singleItem.id,
    });
    assert.equal(singleDraft.created, true);
    assert.equal(repeatedSingleDraft.created, false);
    assert.equal(repeatedSingleDraft.campaignId, singleDraft.campaignId);
    assert.equal(repeatedSingleDraft.specVersionId, singleDraft.specVersionId);
    const repeatedCampaign = await ensureProductionBatchItemCampaign({
      teamId: fixture.teamId,
      userId: fixture.userId,
      batchId: single.id,
      itemId: singleItem.id,
    });
    assert.equal(repeatedCampaign.created, false);
    assert.equal(repeatedCampaign.campaignId, singleDraft.campaignId);

    await submitCreativeSpecForApproval({ teamId: fixture.teamId, specVersionId: singleDraft.specVersionId });
    await db.update(productionBatches).set({
      specHash: 'a'.repeat(64),
      maxEstimatedCostCny: '99.00',
      costConfirmation: JSON.stringify({ confirmed: true }),
      costConfirmedAt: new Date(),
    }).where(eq(productionBatches.id, single.id));
    const singleApproval = await approveCreativeSpec({
      teamId: fixture.teamId,
      userId: fixture.userId,
      specVersionId: singleDraft.specVersionId,
    });
    assert.equal(singleApproval.binding?.productionBatchId, single.id);
    assert.equal(singleApproval.binding?.itemId, singleItem.id);
    assert.equal(singleApproval.binding?.batchStatus, 'ready_to_generate');
    const boundSingleItem = (await db.select().from(productionBatchItems).where(eq(productionBatchItems.id, singleItem.id)).limit(1))[0]!;
    assert.equal(boundSingleItem.creativeSpecVersionId, singleDraft.specVersionId);
    const advancedSingle = (await db.select().from(productionBatches).where(eq(productionBatches.id, single.id)).limit(1))[0]!;
    assert.equal(advancedSingle.status, 'ready_to_generate');
    assert.equal(advancedSingle.specHash, null);
    assert.equal(advancedSingle.maxEstimatedCostCny, null);
    assert.equal(advancedSingle.costConfirmation, null);
    assert.equal(advancedSingle.costConfirmedAt, null);

    const sourceCards = await listCreativeSpecsForTeam(fixture.teamId);
    const sourceCard = sourceCards.find((spec) => spec.id === singleDraft.specVersionId);
    assert.equal(sourceCard?.sourceContext.productionBatchId, single.id);
    assert.equal(sourceCard?.sourceContext.productionBatchItemId, singleItem.id);
    assert.ok(sourceCard?.sourceContext.externalSku);
    assert.ok(sourceCard?.sourceContext.brandKitName);
    assert.ok(sourceCard?.sourceContext.campaignName);
    assert.ok(sourceCard?.sourceContext.skillVersion);

    const bulk = await createProductionBatch({
      teamId: fixture.teamId,
      userId: fixture.userId,
      data: {
        name: `spec-automation-bulk-${stamp}`,
        catalogItemIds: fixture.catalogItemIds,
        targetPlatform: 'tiktok',
        durationSeconds: 5,
        campaignGoal: 'Verify automatic Pilot Spec binding.',
        waveSize: 10,
        stopLossConfig: {},
      },
    });
    batchIds.push(bulk.id);
    await selectProductionBatchPilots({ teamId: fixture.teamId, userId: fixture.userId, batchId: bulk.id });
    const firstBulkDrafts = await createPilotSpecDrafts({ teamId: fixture.teamId, userId: fixture.userId, batchId: bulk.id });
    const secondBulkDrafts = await createPilotSpecDrafts({ teamId: fixture.teamId, userId: fixture.userId, batchId: bulk.id });
    assert.equal(firstBulkDrafts.results.length, 3);
    assert.equal(secondBulkDrafts.results.length, 3);
    assert.ok(firstBulkDrafts.results.every((result) => !('error' in result)));
    assert.ok(secondBulkDrafts.results.every((result) => !('error' in result) && result.created === false));
    const bulkDrafts = firstBulkDrafts.results.filter((result): result is Exclude<typeof result, { error: string }> => !('error' in result));
    assert.deepEqual(
      secondBulkDrafts.results.map((result) => 'specVersionId' in result ? result.specVersionId : null).sort(),
      bulkDrafts.map((result) => result.specVersionId).sort(),
    );

    for (const draft of bulkDrafts) {
      await submitCreativeSpecForApproval({ teamId: fixture.teamId, specVersionId: draft.specVersionId });
    }
    await db.update(productionBatches).set({
      specHash: 'b'.repeat(64),
      maxEstimatedCostCny: '120.00',
      costConfirmation: JSON.stringify({ confirmed: true }),
      costConfirmedAt: new Date(),
    }).where(eq(productionBatches.id, bulk.id));
    const bulkApproval = await approveCreativeSpecs({
      teamId: fixture.teamId,
      userId: fixture.userId,
      specVersionIds: [bulkDrafts[0]!.specVersionId, bulkDrafts[1]!.specVersionId, 2_147_483_647],
    });
    assert.deepEqual(bulkApproval.results.map((result) => result.status), ['approved', 'approved', 'failed']);
    assert.ok(bulkApproval.results.slice(0, 2).every((result) => result.binding?.productionBatchId === bulk.id));
    assert.match(bulkApproval.results[2]!.error ?? '', /not found/);
    const invalidatedBulk = (await db.select().from(productionBatches).where(eq(productionBatches.id, bulk.id)).limit(1))[0]!;
    assert.equal(invalidatedBulk.specHash, null);
    assert.equal(invalidatedBulk.costConfirmation, null);
    assert.equal(invalidatedBulk.costConfirmedAt, null);

    const raceDraft = bulkDrafts[2]!;
    const original = (await db.select().from(creativeSpecVersions).where(eq(
      creativeSpecVersions.id,
      raceDraft.specVersionId,
    )).limit(1))[0]!;
    const competitor = (await db.insert(creativeSpecVersions).values({
      teamId: fixture.teamId,
      campaignId: original.campaignId,
      createdBy: fixture.userId,
      version: '1.0.1',
      status: 'awaiting_approval',
      specHash: original.specHash,
      specSnapshot: original.specSnapshot,
    }).returning())[0]!;
    const raced = await Promise.allSettled([
      approveCreativeSpec({ teamId: fixture.teamId, userId: fixture.userId, specVersionId: original.id }),
      approveCreativeSpec({ teamId: fixture.teamId, userId: fixture.userId, specVersionId: competitor.id }),
    ]);
    assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(raced.filter((result) => result.status === 'rejected').length, 1);
    const raceItem = (await db.select().from(productionBatchItems).where(and(
      eq(productionBatchItems.productionBatchId, bulk.id),
      eq(productionBatchItems.campaignId, original.campaignId),
    )).limit(1))[0]!;
    assert.ok([original.id, competitor.id].includes(raceItem.creativeSpecVersionId ?? -1));
    const approvedForCampaign = await db.select({ id: creativeSpecVersions.id }).from(creativeSpecVersions).where(and(
      eq(creativeSpecVersions.teamId, fixture.teamId),
      eq(creativeSpecVersions.campaignId, original.campaignId),
      eq(creativeSpecVersions.status, 'approved'),
    ));
    assert.equal(approvedForCampaign.length, 1);

    const boundBulkItems = await db.select().from(productionBatchItems).where(eq(productionBatchItems.productionBatchId, bulk.id));
    assert.equal(boundBulkItems.filter((item) => item.creativeSpecVersionId !== null).length, 3);
    console.info('Creative Spec automation checks passed.');
  } finally {
    if (batchIds.length) {
      await db.transaction(async (transaction) => {
        const items = await transaction.select().from(productionBatchItems).where(inArray(productionBatchItems.productionBatchId, batchIds));
        const campaignIds = items.map((item) => item.campaignId).filter((campaignId): campaignId is number => campaignId !== null);
        await transaction.delete(productionBatchItems).where(inArray(productionBatchItems.productionBatchId, batchIds));
        if (campaignIds.length) {
          await transaction.delete(creativeSpecVersions).where(inArray(creativeSpecVersions.campaignId, campaignIds));
          await transaction.delete(shotCards).where(inArray(shotCards.campaignId, campaignIds));
          await transaction.delete(campaigns).where(inArray(campaigns.id, campaignIds));
        }
        await transaction.delete(productionBatches).where(inArray(productionBatches.id, batchIds));
        await transaction.delete(activityLogs).where(and(
          gt(activityLogs.id, lastLogId),
          eq(activityLogs.teamId, fixture.teamId),
          eq(activityLogs.userId, fixture.userId),
        ));
      });
    }
  }
}

void main();
