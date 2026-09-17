import assert from 'node:assert/strict';
import { and, desc, eq, inArray, isNull, like } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { productionBatches, reviews, videoJobs } from '../lib/db/schema';
import { recordReviewDecision } from '../lib/reviews/decisions';
import { evaluateProductionBatchPilot } from '../lib/production-batches/actions';

async function main() {
  const batch = (await db.select().from(productionBatches)
    .where(and(eq(productionBatches.teamId, 19), like(productionBatches.name, 'G P5 Private Skill Acceptance %')))
    .orderBy(desc(productionBatches.createdAt)).limit(1))[0];
  if (!batch) throw new Error('Real MiniMax P5 batch not found.');
  const jobs = await db.select().from(videoJobs)
    .leftJoin(reviews, eq(reviews.videoJobId, videoJobs.id))
    .where(and(eq(videoJobs.teamId, 19), eq(videoJobs.status, 'succeeded'), isNull(reviews.id), inArray(videoJobs.campaignId, [52, 53, 54])))
    .orderBy(desc(videoJobs.id));
  assert.equal(jobs.length, 3, 'Expected three real Pilot jobs pending Review.');
  for (const row of jobs) {
    await recordReviewDecision({
      decision: 'adopted', reason: null, reviewerId: 19, teamId: 19,
      videoJobId: row.video_jobs.id, qualityFailureCause: null,
    });
  }
  const pilot = await evaluateProductionBatchPilot({ teamId: 19, userId: 19, batchId: batch.id });
  assert.equal(pilot.passed, true);
  assert.equal(pilot.adoptedPilotSkuCount, 3);
  const completed = (await db.select({ status: productionBatches.status }).from(productionBatches).where(eq(productionBatches.id, batch.id)).limit(1))[0];
  assert.equal(completed?.status, 'completed');
  console.info(JSON.stringify({ batchId: batch.id, adoptedPilotSkuCount: pilot.adoptedPilotSkuCount, status: completed?.status }));
}

void main();
