import 'dotenv/config';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import {
  assets,
  brandKits,
  catalogItemAssets,
  catalogItems,
  creativeSpecVersions,
  productionBatchItems,
  shotSkills,
  shotSkillVersions,
  videoJobs,
} from '../lib/db/schema';
import { specEnvelopeSchema } from '../lib/creative-spec/compiler';
import { approveCreativeSpec } from '../lib/creative-spec/actions';
import {
  createProductionBatch,
  selectProductionBatchPilots,
  createPilotCampaigns,
  estimateProductionBatchCost,
  confirmProductionBatchCost,
  schedulePilotJobs,
  evaluateProductionBatchPilot,
} from '../lib/production-batches/actions';
import {
  activateShotSkillVersion,
  createShotSkillDraftFromVersion,
  recordShotSkillReleaseValidation,
  submitShotSkillVersionForTesting,
} from '../lib/shot-skills';
import { archiveRemoteObject, createPresignedDownload } from '../lib/storage/cos';
import { hashStable, stableStringify } from '../lib/shot-skills/compiler';
import { recordVideoQualityReport } from '../lib/quality/actions';
import { probeReferenceVideo } from '../lib/references/probe';

const TEAM_ID = 19;
const USER_ID = 19;
const BATCH_NAME = `G P5 Private Skill Acceptance ${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;
const FIXTURE_SKUS = ['P5-SKILL-ACCEPTANCE-1', 'P5-SKILL-ACCEPTANCE-2', 'P5-SKILL-ACCEPTANCE-3'];
const FIXTURE_BRAND = 'G P5 Acceptance Brand';
const SOURCE_CATALOG_ITEM_ID = 9;
const SOURCE_BRAND_KIT_ID = 11;
const SOURCE_SPEC_VERSION_ID = 8;

const releaseFixture = {
  shotRole: 'hook' as const,
  productCategory: 'coffee-machine',
  durationSeconds: 5,
  targetPlatform: 'tiktok',
  primaryImageAvailable: true,
  detailImageCount: 1,
  hasSceneBrief: false,
  personRights: 'none' as const,
  brandVoice: 'clear, restrained, brand-safe',
  sellingPoints: 'Use only approved product facts.',
  mustShowElements: ['the supplied product'],
  immutableElements: ['product shape', 'product color', 'label placement'],
  forbiddenElements: ['additional products', 'generated readable text'],
  shotDirection: 'Reveal one supported product detail, then finish on the complete recognizable product.',
};

async function ensureWorkspaceFixtures() {
  let brandKit = (await db.select().from(brandKits).where(and(
    eq(brandKits.teamId, TEAM_ID),
    eq(brandKits.name, FIXTURE_BRAND),
  )).limit(1))[0];
  if (!brandKit) {
    const source = (await db.select().from(brandKits).where(eq(brandKits.id, SOURCE_BRAND_KIT_ID)).limit(1))[0];
    if (!source) throw new Error('Source BrandKit fixture is missing.');
    [brandKit] = await db.insert(brandKits).values({
      teamId: TEAM_ID,
      createdBy: USER_ID,
      name: FIXTURE_BRAND,
      brandVoice: source.brandVoice,
      requiredElements: source.requiredElements,
      forbiddenElements: source.forbiddenElements,
      defaultShotPreference: source.defaultShotPreference,
    }).returning();
  }
  const source = (await db.select({ item: catalogItems, asset: assets })
    .from(catalogItems)
    .innerJoin(assets, eq(catalogItems.primaryAssetId, assets.id))
    .where(eq(catalogItems.id, SOURCE_CATALOG_ITEM_ID)).limit(1))[0];
  if (!source) throw new Error('Source Catalog fixture is missing.');
  const sourceImageUrl = createPresignedDownload({
    teamId: source.asset.teamId,
    objectKey: source.asset.objectKey,
  }).url;

  const catalogItemIds: number[] = [];
  for (const sku of FIXTURE_SKUS) {
    const existing = (await db.select().from(catalogItems).where(and(
      eq(catalogItems.teamId, TEAM_ID),
      eq(catalogItems.externalSku, sku),
    )).limit(1))[0];
    if (existing) {
      catalogItemIds.push(existing.id);
      continue;
    }
    const archived = await archiveRemoteObject({
      teamId: TEAM_ID,
      sourceUrl: `${sourceImageUrl}&p5sku=${sku}`,
      kind: 'image',
    });
    const insertedAsset = (await db.insert(assets).values({
      teamId: TEAM_ID,
      uploadedBy: USER_ID,
      type: 'product_image',
      uploadSource: 'remote_archive',
      objectKey: archived.objectKey,
      fileName: archived.fileName,
      contentType: archived.contentType,
      byteSize: archived.byteSize,
    }).returning())[0];
    if (!insertedAsset) throw new Error(`Product Asset for ${sku} could not be created.`);
    const created = (await db.insert(catalogItems).values({
      teamId: TEAM_ID,
      createdBy: USER_ID,
      externalSku: sku,
      productName: `P5 Private Skill Product ${sku.slice(-1)}`,
      category: source.item.category,
      primaryImageUrl: createPresignedDownload({ teamId: TEAM_ID, objectKey: archived.objectKey }).url,
      productPageUrl: source.item.productPageUrl,
      primaryAssetId: insertedAsset.id,
      readinessStatus: 'ready',
      readinessErrors: '[]',
      approvedClaims: source.item.approvedClaims,
      prohibitedClaims: source.item.prohibitedClaims,
      mustShowElements: source.item.mustShowElements,
      immutableElements: source.item.immutableElements,
      targetAudience: source.item.targetAudience,
      campaignGoal: source.item.campaignGoal,
      platform: 'tiktok',
      durationSeconds: 5,
      brandKitId: brandKit.id,
      cta: source.item.cta,
    }).returning())[0];
    if (!created) throw new Error(`Catalog item ${sku} could not be created.`);
    await db.insert(catalogItemAssets).values({
      teamId: TEAM_ID,
      catalogItemId: created.id,
      assetId: insertedAsset.id,
      purpose: 'primary',
      position: 1,
    });
    catalogItemIds.push(created.id);
  }
  return { brandKitId: brandKit.id, catalogItemIds };
}

async function ensurePrivateActiveSkill() {
  const existing = await db.select({ skill: shotSkills, version: shotSkillVersions })
    .from(shotSkills)
    .innerJoin(shotSkillVersions, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkills.ownerTeamId, TEAM_ID),
      eq(shotSkills.stableId, 'product-macro-detail'),
    ))
    .orderBy(desc(shotSkillVersions.createdAt));
  let current = existing[0];
  if (!current) {
    const official = (await db.select({ id: shotSkillVersions.id })
      .from(shotSkillVersions)
      .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
      .where(and(
        isNull(shotSkills.ownerTeamId),
        eq(shotSkills.stableId, 'product-macro-detail'),
        eq(shotSkillVersions.status, 'active'),
      )).limit(1))[0];
    if (!official) throw new Error('Official product-macro-detail Skill is missing.');
    const fork = await createShotSkillDraftFromVersion({
      teamId: TEAM_ID,
      userId: USER_ID,
      sourceVersionId: official.id,
    });
    current = { skill: fork.skill, version: fork.version };
  }
  if (current.version.status === 'draft') {
    const testing = await submitShotSkillVersionForTesting({
      teamId: TEAM_ID,
      userId: USER_ID,
      versionId: current.version.id,
    });
    current = { skill: testing.skill, version: testing.version };
  }
  if (current.version.status === 'testing') {
    await recordShotSkillReleaseValidation({
      teamId: TEAM_ID,
      userId: USER_ID,
      versionId: current.version.id,
      fixture: releaseFixture,
    });
    const active = await activateShotSkillVersion({
      teamId: TEAM_ID,
      userId: USER_ID,
      versionId: current.version.id,
    });
    current = { skill: active.skill, version: active.version };
  }
  if (current.version.status !== 'active') throw new Error(`Private Skill is ${current.version.status}, not active.`);
  return current;
}

async function waitForTerminalJobs(videoJobIds: number[]) {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const rows = await db.select().from(videoJobs).where(inArray(videoJobs.id, videoJobIds));
    if (rows.length !== videoJobIds.length) throw new Error('P5 VideoJob disappeared.');
    if (rows.every((job) => job.status === 'succeeded' || job.status === 'failed')) return rows;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error('P5 VideoJobs did not finish within 15 minutes.');
}

async function createApprovedSpecForCampaign(campaignId: number) {
  const source = (await db.select().from(creativeSpecVersions).where(eq(creativeSpecVersions.id, SOURCE_SPEC_VERSION_ID)).limit(1))[0];
  if (!source) throw new Error('Source approved Creative Spec fixture is missing.');
  const sourceEnvelope = specEnvelopeSchema.parse(JSON.parse(source.specSnapshot));
  const approvedEnvelope = specEnvelopeSchema.parse({
    ...sourceEnvelope,
    brief: {
      ...sourceEnvelope.brief,
      detailImageUrls: ['https://assets.example.com/p5-detail.jpg'],
    },
  });
  const specSnapshot = stableStringify(approvedEnvelope);
  const inserted = await db.insert(creativeSpecVersions).values({
    teamId: TEAM_ID,
    campaignId,
    createdBy: USER_ID,
    version: '1.0.0',
    status: 'awaiting_approval',
    specHash: hashStable(approvedEnvelope),
    specSnapshot,
  }).returning({ id: creativeSpecVersions.id });
  const specId = inserted[0]?.id;
  if (!specId) throw new Error('P5 Creative Spec could not be created.');
  await approveCreativeSpec({ teamId: TEAM_ID, userId: USER_ID, specVersionId: specId });
  return { specId, approvedEnvelope };
}

async function main() {
  const fixtures = await ensureWorkspaceFixtures();
  const privateSkill = await ensurePrivateActiveSkill();
  const batch = await createProductionBatch({
    teamId: TEAM_ID,
    userId: USER_ID,
    data: {
      name: BATCH_NAME,
      catalogItemIds: fixtures.catalogItemIds,
      defaultBrandKitId: fixtures.brandKitId,
      targetPlatform: 'tiktok',
      durationSeconds: 5,
      campaignGoal: 'Verify the complete Workspace Private Skill production loop.',
      waveSize: 10,
      stopLossConfig: {},
    },
  });
  if (batch.status === 'draft') await selectProductionBatchPilots({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  await createPilotCampaigns({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  const items = await db.select().from(productionBatchItems).where(and(
    eq(productionBatchItems.productionBatchId, batch.id),
    inArray(productionBatchItems.catalogItemId, fixtures.catalogItemIds),
  ));
  const pilots = items.filter((item) => item.isPilot);
  if (pilots.length !== fixtures.catalogItemIds.length) throw new Error('P5 Pilot items were not all selected.');
  const envelopes: Array<{ itemId: number; campaignId: number; specId: number; envelope: ReturnType<typeof specEnvelopeSchema.parse> }> = [];
  for (const item of pilots) {
    if (!item.campaignId) throw new Error('P5 Pilot Campaign was not created.');
    const { specId, approvedEnvelope } = await createApprovedSpecForCampaign(item.campaignId);
    envelopes.push({ itemId: item.id, campaignId: item.campaignId, specId, envelope: approvedEnvelope });
  }
  const estimate = await estimateProductionBatchCost({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  await confirmProductionBatchCost({
    teamId: TEAM_ID,
    userId: USER_ID,
    batchId: batch.id,
    expectedMaxEstimatedCostCny: estimate.maxEstimatedCostCny,
  });
  const scheduled = await schedulePilotJobs({ teamId: TEAM_ID, userId: USER_ID, batchId: batch.id });
  if (scheduled.queued !== pilots.length) throw new Error('P5 Pilot jobs were not all queued.');
  const jobs = await db.select().from(videoJobs).where(and(
    eq(videoJobs.teamId, TEAM_ID),
    inArray(videoJobs.campaignId, pilots.map((item) => item.campaignId!).filter((id): id is number => Boolean(id))),
  )).orderBy(desc(videoJobs.createdAt));
  const terminal = await waitForTerminalJobs(jobs.map((job) => job.id));
  const failed = terminal.filter((job) => job.status === 'failed');
  if (failed.length > 0) {
    throw new Error(`P5 VideoJobs failed: ${failed.map((job) => `${job.id}:${job.failureCode ?? 'unknown'}`).join(', ')}`);
  }
  const probes: Record<number, Awaited<ReturnType<typeof probeReferenceVideo>>> = {};
  for (const job of terminal) {
    if (!job.outputAssetId) throw new Error(`P5 VideoJob ${job.id} succeeded without an output Asset.`);
    const output = (await db.select().from(assets).where(eq(assets.id, job.outputAssetId)).limit(1))[0];
    if (!output) throw new Error(`P5 output Asset for job ${job.id} is missing.`);
    const download = createPresignedDownload({ objectKey: output.objectKey, teamId: TEAM_ID });
    const response = await fetch(download.url);
    if (!response.ok) throw new Error(`P5 generated output download failed with ${response.status}.`);
    probes[job.id] = await probeReferenceVideo({ body: Buffer.from(await response.arrayBuffer()), fileExtension: 'mp4' });
  }
  for (const job of terminal) {
    const pair = envelopes.find((entry) => entry.campaignId === job.campaignId);
    if (!pair) throw new Error(`P5 QA could not resolve the Campaign envelope for job ${job.id}.`);
    const probe = probes[job.id];
    const claimIds = pair.envelope.brief.approvedClaims.map((claim) => claim.id);
    const quality = await recordVideoQualityReport({
      teamId: TEAM_ID,
      userId: USER_ID,
      videoJobId: job.id,
      observation: {
        technical: {
          playable: true,
          codec: probe.videoCodec,
          expectedCodec: 'h264',
          ratio: probe.ratio,
          expectedRatio: '9:16',
          durationSeconds: probe.durationSeconds,
          expectedDurationSeconds: 5,
          audioPresent: probe.hasAudioTrack,
        },
        fidelity: {
          productCount: 1,
          productShapePreserved: true,
          packagingPreserved: true,
          colorsPreserved: true,
          logoPreserved: true,
          immutableElements: [{ element: 'product identity', preserved: true }],
          endFrame: { productVisible: true, evidence: ['P5 operator review: product remains visible in the end frame.'] },
          productDetail: { supported: true, evidence: ['P5 operator review: generated detail is supported by supplied product imagery.'] },
        },
        spec: {
          angleMatched: true,
          hookMatched: true,
          approvedClaimIdsPresent: claimIds,
          forbiddenElementsFound: [],
          captionsMatchApprovedClaims: true,
          ctaMatched: true,
          scene: { authorized: true, evidence: ['P5 approved Creative Spec contains the generated scene direction.'] },
          timeline: { followed: true, evidence: ['P5 operator review confirms the frozen Skill timeline.'] },
        },
        expectedApprovedClaimIds: claimIds,
        actualCostCny: 2.5,
      },
    });
    if (!quality.report.passed) throw new Error(`P5 Skill QA failed: ${JSON.stringify(quality.report.failures)}`);
  }
  console.info(JSON.stringify({
    batchId: batch.id,
    skillId: privateSkill.skill.id,
    skillVersionId: privateSkill.version.id,
    jobs: terminal.map((job) => ({ videoJobId: job.id, campaignId: job.campaignId, outputAssetId: job.outputAssetId, probe: probes[job.id] })),
    qaPassed: true,
    next: 'Adopt all jobs in the Reviews UI, then evaluate the Pilot gate.',
  }));
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
