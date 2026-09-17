import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { assets, creativeSpecVersions, productionBatchItems, productionBatches, videoJobs } from '../lib/db/schema';
import { specEnvelopeSchema } from '../lib/creative-spec/compiler';
import { assignProductionBatchWaves, changeProductionBatchStatus, confirmProductionBatchCost, estimateProductionBatchCost, observeProductionBatchWave, scheduleNextProductionWave } from '../lib/production-batches/actions';
import { recordReviewDecision } from '../lib/reviews/decisions';
import { recordVideoQualityReport } from '../lib/quality/actions';
import { createPresignedDownload } from '../lib/storage/cos';
import { probeReferenceVideo } from '../lib/references/probe';

const TEAM_ID = 19;
const USER_ID = 19;

async function waitForTerminal(jobIds: number[]) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = await db.select().from(videoJobs).where(inArray(videoJobs.id, jobIds));
    if (rows.length === jobIds.length && rows.every((job) => job.status === 'succeeded' || job.status === 'failed')) return rows;
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`Wave jobs did not finish: ${jobIds.join(',')}`);
}

async function qualityAndAdopt(jobIds: number[]) {
  const jobs = await db.select().from(videoJobs).where(inArray(videoJobs.id, jobIds));
  for (const job of jobs) {
    if (job.status !== 'succeeded' || !job.outputAssetId) throw new Error(`Wave job ${job.id} failed: ${job.failureReason ?? job.failureCode ?? job.status}`);
    const output = (await db.select().from(assets).where(eq(assets.id, job.outputAssetId)).limit(1))[0];
    const spec = job.creativeSpecVersionId ? (await db.select().from(creativeSpecVersions).where(eq(creativeSpecVersions.id, job.creativeSpecVersionId)).limit(1))[0] : null;
    if (!output || !spec) throw new Error(`Wave job ${job.id} output/spec missing.`);
    const response = await fetch(createPresignedDownload({ objectKey: output.objectKey, teamId: TEAM_ID }).url);
    if (!response.ok) throw new Error(`Wave output ${job.id} download failed with ${response.status}.`);
    const probe = await probeReferenceVideo({ body: Buffer.from(await response.arrayBuffer()), fileExtension: 'mp4' });
    const envelope = specEnvelopeSchema.parse(JSON.parse(spec.specSnapshot));
    const claimIds = envelope.brief.approvedClaims.map((claim) => claim.id);
    const quality = await recordVideoQualityReport({ teamId: TEAM_ID, userId: USER_ID, videoJobId: job.id, observation: {
      technical: { playable: true, codec: probe.videoCodec, expectedCodec: 'h264', ratio: probe.ratio, expectedRatio: '9:16', durationSeconds: probe.durationSeconds, expectedDurationSeconds: 5, audioPresent: probe.hasAudioTrack },
      fidelity: { productCount: 1, productShapePreserved: true, packagingPreserved: true, colorsPreserved: true, logoPreserved: true, immutableElements: [{ element: 'product identity', preserved: true }], endFrame: { productVisible: true, evidence: ['wave acceptance end frame'] }, productDetail: { supported: true, evidence: ['wave acceptance supplied imagery'] } },
      spec: { angleMatched: true, hookMatched: true, approvedClaimIdsPresent: claimIds, forbiddenElementsFound: [], captionsMatchApprovedClaims: true, ctaMatched: true, scene: { authorized: true, evidence: ['approved wave spec'] }, timeline: { followed: true, evidence: ['frozen Skill timeline'] } },
      expectedApprovedClaimIds: claimIds, actualCostCny: 2.5,
    } });
    assert.equal(quality.report.passed, true);
    await recordReviewDecision({ decision: 'adopted', reason: null, reviewerId: USER_ID, teamId: TEAM_ID, videoJobId: job.id, qualityFailureCause: null });
  }
}

async function main() {
  const batchId = Number(process.argv.slice(2).find((value) => /^\d+$/.test(value)) ?? 48);
  const batch = (await db.select().from(productionBatches).where(and(eq(productionBatches.id, batchId), eq(productionBatches.teamId, TEAM_ID))).limit(1))[0];
  if (!batch) throw new Error(`Batch ${batchId} is not available for Wave acceptance.`);
  if (batch.status === 'producing') {
    const completed = await observeProductionBatchWave({ teamId: TEAM_ID, userId: USER_ID, batchId, data: { waveNumber: 1, productFidelityFailures: [], reviewedResults: [], supplierErrorRate: 0, averageCostCny: 5, confirmedAverageCostCny: 5 } });
    assert.equal(completed.status, 'completed');
    console.info(JSON.stringify({ batchId, resumedFromCheckpoint: true, finalStatus: completed.status }));
    return;
  }
  if (batch.status !== 'ready') throw new Error(`Batch ${batchId} is not ready to continue Wave acceptance.`);
  const estimate = await estimateProductionBatchCost({ teamId: TEAM_ID, userId: USER_ID, batchId });
  await confirmProductionBatchCost({ teamId: TEAM_ID, userId: USER_ID, batchId, expectedMaxEstimatedCostCny: estimate.maxEstimatedCostCny });
  const assigned = await assignProductionBatchWaves({ teamId: TEAM_ID, batchId });
  assert.equal(assigned.waveCount, 1);
  const wave = await scheduleNextProductionWave({ teamId: TEAM_ID, userId: USER_ID, batchId });
  assert.equal(wave.queued, 3);
  const waveJobs = await db.select({ id: videoJobs.id }).from(videoJobs).innerJoin(productionBatchItems, eq(productionBatchItems.campaignId, videoJobs.campaignId)).where(and(eq(productionBatchItems.productionBatchId, batchId), eq(productionBatchItems.isPilot, false)));
  await waitForTerminal(waveJobs.map((job) => job.id));
  await qualityAndAdopt(waveJobs.map((job) => job.id));
  const stopped = await observeProductionBatchWave({ teamId: TEAM_ID, userId: USER_ID, batchId, data: { waveNumber: 1, productFidelityFailures: [], reviewedResults: [], supplierErrorRate: 0.5, averageCostCny: 5, confirmedAverageCostCny: 5 } });
  assert.equal(stopped.paused, true);
  const resumed = await changeProductionBatchStatus({ teamId: TEAM_ID, userId: USER_ID, batchId, status: 'resume' });
  assert.equal(resumed.status, 'producing');
  const completed = await observeProductionBatchWave({ teamId: TEAM_ID, userId: USER_ID, batchId, data: { waveNumber: 1, productFidelityFailures: [], reviewedResults: [], supplierErrorRate: 0, averageCostCny: 5, confirmedAverageCostCny: 5 } });
  assert.equal(completed.status, 'completed');
  console.info(JSON.stringify({ batchId, waveQueued: wave.queued, stopLossReasons: stopped.reasons, resumedStatus: resumed.status, finalStatus: completed.status, waveJobIds: waveJobs.map((job) => job.id) }));
}

void main();
