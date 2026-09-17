import 'dotenv/config';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { assets, productionBatchItems, productionBatches, teamMembers, users, videoJobs } from '@/lib/db/schema';
import { confirmProductionBatchCost, createImageToVideoBatch, estimateProductionBatchCost, evaluateProductionBatchPilot, retryImageBatchJobs, scheduleImageBatchJobs, selectImageBatchPilots } from '@/lib/production-batches/actions';
import { compileImageToVideoRecipe } from '@/lib/production-batches/image-video-recipe';

async function main(): Promise<void> {
  const membership = (await db.select({ teamId: teamMembers.teamId, userId: users.id }).from(teamMembers).innerJoin(users, eq(teamMembers.userId, users.id)).limit(1))[0];
  if (!membership) throw new Error('Seed a Workspace first.');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const batch = await createImageToVideoBatch({ teamId: membership.teamId, userId: membership.userId, data: { name: `image-flow-${suffix}`, targetPlatform: 'TikTok', durationSeconds: 5, campaignGoal: 'flow acceptance', sharedPrompt: 'Preserve the product and animate subtly.' } });
  const inputAssets = await db.insert(assets).values([1, 2, 3].map((sequence) => ({ teamId: membership.teamId, type: 'product_image' as const, uploadSource: 'local_upload' as const, objectKey: `teams/${membership.teamId}/product-images/flow-${suffix}-${sequence}.png`, fileName: `flow-${sequence}.png`, contentType: 'image/png', byteSize: 1, uploadedBy: membership.userId }))).returning();
  let items: typeof productionBatchItems.$inferSelect[] = [];
  try {
    await db.transaction(async (tx) => { await tx.execute('set constraints all deferred'); items = await tx.insert(productionBatchItems).values(inputAssets.map((asset, index) => ({ teamId: membership.teamId, productionBatchId: batch.id, inputAssetId: asset.id, sequence: index + 1, status: 'ready' as const, promptMode: 'inherit' as const }))).returning(); });
    const selected = await selectImageBatchPilots({ teamId: membership.teamId, userId: membership.userId, batchId: batch.id });
    assert.equal(selected.selectedItemIds.length, 3);
    const replacementIds = [items[0]!.id, items[1]!.id];
    const replacement = await selectImageBatchPilots({ teamId: membership.teamId, userId: membership.userId, batchId: batch.id, itemIds: replacementIds });
    assert.deepEqual(replacement.selectedItemIds, replacementIds);
    const replacedItems = await db.select().from(productionBatchItems).where(and(
      eq(productionBatchItems.teamId, membership.teamId),
      eq(productionBatchItems.productionBatchId, batch.id),
    ));
    for (const item of replacedItems) {
      const selectedAsPilot = replacementIds.includes(item.id);
      assert.equal(item.isPilot, selectedAsPilot);
      assert.equal(item.status, selectedAsPilot ? 'pilot' : 'ready');
    }
    const estimate = await estimateProductionBatchCost({ teamId: membership.teamId, batchId: batch.id });
    await confirmProductionBatchCost({ teamId: membership.teamId, userId: membership.userId, batchId: batch.id, expectedMaxEstimatedCostCny: estimate.maxEstimatedCostCny });
    const scheduled = await scheduleImageBatchJobs({ teamId: membership.teamId, userId: membership.userId, batchId: batch.id, pilotOnly: true });
    assert.equal(scheduled.queued, 2);
    const jobs = await db.select().from(videoJobs).where(and(eq(videoJobs.teamId, membership.teamId), inArray(videoJobs.id, scheduled.videoJobIds)));
    assert.ok(jobs.every((job) => job.campaignId === null && job.productionBatchItemId !== null && job.inputAssetId !== null && job.recipeSnapshot));
    for (const job of jobs) {
      const recipe = JSON.parse(job.recipeSnapshot!) as ReturnType<typeof compileImageToVideoRecipe>;
      assert.equal(recipe.kind, 'image_to_video');
      assert.equal(recipe.output.ratio, '9:16');
    }
    const failed = jobs[0]!;
    await db.update(videoJobs).set({ status: 'failed', failureCode: 'acceptance', failureReason: 'Synthetic acceptance failure.', completedAt: new Date() }).where(eq(videoJobs.id, failed.id));
    await db.update(productionBatchItems).set({ status: 'failed', lastError: 'Synthetic acceptance failure.' }).where(eq(productionBatchItems.id, failed.productionBatchItemId!));
    const retried = await retryImageBatchJobs({ teamId: membership.teamId, userId: membership.userId, batchId: batch.id, itemIds: [failed.productionBatchItemId!], useCurrentPrompt: false });
    assert.equal(retried.queued, 1);
    const retryJob = (await db.select().from(videoJobs).where(eq(videoJobs.id, retried.videoJobIds[0]!)).limit(1))[0]!;
    assert.equal(retryJob.recipeSnapshot, failed.recipeSnapshot);
    const gate = await evaluateProductionBatchPilot({ teamId: membership.teamId, userId: membership.userId, batchId: batch.id });
    assert.equal(gate.passed, false);
    console.info('Image Pilot, retry, and frozen Recipe acceptance checks passed.');
  } finally {
    const itemIds = items.map((item) => item.id);
    await db.transaction(async (tx) => { await tx.execute('set constraints all deferred'); if (itemIds.length) await tx.delete(videoJobs).where(and(eq(videoJobs.teamId, membership.teamId), inArray(videoJobs.productionBatchItemId, itemIds))); await tx.delete(productionBatchItems).where(and(eq(productionBatchItems.teamId, membership.teamId), eq(productionBatchItems.productionBatchId, batch.id))); await tx.delete(productionBatches).where(and(eq(productionBatches.teamId, membership.teamId), eq(productionBatches.id, batch.id))); await tx.delete(assets).where(and(eq(assets.teamId, membership.teamId), inArray(assets.id, inputAssets.map((asset) => asset.id)))); });
  }

}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });

