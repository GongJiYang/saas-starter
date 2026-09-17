import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { campaigns, productionBatches, reviews, shotCards, videoJobs } from '@/lib/db/schema';

export async function getWorkspaceOverview(teamId: number) {
  const [campaignCount, activeJobCount, readyForReviewCount, recentJobs, recentProductionBatches] =
    await Promise.all([
      db
        .select({ count: count() })
        .from(campaigns)
        .where(eq(campaigns.teamId, teamId)),
      db
        .select({ count: count() })
        .from(videoJobs)
        .where(
          and(
            eq(videoJobs.teamId, teamId),
            eq(videoJobs.status, 'queued'),
          ),
        ),
      db
        .select({ count: count() })
        .from(videoJobs)
        .leftJoin(reviews, eq(reviews.videoJobId, videoJobs.id))
        .where(
          and(
            eq(videoJobs.teamId, teamId),
            eq(videoJobs.status, 'succeeded'),
            isNull(reviews.id),
          ),
        ),
      db
        .select({
          id: videoJobs.id,
          status: videoJobs.status,
          createdAt: videoJobs.createdAt,
          campaignName: campaigns.name,
          shotCardTitle: shotCards.title,
        })
        .from(videoJobs)
        .innerJoin(campaigns, eq(videoJobs.campaignId, campaigns.id))
        .innerJoin(shotCards, eq(videoJobs.shotCardId, shotCards.id))
        .where(eq(videoJobs.teamId, teamId))
        .orderBy(desc(videoJobs.createdAt))
        .limit(5),
      db
        .select({
          id: productionBatches.id,
          name: productionBatches.name,
          status: productionBatches.status,
          sourceMode: productionBatches.sourceMode,
          generationMode: productionBatches.generationMode,
          createdAt: productionBatches.createdAt,
        })
        .from(productionBatches)
        .where(eq(productionBatches.teamId, teamId))
        .orderBy(desc(productionBatches.createdAt))
        .limit(5),
    ]);

  return {
    campaignCount: campaignCount[0]?.count ?? 0,
    activeJobCount: activeJobCount[0]?.count ?? 0,
    readyForReviewCount: readyForReviewCount[0]?.count ?? 0,
    recentJobs,
    recentProductionBatches,
  };
}
