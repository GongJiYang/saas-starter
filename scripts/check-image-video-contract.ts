import 'dotenv/config';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { assets, productionBatchItems, productionBatches, reviews, teamMembers, users, videoJobs } from '@/lib/db/schema';
import { compileImageToVideoRecipe } from '@/lib/production-batches/image-video-recipe';
import { estimateProductionBatchCost, getImageBatchEligibility, getProductionBatchProgress, updateImageBatchItemPrompt, updateImageBatchSharedPrompt } from '@/lib/production-batches/actions';
import { recordReviewDecision } from '@/lib/reviews/decisions';

async function main(): Promise<void> {
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const user = (await db.select().from(users).limit(1))[0];
if (!user) throw new Error('Seed at least one user before running the contract check.');
const membership = (await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, user.id)).limit(1))[0];
const teamId = Number(membership?.teamId);
if (!Number.isSafeInteger(teamId)) throw new Error('Seed at least one team membership before running the contract check.');
const fixture = await db.transaction(async (tx) => {
  await tx.execute('set constraints all deferred');
  const createdAssets = await tx.insert(assets).values([1, 2, 3].map((sequence) => ({ teamId, type: 'product_image' as const, uploadSource: 'local_upload' as const, objectKey: `teams/${teamId}/product-images/check-${suffix}-${sequence}.png`, fileName: `check-${sequence}.png`, contentType: 'image/png', byteSize: 1, uploadedBy: user.id }))).returning();
  const batch = (await tx.insert(productionBatches).values({ teamId, createdBy: user.id, name: `image-contract-${suffix}`, generationMode: 'bulk', sourceMode: 'uploaded_images', targetPlatform: 'TikTok', durationSeconds: 5, campaignGoal: 'contract check', sharedPrompt: 'Keep the product exact and add a slow camera push.', sharedPromptVersion: 1 }).returning())[0];
  if (!batch) throw new Error('Image-to-Video contract Batch could not be created.');
  const items = await tx.insert(productionBatchItems).values(createdAssets.map((asset, index) => ({ teamId, productionBatchId: batch.id, inputAssetId: asset.id, sequence: index + 1, status: 'ready' as const, promptMode: 'inherit' as const }))).returning();
  return { createdAssets, batch, items };
});
const { createdAssets, batch, items } = fixture;

try {
  const eligibility = await getImageBatchEligibility({ teamId, batchId: batch.id });
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.imageRole, 'reference_image');
  assert.equal(eligibility.items.length, 3);

  const estimate = await estimateProductionBatchCost({ teamId, batchId: batch.id });
  assert.equal(estimate.itemCount, 3);
  assert.equal(estimate.generatedSeconds, 15);
  assert.ok(estimate.maxEstimatedCostCny > 0);

  await updateImageBatchItemPrompt({ teamId, userId: user.id, batchId: batch.id, itemId: items[1]!.id, mode: 'override', prompt: 'Custom exact-product motion.' });
  const currentBatch = (await db.select().from(productionBatches).where(eq(productionBatches.id, batch.id)).limit(1))[0]!;
  const currentItems = await db.select().from(productionBatchItems).where(eq(productionBatchItems.productionBatchId, batch.id));
  const recipe = compileImageToVideoRecipe({ batch: currentBatch, item: currentItems.find((item) => item.id === items[1]!.id)! });
  assert.equal(recipe.prompt, 'Custom exact-product motion.');
  assert.equal(recipe.sharedPromptVersion, 1);
  assert.ok(!recipe.recipeHash.includes('http'));

  await updateImageBatchSharedPrompt({ teamId, userId: user.id, batchId: batch.id, prompt: 'New shared Prompt.' });
  const updatedBatch = (await db.select().from(productionBatches).where(eq(productionBatches.id, batch.id)).limit(1))[0]!;
  assert.equal(updatedBatch.sharedPromptVersion, 2);
  assert.equal(updatedBatch.costConfirmation, null);

  const succeededJob = (await db.insert(videoJobs).values({ teamId, productionBatchItemId: items[0]!.id, inputAssetId: createdAssets[0]!.id, submittedBy: user.id, provider: 'minimax', recipeSnapshot: JSON.stringify(compileImageToVideoRecipe({ batch: currentBatch, item: currentItems[0]! })), status: 'succeeded', outputAssetId: createdAssets[2]!.id, qualityReport: '{}', completedAt: new Date() }).returning())[0]!;
  const reviewedBatchId = await recordReviewDecision({ teamId, reviewerId: user.id, videoJobId: succeededJob.id, decision: 'adopted', reason: null, qualityFailureCause: null, productionBatchId: batch.id });
  assert.equal(reviewedBatchId, batch.id);
  const review = (await db.select().from(reviews).where(eq(reviews.videoJobId, succeededJob.id)).limit(1))[0];
  assert.equal(review?.decision, 'adopted');
  await assert.rejects(() => recordReviewDecision({ teamId, reviewerId: user.id, videoJobId: succeededJob.id, decision: 'adopted', reason: null, qualityFailureCause: null, productionBatchId: batch.id + 1 }), /requested Production Batch/);

  const progress = await getProductionBatchProgress(teamId, batch.id);
  assert.equal(progress.counts.total, 3);
  assert.ok(progress.counts.completed <= progress.counts.total);
  console.info('Image-to-Video contract checks passed.');
} finally {
  await db.transaction(async (tx) => {
    await tx.execute('set constraints all deferred');
    const contractJobs = await tx.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.teamId, teamId), inArray(videoJobs.productionBatchItemId, items.map((item) => item.id))));
    if (contractJobs.length) await tx.delete(reviews).where(and(eq(reviews.teamId, teamId), inArray(reviews.videoJobId, contractJobs.map((job) => job.id))));
    await tx.delete(videoJobs).where(and(eq(videoJobs.teamId, teamId), inArray(videoJobs.productionBatchItemId, items.map((item) => item.id))));
    await tx.delete(productionBatchItems).where(eq(productionBatchItems.productionBatchId, batch.id));
    await tx.delete(productionBatches).where(eq(productionBatches.id, batch.id));
    await tx.delete(assets).where(and(eq(assets.teamId, teamId), inArray(assets.id, createdAssets.map((asset) => asset.id))));
  });
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
