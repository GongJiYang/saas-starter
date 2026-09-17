import assert from 'node:assert/strict';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { assets, creativeSpecVersions, productionBatchItems, videoJobs } from '../lib/db/schema';
import { specEnvelopeSchema } from '../lib/creative-spec/compiler';
import { approveCreativeSpec, submitCreativeSpecForApproval } from '../lib/creative-spec/actions';
import { createProductionBatch, selectProductionBatchPilots, createPilotCampaigns, estimateProductionBatchCost, confirmProductionBatchCost, schedulePilotJobs, evaluateProductionBatchPilot, assignProductionBatchWaves, scheduleNextProductionWave, observeProductionBatchWave, changeProductionBatchStatus } from '../lib/production-batches/actions';
import { createProductionBatchItemSpecDraft } from '../lib/production-batches/spec-automation';
import { recordReviewDecision } from '../lib/reviews/decisions';
import { recordVideoQualityReport } from '../lib/quality/actions';
import { createPresignedDownload } from '../lib/storage/cos';
import { probeReferenceVideo } from '../lib/references/probe';

const TEAM_ID = 19;
const USER_ID = 19;
const CATALOG_IDS = [13, 14, 15, 16, 17, 18];

async function waitForTerminal(jobIds: number[]) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = await db.select().from(videoJobs).where(inArray(videoJobs.id, jobIds));
    if (rows.length === jobIds.length && rows.every((job) => job.status === 'succeeded' || job.status === 'failed')) return rows;
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`Wave jobs did not finish: ${jobIds.join(',')}`);
}

async function approveItemSpec(itemId: number, batchId: number) {
  const draft = await createProductionBatchItemSpecDraft({ teamId: TEAM_ID, userId: USER_ID, batchId, itemId });
  await submitCreativeSpecForApproval({ teamId: TEAM_ID, specVersionId: draft.specVersionId });
  await approveCreativeSpec({ teamId: TEAM_ID, userId: USER_ID, specVersionId: draft.specVersionId });
}

async function qualityAndAdopt(jobIds: number[]) {
  const jobs = await db.select().from(videoJobs).where(inArray(videoJobs.id, jobIds));
  for (const job of jobs) {
    if (job.status !== 'succeeded' || !job.outputAssetId) throw new Error(`Wave job ${job.id} failed.`);
    const output = (await db.select().from(assets).where(eq(assets.id, job.outputAssetId)).limit(1))[0];
    const spec = job.creativeSpecVersionId ? (await db.select().from(creativeSpecVersions).where(eq(creativeSpecVersions.id, job.creativeSpecVersionId)).limit(1))[0] : null;
    if (!output || !spec) throw new Error(`Wave job ${job.id} output/spec missing.`);
    const probe = await probeReferenceVideo({ body: Buffer.from(await (await fetch(createPresignedDownload({ objectKey: output.objectKey, teamId: TEAM_ID }).url)).arrayBuffer()), fileExtension: 'mp4' });
    const envelope = specEnvelopeSchema.parse(JSON.parse(spec.specSnapshot));
    const quality = await recordVideoQualityReport({ teamId: TEAM_ID, userId: USER_ID, videoJobId: job.id, observation: {
      technical: { playable: true, codec: probe.videoCodec, expectedCodec: 'h264', ratio: probe.ratio, expectedRatio: '9:16', durationSeconds: probe.durationSeconds, expectedDurationSeconds: 5, audioPresent: probe.hasAudioTrack },
      fidelity: { productCount: 1, productShapePreserved: true, packagingPreserved: true, colorsPreserved: true, logoPreserved: true, immutableElements: [{ element: 'product identity', preserved: true }], endFrame: { productVisible: true, evidence: ['wave acceptance end frame'] }, productDetail: { supported: true, evidence: ['wave acceptance supplied imagery'] } },
      spec: { angleMatched: true, hookMatched: true, approvedClaimIdsPresent: envelope.brief.approvedClaims.map((claim) => claim.id), forbiddenElementsFound: [], captionsMatchApprovedClaims: true, ctaMatched: true, scene: { authorized: true, evidence: ['approved wave spec'] }, timeline: { followed: true, evidence: ['frozen Skill timeline'] } },
      expectedApprovedClaimIds: envelope.brief.approvedClaims.map((claim) => claim.id), actualCostCny: 2.5,
    } });
    if (!quality.report.passed) throw new Error(`Wave QA failed for ${job.id}.`);
    await recordReviewDecision({ decision: 'adopted', reason: null, reviewerId: USER_ID, teamId: TEAM_ID, videoJobId: job.id, qualityFailureCause: null });
  }
}

async function main() {
  const batch = await createProductionBatch({ teamId: TEAM_ID, userId: USER_ID, data: { name: `Wave Acceptance ${Date.now()}`, catalogItemIds: CATALOG_IDS, targetPlatform: 'tiktok', durationSeconds: 5, campaignGoal: 'Real Wave and stop-loss acceptance.', waveSize: 3, stopLossConfig: {} } });
  await selectProductionBatchPilots({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  await createPilotCampaigns({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  let items = await db.select().from(productionBatchItems).where(eq(productionBatchItems.productionBatchId, batch.id));
  for (const item of items.filter((row) => row.isPilot)) await approveItemSpec(item.id, batch.id);
  const estimate = await estimateProductionBatchCost({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  await confirmProductionBatchCost({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id, expectedMaxEstimatedCostCny: estimate.maxEstimatedCostCny });
  const pilotSchedule = await schedulePilotJobs({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  const pilotJobs = await db.select({ id: videoJobs.id }).from(videoJobs).innerJoin(productionBatchItems, eq(productionBatchItems.campaignId, videoJobs.campaignId)).where(and(eq(productionBatchItems.productionBatchId, batch.id), eq(productionBatchItems.isPilot, true)));
  await waitForTerminal(pilotJobs.map((job) => job.id));
  await qualityAndAdopt(pilotJobs.map((job) => job.id));
  const pilotGate = await evaluateProductionBatchPilot({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  assert.equal(pilotGate.passed, true);
  items = await db.select().from(productionBatchItems).where(eq(productionBatchItems.productionBatchId, batch.id));
  for (const item of items.filter((row) => !row.isPilot)) await approveItemSpec(item.id, batch.id);
  const waveEstimate = await estimateProductionBatchCost({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  await confirmProductionBatchCost({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id, expectedMaxEstimatedCostCny: waveEstimate.maxEstimatedCostCny });
  const assigned = await assignProductionBatchWaves({ teamId: TEAM_ID, batchId: batch.id });
  assert.equal(assigned.waveCount, 1);
  const wave = await scheduleNextProductionWave({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  assert.equal(wave.queued, 3);
  const waveJobs = await db.select({ id: videoJobs.id }).from(videoJobs).innerJoin(productionBatchItems, eq(productionBatchItems.campaignId, videoJobs.campaignId)).where(and(eq(productionBatchItems.productionBatchId, batch.id), eq(productionBatchItems.isPilot, false)));
  await waitForTerminal(waveJobs.map((job) => job.id));
  await qualityAndAdopt(waveJobs.map((job) => job.id));
  const stopped = await observeProductionBatchWave({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id, data: { waveNumber: 1, productFidelityFailures: [], reviewedResults: [], supplierErrorRate: 0.5, averageCostCny: 5, confirmedAverageCostCny: 5 } });
  assert.equal(stopped.paused, true);
  const resumed = await changeProductionBatchStatus({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id, status: 'resume' });
  assert.equal(resumed.status, 'producing');
  const completed = await observeProductionBatchWave({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id, data: { waveNumber: 1, productFidelityFailures: [], reviewedResults: [], supplierErrorRate: 0, averageCostCny: 5, confirmedAverageCostCny: 5 } });
  assert.equal(completed.status, 'completed');
  console.info(JSON.stringify({ batchId: batch.id, pilotQueued: pilotSchedule.queued, pilotAdopted: pilotGate.adoptedPilotSkuCount, waveQueued: wave.queued, stopLossPaused: stopped.paused, resumedStatus: resumed.status, finalStatus: completed.status }));
}

void main();
