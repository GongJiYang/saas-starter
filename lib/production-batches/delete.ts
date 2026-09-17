import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { assetUploads, assets, productionBatchItems, productionBatches, reviews, videoJobs } from '@/lib/db/schema';
import { deleteObjectForTeam } from '@/lib/storage/cos';

export async function deleteImageToVideoBatch(input: { teamId: number; batchId: number }): Promise<void> {
  const batch = (await db.select().from(productionBatches).where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId))).limit(1))[0];
  if (!batch || batch.sourceMode !== 'uploaded_images') throw new Error('Image-to-Video Batch not found.');
  const items = await db.select().from(productionBatchItems).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId)));
  const itemIds = items.map((item) => item.id);
  const jobs = itemIds.length ? await db.select().from(videoJobs).where(and(eq(videoJobs.teamId, input.teamId), inArray(videoJobs.productionBatchItemId, itemIds))) : [];
  if (jobs.some((job) => job.status === 'queued' || job.status === 'generating')) throw new Error('Pause and finish active VideoJobs before deleting this Batch.');
  const uploads = await db.select().from(assetUploads).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.productionBatchId, input.batchId)));
  const inputAssetIds = items.map((item) => item.inputAssetId).filter((id): id is number => id !== null);
  const outputAssetIds = jobs.map((job) => job.outputAssetId).filter((id): id is number => id !== null);
  const assetIds = [...new Set([...inputAssetIds, ...outputAssetIds])];
  const batchAssets = assetIds.length ? await db.select().from(assets).where(and(eq(assets.teamId, input.teamId), inArray(assets.id, assetIds))) : [];
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
    if (jobs.length) await tx.delete(reviews).where(and(eq(reviews.teamId, input.teamId), inArray(reviews.videoJobId, jobs.map((job) => job.id))));
    if (itemIds.length) await tx.delete(videoJobs).where(and(eq(videoJobs.teamId, input.teamId), inArray(videoJobs.productionBatchItemId, itemIds)));
    await tx.delete(assetUploads).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.productionBatchId, input.batchId)));
    await tx.delete(productionBatchItems).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId)));
    await tx.delete(productionBatches).where(and(eq(productionBatches.teamId, input.teamId), eq(productionBatches.id, input.batchId)));
    if (assetIds.length) await tx.delete(assets).where(and(eq(assets.teamId, input.teamId), inArray(assets.id, assetIds)));
  });
  for (const objectKey of new Set([...uploads.map((upload) => upload.objectKey), ...batchAssets.map((asset) => asset.objectKey)])) {
    await deleteObjectForTeam({ teamId: input.teamId, objectKey }).catch(() => undefined);
  }
}
