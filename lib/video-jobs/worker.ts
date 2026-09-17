import { and, eq, isNull, sql } from 'drizzle-orm';
import { enqueueVideoPoll } from '@/lib/queue/video-generation';
import { db } from '@/lib/db/drizzle';
import {
  activityLogs,
  ActivityType,
  assets,
  brandKits,
  campaigns,
  creativeSpecVersions,
  shotCards,
  productionBatchItems,
  productionBatches,
  videoJobs,
} from '@/lib/db/schema';
import { createVideoTask, queryVideoTask } from '@/lib/video-providers';
import { archiveGeneratedVideo, createPresignedDownload } from '@/lib/storage/cos';
import { compiledShotRecipeSchema, getShotSkillVersionForTeam, toMiniMaxH3Request } from '@/lib/shot-skills';
import { assertVideoJobTransition } from './state';
import { assertProductionBatchModeTransition } from '@/lib/production-batches/state';
import { compileImageToVideoRecipe } from '@/lib/production-batches/image-video-recipe';

export async function failVideoJob(
  videoJobId: number,
  failure: { code: string; reason: string },
): Promise<void> {
  await db.transaction(async (transaction) => {
    const current = await transaction.select().from(videoJobs).where(eq(videoJobs.id, videoJobId)).limit(1);
    const videoJob = current[0];
    if (!videoJob || videoJob.status === 'failed' || videoJob.status === 'succeeded') return;
    assertVideoJobTransition(videoJob.status, 'failed');
    await transaction.update(videoJobs).set({
      completedAt: new Date(),
      failureCode: failure.code,
      failureReason: failure.reason,
      status: 'failed',
      updatedAt: new Date(),
    }).where(eq(videoJobs.id, videoJob.id));
    if (videoJob.campaignId !== null) {
      await transaction.update(campaigns).set({ status: 'ready', updatedAt: new Date() }).where(eq(campaigns.id, videoJob.campaignId));
      await transaction.update(productionBatchItems).set({ status: 'failed', lastError: failure.reason, updatedAt: new Date() }).where(and(eq(productionBatchItems.teamId, videoJob.teamId), eq(productionBatchItems.campaignId, videoJob.campaignId)));
    } else if (videoJob.productionBatchItemId !== null) {
      await transaction.update(productionBatchItems).set({ status: 'failed', lastError: failure.reason, updatedAt: new Date() }).where(and(eq(productionBatchItems.teamId, videoJob.teamId), eq(productionBatchItems.id, videoJob.productionBatchItemId)));
    }
    const batchRows = videoJob.campaignId !== null
      ? await transaction.select({ batch: productionBatches }).from(productionBatchItems).innerJoin(productionBatches, eq(productionBatchItems.productionBatchId, productionBatches.id)).where(and(eq(productionBatchItems.teamId, videoJob.teamId), eq(productionBatchItems.campaignId, videoJob.campaignId))).limit(1)
      : videoJob.productionBatchItemId !== null
        ? await transaction.select({ batch: productionBatches }).from(productionBatchItems).innerJoin(productionBatches, eq(productionBatchItems.productionBatchId, productionBatches.id)).where(and(eq(productionBatchItems.teamId, videoJob.teamId), eq(productionBatchItems.id, videoJob.productionBatchItemId))).limit(1)
        : [];
    const batch = batchRows[0]?.batch;
    if (batch?.generationMode === 'single' && batch.status === 'generating') {
      assertProductionBatchModeTransition('single', batch.status, 'ready_to_generate');
      await transaction.update(productionBatches).set({ status: 'ready_to_generate', updatedAt: new Date() }).where(eq(productionBatches.id, batch.id));
    } else if (batch?.generationMode === 'single' && batch.status === 'paused' && batch.pausedFromStatus === 'generating') {
      assertProductionBatchModeTransition('single', batch.status, 'ready_to_generate');
      await transaction.update(productionBatches).set({ pausedFromStatus: 'ready_to_generate', updatedAt: new Date() }).where(eq(productionBatches.id, batch.id));
    }
    await transaction.insert(activityLogs).values({ action: ActivityType.VIDEO_JOB_FAILED, teamId: videoJob.teamId, userId: videoJob.submittedBy });
  });
}

export async function processVideoPoll(videoJobId: number): Promise<void> {
  const current = await db
    .select()
    .from(videoJobs)
    .where(eq(videoJobs.id, videoJobId))
    .limit(1);
  const videoJob = current[0];

  if (!videoJob || videoJob.status === 'succeeded' || videoJob.status === 'failed') {
    return;
  }

  if (!videoJob.externalTaskId) {
    throw new Error('Video job has no provider task ID.');
  }

  const task = await queryVideoTask(videoJob.provider, videoJob.externalTaskId);

  if (task.status === 'queued' || task.status === 'running') {
    await enqueueVideoPoll(videoJob.id);
    return;
  }

  if (task.status === 'failed' || task.status === 'cancelled') {
    await failVideoJob(videoJob.id, {
      code: task.errorCode ?? task.status,
      reason:
        task.errorMessage ??
        `Video provider task ended with status ${task.status}.`,
    });
    return;
  }

  if (!task.outputUrl) {
    throw new Error('Video provider completed without an output URL.');
  }

  const archivedVideo = await archiveGeneratedVideo({
    sourceUrl: task.outputUrl,
    sourceHeaders: task.outputHeaders,
    teamId: videoJob.teamId,
    videoJobId: videoJob.id,
  });

  await db.transaction(async (transaction) => {
    const latest = await transaction
      .select()
      .from(videoJobs)
      .where(eq(videoJobs.id, videoJob.id))
      .limit(1);
    const latestVideoJob = latest[0];

    if (!latestVideoJob || latestVideoJob.status === 'succeeded') {
      return;
    }

    if (latestVideoJob.status === 'failed') {
      return;
    }

    assertVideoJobTransition(latestVideoJob.status, 'succeeded');
    const createdAsset = await transaction
      .insert(assets)
      .values({
        ...archivedVideo,
        teamId: latestVideoJob.teamId,
        type: 'generated_video',
        uploadSource: 'generated',
        uploadedBy: latestVideoJob.submittedBy,
      })
      .onConflictDoNothing({ target: assets.objectKey })
      .returning({ id: assets.id });
    const outputAsset =
      createdAsset[0] ??
      (
        await transaction
          .select({ id: assets.id })
          .from(assets)
          .where(eq(assets.objectKey, archivedVideo.objectKey))
          .limit(1)
      )[0];

    if (!outputAsset) {
      throw new Error('Generated video asset could not be recorded.');
    }

    await transaction
      .update(videoJobs)
      .set({
        completedAt: new Date(),
        failureCode: null,
        failureReason: null,
        outputAssetId: outputAsset.id,
        status: 'succeeded',
        updatedAt: new Date(),
      })
      .where(eq(videoJobs.id, latestVideoJob.id));
    if (latestVideoJob.campaignId !== null) {
      await transaction.update(campaigns).set({ status: 'review', updatedAt: new Date() }).where(eq(campaigns.id, latestVideoJob.campaignId));
      await transaction.update(productionBatchItems).set({ status: 'quality_review', updatedAt: new Date() }).where(and(eq(productionBatchItems.teamId, latestVideoJob.teamId), eq(productionBatchItems.campaignId, latestVideoJob.campaignId)));
    } else if (latestVideoJob.productionBatchItemId !== null) {
      await transaction.update(productionBatchItems).set({ status: 'quality_review', updatedAt: new Date() }).where(and(eq(productionBatchItems.teamId, latestVideoJob.teamId), eq(productionBatchItems.id, latestVideoJob.productionBatchItemId)));
    }
    const batchRows = latestVideoJob.campaignId !== null
      ? await transaction.select({ batch: productionBatches }).from(productionBatchItems).innerJoin(productionBatches, eq(productionBatchItems.productionBatchId, productionBatches.id)).where(and(eq(productionBatchItems.teamId, latestVideoJob.teamId), eq(productionBatchItems.campaignId, latestVideoJob.campaignId))).limit(1)
      : latestVideoJob.productionBatchItemId !== null
        ? await transaction.select({ batch: productionBatches }).from(productionBatchItems).innerJoin(productionBatches, eq(productionBatchItems.productionBatchId, productionBatches.id)).where(and(eq(productionBatchItems.teamId, latestVideoJob.teamId), eq(productionBatchItems.id, latestVideoJob.productionBatchItemId))).limit(1)
        : [];
    const batch = batchRows[0]?.batch;
    if (batch?.generationMode === 'single' && batch.status === 'generating') {
      assertProductionBatchModeTransition('single', batch.status, 'review');
      await transaction.update(productionBatches).set({ status: 'review', updatedAt: new Date() }).where(eq(productionBatches.id, batch.id));
    } else if (batch?.generationMode === 'single' && batch.status === 'paused' && batch.pausedFromStatus === 'generating') {
      assertProductionBatchModeTransition('single', batch.status, 'review');
      await transaction.update(productionBatches).set({ pausedFromStatus: 'review', updatedAt: new Date() }).where(eq(productionBatches.id, batch.id));
    }
    await transaction.insert(activityLogs).values({
      action: ActivityType.VIDEO_JOB_SUCCEEDED,
      teamId: latestVideoJob.teamId,
      userId: latestVideoJob.submittedBy,
    });
  });
}

async function processImageVideoSubmission(videoJobId: number): Promise<boolean> {
  const context = await db.select({
    videoJob: videoJobs,
    item: productionBatchItems,
    batch: productionBatches,
    inputAsset: assets,
  }).from(videoJobs)
    .innerJoin(productionBatchItems, eq(videoJobs.productionBatchItemId, productionBatchItems.id))
    .innerJoin(productionBatches, eq(productionBatchItems.productionBatchId, productionBatches.id))
    .innerJoin(assets, eq(videoJobs.inputAssetId, assets.id))
    .where(and(
      eq(videoJobs.id, videoJobId),
      isNull(videoJobs.campaignId),
      eq(productionBatchItems.teamId, videoJobs.teamId),
      eq(productionBatches.teamId, videoJobs.teamId),
      eq(assets.teamId, videoJobs.teamId),
      eq(productionBatches.sourceMode, 'uploaded_images'),
    ))
    .limit(1);
  const row = context[0];
  if (!row) return false;
  if (row.videoJob.status === 'generating') { await enqueueVideoPoll(row.videoJob.id); return true; }
  if (row.videoJob.status !== 'queued') return true;
  if (row.batch.status === 'cancelled') {
    await failVideoJob(row.videoJob.id, { code: 'batch_cancelled', reason: 'Production Batch was cancelled before provider submission.' });
    return true;
  }
  if (!row.videoJob.recipeSnapshot) throw new Error('Image-to-Video Job has no frozen Recipe.');
  const recipe = JSON.parse(row.videoJob.recipeSnapshot) as ReturnType<typeof compileImageToVideoRecipe>;
  if (recipe.kind !== 'image_to_video' || recipe.inputAssetId !== row.inputAsset.id || !recipe.prompt) throw new Error('Image-to-Video Job Recipe is invalid.');
  await db.update(videoJobs).set({ attempts: sql`${videoJobs.attempts} + 1`, updatedAt: new Date() }).where(and(eq(videoJobs.id, row.videoJob.id), eq(videoJobs.status, 'queued')));
  const referenceImage = createPresignedDownload({ objectKey: row.inputAsset.objectKey, teamId: row.videoJob.teamId });
  const task = await createVideoTask(row.videoJob.provider, { durationSeconds: recipe.output.durationSeconds, idempotencyKey: `video-job-${row.videoJob.id}`, referenceImageName: row.inputAsset.fileName, referenceImageUrl: referenceImage.url, imageRole: 'reference_image', prompt: recipe.prompt });
  assertVideoJobTransition(row.videoJob.status, 'generating');
  await db.update(videoJobs).set({ externalTaskId: task.taskId, status: 'generating', updatedAt: new Date() }).where(and(eq(videoJobs.id, row.videoJob.id), eq(videoJobs.status, 'queued')));
  await enqueueVideoPoll(row.videoJob.id);
  return true;
}
export async function processVideoSubmission(videoJobId: number): Promise<void> {
  if (await processImageVideoSubmission(videoJobId)) return;
  const context = await db
    .select({
      brandKit: brandKits,
      campaign: campaigns,
      productAsset: assets,
      shotCard: shotCards,
      videoJob: videoJobs,
      creativeSpec: creativeSpecVersions,
    })
    .from(videoJobs)

    .innerJoin(campaigns, eq(videoJobs.campaignId, campaigns.id))
    .innerJoin(shotCards, eq(videoJobs.shotCardId, shotCards.id))
    .innerJoin(brandKits, eq(campaigns.brandKitId, brandKits.id))
    .innerJoin(assets, eq(campaigns.productAssetId, assets.id))
    .leftJoin(creativeSpecVersions, eq(videoJobs.creativeSpecVersionId, creativeSpecVersions.id))
    .where(eq(videoJobs.id, videoJobId))
    .limit(1);
  const jobContext = context[0];

  if (!jobContext) {
    return;
  }
  if (!jobContext.creativeSpec || jobContext.creativeSpec.status !== 'approved') {
    throw new Error('VideoJob requires an approved Creative Spec.');
  }

  if (jobContext.videoJob.status === 'generating') {
    await enqueueVideoPoll(jobContext.videoJob.id);
    return;
  }

  if (jobContext.videoJob.status !== 'queued') {
    return;
  }

  await db
    .update(videoJobs)
    .set({ attempts: sql`${videoJobs.attempts} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(videoJobs.id, jobContext.videoJob.id),
        eq(videoJobs.status, 'queued'),
      ),
    );

  const recipeSnapshot = jobContext.videoJob.recipeSnapshot;
  if (
    !recipeSnapshot ||
    !jobContext.videoJob.shotSkillId ||
    !jobContext.videoJob.shotSkillVersionId ||
    !jobContext.videoJob.shotSkillVersion ||
    !jobContext.videoJob.shotSkillHash
  ) {
    throw new Error('Video job has no frozen Shot Skill recipe.');
  }
  const recipe = compiledShotRecipeSchema.parse(JSON.parse(recipeSnapshot));
  if (
    recipe.skill.id !== jobContext.videoJob.shotSkillId ||
    recipe.skill.version !== jobContext.videoJob.shotSkillVersion ||
    recipe.skill.hash !== jobContext.videoJob.shotSkillHash
  ) {
    throw new Error('Video job Shot Skill metadata does not match its frozen recipe.');
  }
  const persistedSkillVersion = await getShotSkillVersionForTeam({
    teamId: jobContext.videoJob.teamId,
    versionId: jobContext.videoJob.shotSkillVersionId,
  });
  if (
    !persistedSkillVersion
    || persistedSkillVersion.skill.stableId !== recipe.skill.id
    || persistedSkillVersion.version.version !== recipe.skill.version
    || persistedSkillVersion.version.definitionHash !== recipe.skill.hash
  ) {
    throw new Error('Video job persisted Shot Skill version does not match its frozen recipe.');
  }
  const productImage = createPresignedDownload({
    objectKey: jobContext.productAsset.objectKey,
    teamId: jobContext.videoJob.teamId,
  });
  const task = await createVideoTask(jobContext.videoJob.provider, {
    ...toMiniMaxH3Request(recipe, productImage.url),
    idempotencyKey: `video-job-${jobContext.videoJob.id}`,
    referenceImageName: jobContext.productAsset.fileName,
  });

  assertVideoJobTransition(jobContext.videoJob.status, 'generating');
  await db
    .update(videoJobs)
    .set({
      externalTaskId: task.taskId,
      status: 'generating',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(videoJobs.id, jobContext.videoJob.id),
        eq(videoJobs.status, 'queued'),
      ),
    );
  await enqueueVideoPoll(jobContext.videoJob.id);
}
