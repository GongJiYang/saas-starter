import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { db } from './drizzle';
import { assets, campaigns, catalogItems, creativeSpecVersions, productionBatchItems, productionBatches, reviews, videoJobs } from './schema';

export async function listPendingReviewJobsForTeam(teamId: number) {
  return db
    .select({
      campaignName: campaigns.name,
      completedAt: videoJobs.completedAt,
      outputAssetId: videoJobs.outputAssetId,
      outputFileName: assets.fileName,
      videoJobId: videoJobs.id,
      qualityReport: videoJobs.qualityReport,
      generationMode: productionBatches.generationMode,
      batchId: productionBatches.id,
      batchName: productionBatches.name,
      externalSku: catalogItems.externalSku,
      productName: catalogItems.productName,
      isPilot: productionBatchItems.isPilot,
      waveNumber: productionBatchItems.waveNumber,
      creativeSpecVersionId: creativeSpecVersions.id,
      creativeSpecVersion: creativeSpecVersions.version,
      shotSkillId: videoJobs.shotSkillId,
      shotSkillVersionId: videoJobs.shotSkillVersionId,
      shotSkillVersion: videoJobs.shotSkillVersion,
    })
    .from(videoJobs)
    .innerJoin(campaigns, eq(videoJobs.campaignId, campaigns.id))
    .leftJoin(assets, eq(videoJobs.outputAssetId, assets.id))
    .leftJoin(productionBatchItems, eq(productionBatchItems.campaignId, videoJobs.campaignId))
    .leftJoin(productionBatches, and(
      eq(productionBatches.id, productionBatchItems.productionBatchId),
      eq(productionBatches.teamId, teamId),
    ))
    .leftJoin(catalogItems, and(
      eq(catalogItems.id, productionBatchItems.catalogItemId),
      eq(catalogItems.teamId, teamId),
    ))
    .leftJoin(creativeSpecVersions, and(
      eq(creativeSpecVersions.id, productionBatchItems.creativeSpecVersionId),
      eq(creativeSpecVersions.teamId, teamId),
    ))
    .leftJoin(reviews, eq(reviews.videoJobId, videoJobs.id))
    .where(
      and(
        eq(videoJobs.teamId, teamId),
        eq(videoJobs.status, 'succeeded'),
        or(isNull(productionBatchItems.id), ne(productionBatchItems.status, 'failed')),
        isNull(reviews.id),
      ),
    )
    .orderBy(desc(videoJobs.completedAt));
}
