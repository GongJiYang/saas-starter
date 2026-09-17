import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './drizzle';
import { assets, campaigns, videoJobs } from './schema';

export async function getActiveVideoJobForCampaign(
  teamId: number,
  campaignId: number,
) {
  const result = await db
    .select()
    .from(videoJobs)
    .where(
      and(
        eq(videoJobs.teamId, teamId),
        eq(videoJobs.campaignId, campaignId),
        inArray(videoJobs.status, ['queued', 'generating']),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

export async function listVideoJobsWithCampaignForTeam(teamId: number) {
  return db
    .select({
      campaignName: campaigns.name,
      completedAt: videoJobs.completedAt,
      createdAt: videoJobs.createdAt,
      failureCode: videoJobs.failureCode,
      failureReason: videoJobs.failureReason,
      id: videoJobs.id,
      outputAssetId: videoJobs.outputAssetId,
      outputFileName: assets.fileName,
      status: videoJobs.status,
    })
    .from(videoJobs)
    .innerJoin(campaigns, eq(videoJobs.campaignId, campaigns.id))
    .leftJoin(assets, eq(videoJobs.outputAssetId, assets.id))
    .where(eq(videoJobs.teamId, teamId))
    .orderBy(desc(videoJobs.createdAt));
}
