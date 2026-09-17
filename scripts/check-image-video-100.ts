import 'dotenv/config';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { assets, productionBatchItems, productionBatches, teamMembers, users } from '@/lib/db/schema';
import { createImageToVideoBatch, getImageBatchEligibility, getProductionBatchProgress } from '@/lib/production-batches/actions';

async function main(): Promise<void> {
  const membership = (await db.select({ teamId: teamMembers.teamId, userId: users.id }).from(teamMembers).innerJoin(users, eq(teamMembers.userId, users.id)).limit(1))[0];
  if (!membership) throw new Error('Seed a Workspace before running the 100-image acceptance check.');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const batch = await createImageToVideoBatch({ teamId: membership.teamId, userId: membership.userId, data: { name: `image-100-${suffix}`, targetPlatform: 'TikTok', durationSeconds: 5, campaignGoal: '100 image acceptance', sharedPrompt: 'Preserve the supplied reference image exactly and add subtle controlled motion.' } });
  const createdAssets = await db.insert(assets).values(Array.from({ length: 100 }, (_, index) => ({ teamId: membership.teamId, type: 'product_image' as const, uploadSource: 'local_upload' as const, objectKey: `teams/${membership.teamId}/product-images/accept-${suffix}-${index + 1}.png`, fileName: `accept-${index + 1}.png`, contentType: 'image/png', byteSize: 1, uploadedBy: membership.userId }))).returning();
  let items: typeof productionBatchItems.$inferSelect[] = [];
  try {
    await db.transaction(async (tx) => {
      await tx.execute('set constraints all deferred');
      items = await tx.insert(productionBatchItems).values(createdAssets.map((asset, index) => ({ teamId: membership.teamId, productionBatchId: batch.id, inputAssetId: asset.id, sequence: index + 1, status: 'ready' as const, promptMode: 'inherit' as const }))).returning();
    });
    assert.equal(new Set(items.map((item) => item.sequence)).size, 100);
    const eligibility = await getImageBatchEligibility({ teamId: membership.teamId, batchId: batch.id });
    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.items.length, 100);
    const progress = await getProductionBatchProgress(membership.teamId, batch.id);
    assert.equal(progress.counts.total, 100);
    assert.equal(progress.counts.ready, 100);
    console.info('100-image acceptance check passed.');
  } finally {
    await db.transaction(async (tx) => {
      await tx.execute('set constraints all deferred');
      await tx.delete(productionBatchItems).where(and(eq(productionBatchItems.teamId, membership.teamId), eq(productionBatchItems.productionBatchId, batch.id)));
      await tx.delete(productionBatches).where(and(eq(productionBatches.teamId, membership.teamId), eq(productionBatches.id, batch.id)));
      await tx.delete(assets).where(and(eq(assets.teamId, membership.teamId), inArray(assets.id, createdAssets.map((asset) => asset.id))));
    });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
