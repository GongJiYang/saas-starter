import { and, asc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { ActivityType, activityLogs, assets, productionBatchItems, productionBatches, reviews, videoJobs } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { parseImageVideoRecipeHash, renderImageVideoManifest, type ImageVideoManifestRow } from '@/lib/production-batches/image-manifest';


export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  const batch = (await db.select().from(productionBatches).where(and(eq(productionBatches.id, batchId), eq(productionBatches.teamId, workspace.team.id))).limit(1))[0];
  if (!batch || batch.sourceMode !== 'uploaded_images') return NextResponse.json({ error: 'Image-to-Video Batch not found.' }, { status: 404 });
  const items = await db.select({ item: productionBatchItems, input: assets }).from(productionBatchItems).leftJoin(assets, and(eq(assets.id, productionBatchItems.inputAssetId), eq(assets.teamId, workspace.team.id))).where(and(eq(productionBatchItems.teamId, workspace.team.id), eq(productionBatchItems.productionBatchId, batchId))).orderBy(asc(productionBatchItems.sequence));
  const itemIds = items.map((row) => row.item.id);
  const jobs = itemIds.length ? await db.select().from(videoJobs).where(and(eq(videoJobs.teamId, workspace.team.id), inArray(videoJobs.productionBatchItemId, itemIds))).orderBy(asc(videoJobs.createdAt)) : [];
  const latestByItem = new Map<number, (typeof jobs)[number]>();
  for (const job of jobs) if (job.productionBatchItemId !== null) latestByItem.set(job.productionBatchItemId, job);
  const latestJobs = [...latestByItem.values()];
  const reviewRows = latestJobs.length ? await db.select().from(reviews).where(and(eq(reviews.teamId, workspace.team.id), inArray(reviews.videoJobId, latestJobs.map((job) => job.id)))) : [];
  const reviewByJob = new Map(reviewRows.map((review) => [review.videoJobId, review]));
  const outputIds = latestJobs.map((job) => job.outputAssetId).filter((id): id is number => id !== null);
  const outputs = outputIds.length ? await db.select().from(assets).where(and(eq(assets.teamId, workspace.team.id), inArray(assets.id, outputIds))) : [];
  const outputById = new Map(outputs.map((asset) => [asset.id, asset]));
  const manifestRows: ImageVideoManifestRow[] = items.map((row) => {
    const job = latestByItem.get(row.item.id);
    const review = job ? reviewByJob.get(job.id) : undefined;
    const output = job?.outputAssetId ? outputById.get(job.outputAssetId) : undefined;
    return {
      sequence: row.item.sequence,
      inputFile: row.input?.fileName ?? '',
      promptMode: row.item.promptMode,
      recipeHash: parseImageVideoRecipeHash(job?.recipeSnapshot ?? null),
      jobId: job?.id ?? 0,
      jobStatus: job?.status ?? row.item.status,
      outputFile: output?.fileName ?? '',
      reviewDecision: review?.decision ?? '',
      reviewReason: review?.reason ?? '',
      reviewedAt: review?.createdAt.toISOString() ?? '',
    };
  });
  await db.insert(activityLogs).values({ teamId: workspace.team.id, userId: workspace.user.id, action: ActivityType.EXPORT_PRODUCTION_BATCH, metadata: { productionBatchId: batchId, sourceMode: 'uploaded_images', rowCount: items.length } });
  return new NextResponse(renderImageVideoManifest(manifestRows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="image-video-batch-${batchId}.csv"`, 'Cache-Control': 'private, no-store' } });
}
