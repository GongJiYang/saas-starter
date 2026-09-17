import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { recordReviewDecision } from '@/lib/reviews/decisions';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { db } from '@/lib/db/drizzle';
import { productionBatchItems, reviews, videoJobs } from '@/lib/db/schema';

const inputSchema = z.object({
  videoJobIds: z.array(z.number().int().positive()).min(1).max(500),
  decision: z.enum(['adopted', 'not_adopted']),
  reason: z.string().trim().min(1).max(2_000).nullable().optional(),
  rejectionCause: z.enum(['technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change']).nullable().optional(),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  try {
    const input = inputSchema.parse(await request.json());
    const ids = [...new Set(input.videoJobIds)];
    const candidates = await db.select({ job: videoJobs, item: productionBatchItems, reviewId: reviews.id })
      .from(videoJobs)
      .innerJoin(productionBatchItems, eq(videoJobs.productionBatchItemId, productionBatchItems.id))
      .leftJoin(reviews, and(eq(reviews.videoJobId, videoJobs.id), eq(reviews.teamId, workspace.team.id)))
      .where(and(
        eq(videoJobs.teamId, workspace.team.id),
        eq(productionBatchItems.teamId, workspace.team.id),
        eq(productionBatchItems.productionBatchId, batchId),
        inArray(videoJobs.id, ids),
      ));
    if (candidates.length !== ids.length || candidates.some((row) => row.job.status !== 'succeeded' || !row.job.outputAssetId || row.reviewId !== null)) {
      throw new Error('Every selected VideoJob must be an unreviewed succeeded output from this Production Batch.');
    }
    for (const row of candidates) {
      const latest = await db.select({ id: videoJobs.id }).from(videoJobs).where(and(
        eq(videoJobs.teamId, workspace.team.id),
        eq(videoJobs.productionBatchItemId, row.item.id),
      )).orderBy(desc(videoJobs.createdAt)).limit(1);
      if (latest[0]?.id !== row.job.id) throw new Error('Only the latest output for each image can be reviewed.');
    }
    const recorded: number[] = [];
    for (const videoJobId of ids) {
      const resultBatchId = await recordReviewDecision({
        decision: input.decision,
        reason: input.decision === 'adopted' ? null : input.reason ?? null,
        reviewerId: workspace.user.id,
        teamId: workspace.team.id,
        videoJobId,
        qualityFailureCause: input.decision === 'adopted' ? null : input.rejectionCause ?? null,
        productionBatchId: batchId,
      });
      if (resultBatchId !== batchId) throw new Error('Video job does not belong to this Production Batch.');
      recorded.push(videoJobId);
    }
    return NextResponse.json({ recorded });
  } catch (error) {
    return domainErrorResponse(error, 'request_invalid', { teamId: workspace.team.id, userId: workspace.user.id, batchId, operation: 'production_batch.image_review' });
  }
}
