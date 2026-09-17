import { createHash } from 'node:crypto';
import { and, asc, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  compileApprovedSpecRecipe,
  getPreferredApprovedSpecSkillId,
  previewCatalogItemEligibilityForTeam,
  resolveShotSkillVersionForApprovedSpec,
} from '@/lib/shot-skills';
import { db } from '@/lib/db/drizzle';
import { DomainError } from '@/lib/errors/domain';
import {
  ActivityType,
  activityLogs,
  assets,
  brandKits,
  campaigns,
  creativeReferences,
  catalogItemAssets,
  catalogItems,
  creativeSpecVersions,
  productionBatchItems,
  productionBatches,
  reviews,
  shotCards,
  shotSkills,
  shotSkillVersions,
  videoJobs,
} from '@/lib/db/schema';
import { getWaveStopReasons, isCostConfirmationValid, assertContractTransition, evaluatePilotGate, batchCostEstimateSchema, batchCostConfirmationSchema, WAVE_STOP_THRESHOLDS } from '@/lib/bulk/contracts';
import { validateGenerationModeSkuCount } from '@/lib/bulk/workflow-contracts';
import { enqueueVideoSubmission } from '@/lib/queue/video-generation';
import { getConfiguredVideoProvider } from '@/lib/video-providers';
import { shotSkillCardSchema } from '@/lib/shot-skills/schema';
import {
  assertBulkProductionAction,
  assertProductionBatchModeTransition,
  getPausedResumeStatus,
  pausableStatusesByMode,
} from './state';
import { ensureProductionBatchItemCampaign } from './spec-automation';
import { compileImageToVideoRecipe } from './image-video-recipe';
import { hashProductionPrompt, resolveProductionItemPrompt } from './prompts';

const createBatchInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  catalogItemIds: z.array(z.number().int().positive()).min(1),
  defaultBrandKitId: z.number().int().positive().optional(),
  defaultCreativeReferenceId: z.number().int().positive().optional(),
  shotSkillVersionId: z.number().int().positive().optional(),
  targetPlatform: z.string().trim().min(1).max(50),
  durationSeconds: z.number().int().min(4).max(15),
  campaignGoal: z.string().trim().min(1).max(4_000),
  waveSize: z.number().int().positive().max(100).default(WAVE_STOP_THRESHOLDS.defaultWaveSize),
  stopLossConfig: z.record(z.string(), z.unknown()).default({}),
  sourceMode: z.enum(['catalog', 'uploaded_images']).default('catalog'),
  sharedPrompt: z.string().trim().max(20_000).default(''),
}).strict();
const createImageBatchInputSchema = z.object({
  sourceMode: z.literal('uploaded_images').optional(),
  name: z.string().trim().min(1).max(160),
  targetPlatform: z.string().trim().min(1).max(50),
  durationSeconds: z.number().int().min(4).max(15),
  campaignGoal: z.string().trim().min(1).max(4_000),
  waveSize: z.number().int().positive().max(100).default(WAVE_STOP_THRESHOLDS.defaultWaveSize),
  stopLossConfig: z.record(z.string(), z.unknown()).default({}),
  sharedPrompt: z.string().trim().max(20_000).default(''),
}).strict();


const observeWaveInputSchema = z.object({
  waveNumber: z.number().int().positive(),
  productFidelityFailures: z.array(z.object({ sku: z.string().trim().min(1), count: z.number().int().positive() }).strict()),
  reviewedResults: z.array(z.object({ sku: z.string().trim().min(1), rejectionCause: z.string().trim().min(1).optional() }).strict()),
  supplierErrorRate: z.number().min(0).max(1),
  averageCostCny: z.number().nonnegative(),
  confirmedAverageCostCny: z.number().nonnegative(),
}).strict();

const MAX_WORKSPACE_CONCURRENCY = 10;
const RETRY_RESERVE_RATE = 0.2;
const MODEL_COST_PER_SECOND_CNY = 2;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonRecord(value: string): RecordValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

type BatchSkillLock = Record<string, {
  shotSkillVersionId: number;
  stableId: string;
  version: string;
  definitionHash: string;
}>;

function parseBatchSkillLock(value: string): BatchSkillLock {
  const parsed = jsonRecord(value);
  const lock: BatchSkillLock = {};
  for (const [selectionKey, candidate] of Object.entries(parsed)) {
    if (
      isRecord(candidate)
      && Number.isSafeInteger(candidate.shotSkillVersionId)
      && Number(candidate.shotSkillVersionId) > 0
      && typeof candidate.stableId === 'string'
      && typeof candidate.version === 'string'
      && typeof candidate.definitionHash === 'string'
    ) {
      lock[selectionKey] = {
        shotSkillVersionId: Number(candidate.shotSkillVersionId),
        stableId: candidate.stableId,
        version: candidate.version,
        definitionHash: candidate.definitionHash,
      };
    }
  }
  return lock;
}

async function ensureProductionBatchSkillBindings(teamId: number, batchId: number): Promise<BatchSkillLock> {
  const batch = await getBatchOrThrow(teamId, batchId);
  const lock = parseBatchSkillLock(batch.skillVersionLock);
  const rows = await db.select({
    item: productionBatchItems,
    shotCard: shotCards,
    spec: creativeSpecVersions,
  }).from(productionBatchItems)
    .innerJoin(shotCards, eq(shotCards.campaignId, productionBatchItems.campaignId))
    .innerJoin(creativeSpecVersions, eq(creativeSpecVersions.id, productionBatchItems.creativeSpecVersionId))
    .where(and(
      eq(productionBatchItems.teamId, teamId),
      eq(productionBatchItems.productionBatchId, batchId),
      eq(shotCards.status, 'selected'),
      eq(creativeSpecVersions.status, 'approved'),
    ));
  let lockChanged = false;
  for (const row of rows) {
    const selectionKey = getPreferredApprovedSpecSkillId(row.spec.specSnapshot);
    const lockedEntry = lock[selectionKey];
    const boundVersionId = row.shotCard.shotSkillVersionId ?? lockedEntry?.shotSkillVersionId;
    const resolved = await resolveShotSkillVersionForApprovedSpec({
      teamId,
      specSnapshot: row.spec.specSnapshot,
      lockedVersionId: boundVersionId,
    });
    if (
      lockedEntry
      && (
        lockedEntry.shotSkillVersionId !== resolved.version.id
        || lockedEntry.stableId !== resolved.skill.stableId
        || lockedEntry.version !== resolved.version.version
        || lockedEntry.definitionHash !== resolved.version.definitionHash
      )
    ) {
      throw new Error(`Batch Skill lock mismatch for ${selectionKey}.`);
    }
    if (!lockedEntry) {
      lock[selectionKey] = {
        shotSkillVersionId: resolved.version.id,
        stableId: resolved.skill.stableId,
        version: resolved.version.version,
        definitionHash: resolved.version.definitionHash,
      };
      lockChanged = true;
    }
    if (
      row.shotCard.shotSkillVersionId !== resolved.version.id
      || row.shotCard.skillSelectionReason !== resolved.selectionReason
    ) {
      await db.update(shotCards).set({
        shotSkillVersionId: resolved.version.id,
        skillSelectionReason: resolved.selectionReason,
        skillEligibility: JSON.stringify(resolved.eligibility),
        updatedAt: new Date(),
      }).where(and(eq(shotCards.id, row.shotCard.id), eq(shotCards.teamId, teamId)));
    }
  }
  if (lockChanged) {
    await db.update(productionBatches).set({
      skillVersionLock: JSON.stringify(lock),
      specHash: null,
      costConfirmation: null,
      costConfirmedAt: null,
      updatedAt: new Date(),
    }).where(and(eq(productionBatches.id, batchId), eq(productionBatches.teamId, teamId)));
  }
  return lock;
}

function riskScore(item: typeof catalogItems.$inferSelect, visualAssetCount = 0, referenceCount = 0): number {
  const categoryRisk = /medical|supplement|beauty|food|child|health/i.test(item.category) ? 3 : 1;
  const textRisk = `${item.mustShowElements} ${item.immutableElements}`.length > 80 ? 2 : 0;
  const claimRisk = item.approvedClaims !== '[]' ? 1 : 0;
  const assetRisk = visualAssetCount === 0 ? 2 : visualAssetCount >= 3 ? 1 : 0;
  const referenceRisk = referenceCount > 0 ? 1 : 0;
  return categoryRisk + textRisk + claimRisk + assetRisk + referenceRisk;
}

function estimateForSpec(snapshot: string, durationSeconds: number): { shotCount: number; durationSeconds: number; maxEstimatedCostCny: number } {
  const root = jsonRecord(snapshot);
  const creativeSpec = isRecord(root.creativeSpec) ? root.creativeSpec : {};
  const estimated = isRecord(creativeSpec.estimated) ? creativeSpec.estimated : {};
  const shotCount = typeof estimated.shotCount === 'number' && estimated.shotCount > 0 ? estimated.shotCount : 8;
  const duration = typeof estimated.durationSeconds === 'number' && estimated.durationSeconds > 0 ? estimated.durationSeconds : durationSeconds;
  const maxCost = typeof estimated.maxEstimatedCostCny === 'number' && estimated.maxEstimatedCostCny >= 0 ? estimated.maxEstimatedCostCny : duration * MODEL_COST_PER_SECOND_CNY;
  return { shotCount, durationSeconds: duration, maxEstimatedCostCny: maxCost };
}

function estimateHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function getBatchOrThrow(teamId: number, batchId: number) {
  const batch = await db.select().from(productionBatches).where(and(eq(productionBatches.id, batchId), eq(productionBatches.teamId, teamId))).limit(1);
  if (!batch[0]) throw new Error('Production Batch not found.');
  return batch[0];
}

function requireCatalogItemId(value: number | null, context: string): number {
  if (value === null) throw new Error(`${context} requires a CatalogItem.`);
  return value;
}

async function getBatchItemsWithCatalog(teamId: number, batchId: number) {
  const rows = await db.select({ item: productionBatchItems, catalogItem: catalogItems })
    .from(productionBatchItems)
    .innerJoin(catalogItems, eq(productionBatchItems.catalogItemId, catalogItems.id))
    .where(and(eq(productionBatchItems.teamId, teamId), eq(productionBatchItems.productionBatchId, batchId)))
    .orderBy(asc(productionBatchItems.sequence), asc(productionBatchItems.id));
  const catalogRows = rows.filter((row): row is typeof row & { catalogItem: NonNullable<typeof row.catalogItem> } => row.catalogItem !== null);
  const catalogItemIds = catalogRows.map((row) => row.catalogItem.id);
  if (catalogItemIds.length === 0) return catalogRows.map((row) => ({ ...row, visualAssetCount: 0, referenceCount: 0 }));
  const [assetCounts, referenceCounts] = await Promise.all([
    db.select({ catalogItemId: catalogItemAssets.catalogItemId, value: count() }).from(catalogItemAssets).where(and(eq(catalogItemAssets.teamId, teamId), inArray(catalogItemAssets.catalogItemId, catalogItemIds))).groupBy(catalogItemAssets.catalogItemId),
    db.select({ catalogItemId: creativeReferences.catalogItemId, value: count() }).from(creativeReferences).where(and(eq(creativeReferences.teamId, teamId), inArray(creativeReferences.catalogItemId, catalogItemIds))).groupBy(creativeReferences.catalogItemId),
  ]);
  const assetsByItem = new Map(assetCounts.map((row) => [row.catalogItemId, Number(row.value)]));
  const referencesByItem = new Map(referenceCounts.map((row) => [row.catalogItemId, Number(row.value)]));
  return catalogRows.map((row) => ({ ...row, visualAssetCount: assetsByItem.get(row.catalogItem.id) ?? 0, referenceCount: referencesByItem.get(row.catalogItem.id) ?? 0 }));
}

export async function createProductionBatch(input: { teamId: number; userId: number; data: unknown }) {
  const parsed = createBatchInputSchema.parse(input.data);
  if (parsed.sourceMode !== 'catalog') throw new Error('Uploaded image batches use the Image-to-Video upload workflow.');
  const itemIds = [...new Set(parsed.catalogItemIds)];
  if (itemIds.length !== parsed.catalogItemIds.length) {
    throw new DomainError('request_invalid', { field: 'catalogItemIds', message: 'Choose each SKU only once.' });
  }
  const generationMode = itemIds.length === 1 ? 'single' : 'bulk';
  const modeSkuCount = validateGenerationModeSkuCount({ mode: generationMode, skuCount: itemIds.length });
  if (!modeSkuCount.valid) {
    const guidance = itemIds.length === 2
      ? 'Two SKU do not form a Production Batch. Add at least one SKU for Bulk, or split them into two Single tasks.'
      : modeSkuCount.issue.message;
    throw new DomainError('request_invalid', { field: 'catalogItemIds', message: guidance });
  }
  const previews = await Promise.all(itemIds.map((catalogItemId) =>
    previewCatalogItemEligibilityForTeam({
      teamId: input.teamId,
      catalogItemId,
      durationSeconds: parsed.durationSeconds,
      targetPlatform: parsed.targetPlatform,
      preferredVersionId: parsed.shotSkillVersionId,
    }),
  ));
  if (previews.some((preview) => !preview)) {
    throw new DomainError('workspace_entity_forbidden', {
      details: { selectedSkuCount: itemIds.length },
      remediations: [{ action: 'choose_workspace_sku', label: 'Choose Workspace SKU', href: '/dashboard/batches' }],
    });
  }
  const eligibility = previews.filter((preview) => preview !== null);
  const commonCandidates = eligibility[0]!.candidates.filter((candidate) =>
    candidate.eligible
    && eligibility.every((preview) => preview.candidates.some((entry) =>
      entry.versionId === candidate.versionId && entry.eligible,
    )),
  );
  const selectedSkill = commonCandidates.find((candidate) => candidate.versionId === parsed.shotSkillVersionId)
    ?? commonCandidates.find((candidate) => candidate.stableId === 'product-hero')
    ?? commonCandidates[0];
  if (parsed.shotSkillVersionId && selectedSkill?.versionId !== parsed.shotSkillVersionId) {
    throw new DomainError('skill_ineligible', {
      message: 'The selected Shot Skill version is not eligible for every selected SKU.',
      details: { selectedShotSkillVersionId: parsed.shotSkillVersionId },
    });
  }
  if (!selectedSkill || eligibility.some((preview) => !preview.canCreate)) {
    const messages = eligibility.flatMap((preview) => [
      ...preview.blockers.map((blocker) => blocker.message),
      ...preview.candidates.flatMap((candidate) => candidate.blockers.map((blocker) => `${candidate.name}: ${blocker.message}`)),
    ]);
    const remediations = [...new Map(eligibility.flatMap((preview) =>
      preview.candidates.flatMap((candidate) =>
        candidate.blockers.flatMap((blocker) =>
          blocker.remediations.flatMap((remediation) => remediation.href ? [[
            `${remediation.code}:${remediation.href}`,
            { action: remediation.code, label: remediation.label, href: remediation.href },
          ] as const] : []),
        ),
      ),
    )).values()];
    throw new DomainError('skill_ineligible', {
      message: [...new Set(messages)].join(' ') || undefined,
      remediations: remediations.length ? remediations : undefined,
    });
  }
  const initialSkillVersionLock: BatchSkillLock = {
    [selectedSkill.stableId]: {
      shotSkillVersionId: selectedSkill.versionId,
      stableId: selectedSkill.stableId,
      version: selectedSkill.version,
      definitionHash: selectedSkill.definitionHash,
    },
  };
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(productionBatches).where(and(eq(productionBatches.teamId, input.teamId), eq(productionBatches.name, parsed.name))).limit(1);
    if (existing[0]) {
      const existingItems = await tx.select({ catalogItemId: productionBatchItems.catalogItemId }).from(productionBatchItems).where(eq(productionBatchItems.productionBatchId, existing[0].id));
      const existingLock = parseBatchSkillLock(existing[0].skillVersionLock);
      const sameSelection = Object.values(existingLock).some((entry) =>
        entry.shotSkillVersionId === selectedSkill.versionId
        && entry.definitionHash === selectedSkill.definitionHash,
      );
      if (
        existingItems.length === itemIds.length
        && existingItems.every((row) => row.catalogItemId !== null && itemIds.includes(row.catalogItemId))
        && sameSelection
      ) return existing[0];
      throw new Error('A Production Batch with this name already exists with different SKU or Shot Skill selections.');
    }
    const activeSelection = await tx.select({ id: shotSkillVersions.id })
      .from(shotSkillVersions)
      .innerJoin(shotSkills, eq(shotSkills.id, shotSkillVersions.shotSkillId))
      .where(and(
        eq(shotSkillVersions.id, selectedSkill.versionId),
        eq(shotSkillVersions.status, 'active'),
        eq(shotSkillVersions.definitionHash, selectedSkill.definitionHash),
        or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
      ))
      .limit(1);
    if (!activeSelection[0]) {
      throw new Error('The selected Shot Skill version changed after Eligibility preview. Refresh and choose an Active version again.');
    }
    const readyItems = await tx.select().from(catalogItems).where(and(eq(catalogItems.teamId, input.teamId), inArray(catalogItems.id, itemIds)));
    if (readyItems.length !== itemIds.length || readyItems.some((item) => item.readinessStatus !== 'ready')) throw new Error('Only ready CatalogItems from the current workspace can enter a Production Batch.');
    if (parsed.defaultBrandKitId) {
      const brand = await tx.select({ id: brandKits.id }).from(brandKits).where(and(eq(brandKits.id, parsed.defaultBrandKitId), eq(brandKits.teamId, input.teamId))).limit(1);
      if (!brand[0]) throw new Error('Default Brand Kit does not belong to the current workspace.');
    }
    if (parsed.defaultCreativeReferenceId) {
      const reference = await tx.select({ id: creativeReferences.id }).from(creativeReferences).where(and(eq(creativeReferences.id, parsed.defaultCreativeReferenceId), eq(creativeReferences.teamId, input.teamId))).limit(1);
      if (!reference[0]) throw new Error('Default Creative Reference does not belong to the current workspace.');
    }
    const inserted = await tx.insert(productionBatches).values({
      teamId: input.teamId,
      createdBy: input.userId,
      name: parsed.name,
      generationMode,
      sourceMode: 'catalog',
      sharedPrompt: parsed.sharedPrompt,
      sharedPromptVersion: 1,
      defaultBrandKitId: parsed.defaultBrandKitId,
      defaultCreativeReferenceId: parsed.defaultCreativeReferenceId,
      targetPlatform: parsed.targetPlatform,
      durationSeconds: parsed.durationSeconds,
      campaignGoal: parsed.campaignGoal,
      waveSize: parsed.waveSize,
      stopLossConfig: JSON.stringify(parsed.stopLossConfig),
      skillVersionLock: JSON.stringify(initialSkillVersionLock),
    }).returning();
    const batch = inserted[0];
    if (!batch) throw new Error('Production Batch could not be created.');
    await tx.insert(productionBatchItems).values(itemIds.map((catalogItemId, index) => ({
      teamId: input.teamId,
      productionBatchId: batch.id,
      catalogItemId,
      sequence: index + 1,
    })));
    await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.CREATE_PRODUCTION_BATCH });
    return batch;
  });
}

export async function createImageToVideoBatch(input: { teamId: number; userId: number; data: unknown }) {
  const parsed = createImageBatchInputSchema.parse(input.data);
  const inserted = await db.insert(productionBatches).values({
    teamId: input.teamId,
    createdBy: input.userId,
    name: parsed.name,
    status: 'draft',
    generationMode: 'bulk',
    sourceMode: 'uploaded_images',
    sharedPrompt: parsed.sharedPrompt,
    sharedPromptVersion: 1,
    targetPlatform: parsed.targetPlatform,
    durationSeconds: parsed.durationSeconds,
    campaignGoal: parsed.campaignGoal,
    waveSize: parsed.waveSize,
    stopLossConfig: JSON.stringify(parsed.stopLossConfig),
    skillVersionLock: '{}',
  }).returning();
  if (!inserted[0]) throw new Error('Image-to-Video Batch could not be created.');
  await db.insert(activityLogs).values({
    teamId: input.teamId,
    userId: input.userId,
    action: ActivityType.CREATE_PRODUCTION_BATCH,
    metadata: { productionBatchId: inserted[0].id, sourceMode: 'uploaded_images' },
  });
  return inserted[0];
}

export async function prepareSingleProductionBatch(input: {
  teamId: number;
  userId: number;
  batchId: number;
}) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.generationMode !== 'single') throw new Error('Prepare Single is only available for Single production.');
  if (batch.status !== 'draft' && batch.status !== 'ready_for_spec') {
    throw new Error('Single production can only prepare its Campaign from draft.');
  }
  const rows = await getBatchItemsWithCatalog(input.teamId, input.batchId);
  if (rows.length !== 1) throw new Error('Single production requires exactly one CatalogItem.');
  const campaign = await ensureProductionBatchItemCampaign({
    teamId: input.teamId,
    userId: input.userId,
    batchId: input.batchId,
    itemId: rows[0]!.item.id,
  });
  const current = await getBatchOrThrow(input.teamId, input.batchId);
  return { ...campaign, status: current.status };
}

export async function estimateProductionBatchCost(input: { teamId: number; userId?: number; batchId: number }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.sourceMode === 'uploaded_images') {
    const rows = await db.select({
      id: productionBatchItems.id,
      inputAssetId: productionBatchItems.inputAssetId,
      promptMode: productionBatchItems.promptMode,
      promptOverride: productionBatchItems.promptOverride,
    }).from(productionBatchItems).where(and(
      eq(productionBatchItems.teamId, input.teamId),
      eq(productionBatchItems.productionBatchId, input.batchId),
    )).orderBy(asc(productionBatchItems.sequence), asc(productionBatchItems.id));
    const generatedSeconds = rows.length * batch.durationSeconds;
    const retryReserveSeconds = generatedSeconds * RETRY_RESERVE_RATE;
    const modelCostCny = generatedSeconds * MODEL_COST_PER_SECOND_CNY;
    const retryReserveCostCny = modelCostCny * RETRY_RESERVE_RATE;
    const storageAndServiceReserveCny = rows.length;
    const maxEstimatedCostCny = modelCostCny + retryReserveCostCny + storageAndServiceReserveCny;
    const specHash = estimateHash({
      batchId: batch.id,
      sourceMode: batch.sourceMode,
      targetPlatform: batch.targetPlatform,
      durationSeconds: batch.durationSeconds,
      sharedPromptVersion: batch.sharedPromptVersion,
      itemInputs: rows.map((row) => ({
        id: row.id,
        inputAssetId: row.inputAssetId,
        promptMode: row.promptMode,
        promptHash: hashProductionPrompt(resolveProductionItemPrompt(batch, row)),
      })),
      maxEstimatedCostCny,
    });
    const estimate = batchCostEstimateSchema.parse({
      specHash,
      currency: 'CNY',
      itemCount: rows.length,
      shotCount: rows.length,
      generatedSeconds,
      retryReserveSeconds,
      modelCostCny,
      retryReserveCostCny,
      storageAndServiceReserveCny,
      maxEstimatedCostCny,
    });
    if (batch.specHash !== specHash || Number(batch.maxEstimatedCostCny ?? -1) !== maxEstimatedCostCny) {
      await db.update(productionBatches).set({
        specHash,
        maxEstimatedCostCny: maxEstimatedCostCny.toFixed(2),
        costConfirmation: null,
        costConfirmedAt: null,
        updatedAt: new Date(),
      }).where(and(eq(productionBatches.id, batch.id), eq(productionBatches.teamId, input.teamId)));
    }
    if (input.userId) await db.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.ESTIMATE_BATCH_COST });
    return estimate;
  }
  const skillVersionLock = await ensureProductionBatchSkillBindings(input.teamId, input.batchId);
  const rows = await getBatchItemsWithCatalog(input.teamId, input.batchId);
  const specIds = rows.map((row) => row.item.creativeSpecVersionId).filter((id): id is number => id !== null);
  const specs = specIds.length === 0 ? [] : await db.select().from(creativeSpecVersions).where(and(eq(creativeSpecVersions.teamId, input.teamId), inArray(creativeSpecVersions.id, specIds)));
  const specById = new Map(specs.map((spec) => [spec.id, spec]));
  const estimates = rows.map((row) => estimateForSpec(row.item.creativeSpecVersionId ? specById.get(row.item.creativeSpecVersionId)?.specSnapshot ?? '' : '', batch.durationSeconds));
  const shotCount = estimates.reduce((sum, item) => sum + item.shotCount, 0);
  const generatedSeconds = estimates.reduce((sum, item) => sum + item.durationSeconds, 0);
  const retryReserveSeconds = generatedSeconds * RETRY_RESERVE_RATE;
  const modelCostCny = generatedSeconds * MODEL_COST_PER_SECOND_CNY;
  const retryReserveCostCny = modelCostCny * RETRY_RESERVE_RATE;
  const storageAndServiceReserveCny = rows.length;
  const maxEstimatedCostCny = modelCostCny + retryReserveCostCny + storageAndServiceReserveCny;
  const specHash = estimateHash({ batchId: batch.id, targetPlatform: batch.targetPlatform, durationSeconds: batch.durationSeconds, itemIds: rows.map((row) => row.catalogItem.id), specIds: rows.map((row) => row.item.creativeSpecVersionId), skillVersionLock, maxEstimatedCostCny });
  const estimate = batchCostEstimateSchema.parse({ specHash, currency: 'CNY', itemCount: rows.length, shotCount, generatedSeconds, retryReserveSeconds, modelCostCny, retryReserveCostCny, storageAndServiceReserveCny, maxEstimatedCostCny });
  if (batch.specHash !== specHash || Number(batch.maxEstimatedCostCny ?? -1) !== maxEstimatedCostCny) {
    await db.update(productionBatches).set({ specHash, maxEstimatedCostCny: maxEstimatedCostCny.toFixed(2), costConfirmation: null, costConfirmedAt: null, updatedAt: new Date() }).where(and(eq(productionBatches.id, batch.id), eq(productionBatches.teamId, input.teamId)));
  }
  if (input.userId) await db.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.ESTIMATE_BATCH_COST });
  return estimate;
}

export async function updateImageBatchSharedPrompt(input: { teamId: number; userId: number; batchId: number; prompt: string }) {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 20_000) throw new Error('Shared Prompt must contain 1–20,000 characters.');
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.sourceMode !== 'uploaded_images') throw new Error('Shared Prompt editing is only available for Image-to-Video Batches.');
  if (['completed', 'cancelled'].includes(batch.status)) throw new Error('Completed Batches cannot change their Prompt.');
  const updated = await db.update(productionBatches).set({
    sharedPrompt: prompt,
    sharedPromptVersion: batch.sharedPromptVersion + 1,
    specHash: null,
    costConfirmation: null,
    costConfirmedAt: null,
    updatedAt: new Date(),
  }).where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId))).returning();
  await db.insert(activityLogs).values({
    teamId: input.teamId,
    userId: input.userId,
    action: ActivityType.UPDATE_PRODUCTION_BATCH_PROMPT,
    metadata: { productionBatchId: input.batchId, promptVersion: batch.sharedPromptVersion + 1 },
  });
  return updated[0];
}

export async function updateImageBatchItemPrompt(input: { teamId: number; userId: number; batchId: number; itemId: number; mode: 'inherit' | 'override'; prompt?: string }) {
  const override = input.mode === 'override' ? input.prompt?.trim() ?? '' : null;
  if (input.mode === 'override' && (!override || override.length > 20_000)) throw new Error('Custom Prompt must contain 1–20,000 characters.');
  const item = (await db.select({ item: productionBatchItems, batch: productionBatches }).from(productionBatchItems)
    .innerJoin(productionBatches, eq(productionBatchItems.productionBatchId, productionBatches.id))
    .where(and(
      eq(productionBatchItems.id, input.itemId),
      eq(productionBatchItems.productionBatchId, input.batchId),
      eq(productionBatchItems.teamId, input.teamId),
      eq(productionBatches.teamId, input.teamId),
    )).limit(1))[0];
  if (!item || item.batch.sourceMode !== 'uploaded_images') throw new Error('Image item is not available in the current Workspace.');
  if (['completed', 'cancelled'].includes(item.batch.status)) throw new Error('Completed Batches cannot change an Item Prompt.');
  const updated = await db.update(productionBatchItems).set({
    promptMode: input.mode,
    promptOverride: override,
    updatedAt: new Date(),
  }).where(and(eq(productionBatchItems.id, input.itemId), eq(productionBatchItems.teamId, input.teamId))).returning();
  await db.update(productionBatches).set({
    specHash: null,
    costConfirmation: null,
    costConfirmedAt: null,
    updatedAt: new Date(),
  }).where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId)));
  await db.insert(activityLogs).values({
    teamId: input.teamId,
    userId: input.userId,
    action: ActivityType.UPDATE_PRODUCTION_BATCH_PROMPT,
    metadata: { productionBatchId: input.batchId, productionBatchItemId: input.itemId, promptMode: input.mode },
  });
  return updated[0];
}
export async function updateImageBatchItemsPrompt(input: { teamId: number; userId: number; batchId: number; itemIds: number[]; mode: 'inherit' }) {
  const ids = [...new Set(input.itemIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0 || ids.length > 500) throw new Error('Select 1–500 image items.');
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.sourceMode !== 'uploaded_images') throw new Error('Image items are not available in the current Workspace.');
  if (['completed', 'cancelled'].includes(batch.status)) throw new Error('Completed Batches cannot change Item Prompts.');
  const updated = await db.update(productionBatchItems).set({ promptMode: input.mode, promptOverride: null, updatedAt: new Date() })
    .where(and(eq(productionBatchItems.productionBatchId, input.batchId), eq(productionBatchItems.teamId, input.teamId), inArray(productionBatchItems.id, ids))).returning({ id: productionBatchItems.id });
  await db.update(productionBatches).set({ specHash: null, costConfirmation: null, costConfirmedAt: null, updatedAt: new Date() })
    .where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId)));
  await db.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.UPDATE_PRODUCTION_BATCH_PROMPT, metadata: { productionBatchId: input.batchId, productionBatchItemIds: updated.map((item) => item.id), promptMode: input.mode } });
  return { updated: updated.length };
}

export async function getImageBatchEligibility(input: { teamId: number; batchId: number }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.sourceMode !== 'uploaded_images') throw new Error('Eligibility is only available for Image-to-Video Batches.');
  const items = await db.select({ item: productionBatchItems, asset: assets }).from(productionBatchItems)
    .leftJoin(assets, and(eq(assets.id, productionBatchItems.inputAssetId), eq(assets.teamId, input.teamId)))
    .where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId)))
    .orderBy(asc(productionBatchItems.sequence));
  const results = items.map(({ item, asset }) => {
    const blockers: string[] = [];
    if (!asset) blockers.push('input Asset is not archived');
    if (asset && asset.type !== 'product_image') blockers.push('input Asset is not a product image');
    try { resolveProductionItemPrompt(batch, item); } catch (error) { blockers.push(error instanceof Error ? error.message : 'Effective Prompt is invalid'); }
    return { itemId: item.id, sequence: item.sequence, eligible: blockers.length === 0, blockers };
  });
  return {
    eligible: results.every((item) => item.eligible),
    model: 'MiniMax-H3',
    imageRole: 'reference_image' as const,
    durationSeconds: batch.durationSeconds,
    ratio: '9:16',
    resolution: '768P',
    items: results,
  };
}

export async function selectImageBatchPilots(input: { teamId: number; userId: number; batchId: number; itemIds?: number[] }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.sourceMode !== 'uploaded_images') throw new Error('Image pilots require an Image-to-Video Batch.');
  const allItems = await db.select().from(productionBatchItems).where(and(
    eq(productionBatchItems.teamId, input.teamId),
    eq(productionBatchItems.productionBatchId, input.batchId),
  )).orderBy(asc(productionBatchItems.sequence));
  const requestedIds = input.itemIds?.length ? [...new Set(input.itemIds)] : [];
  const existingPilots = allItems.filter((item) => item.isPilot);
  const addingPilots = batch.status === 'pilot_review';

  if (!addingPilots && !['draft', 'ready_for_spec', 'calibrating'].includes(batch.status)) {
    throw new Error('Pilot selection is only available before Pilot generation starts.');
  }
  if (!addingPilots) {
    const existingJob = allItems.length === 0 ? [] : await db.select({ id: videoJobs.id }).from(videoJobs).where(and(
      eq(videoJobs.teamId, input.teamId),
      inArray(videoJobs.productionBatchItemId, allItems.map((item) => item.id)),
    )).limit(1);
    if (existingJob.length > 0) throw new Error('Pilot images cannot be replaced after Pilot generation has started. Add ready images while reviewing instead.');
  }

  const selectableItems = allItems.filter((item) => item.status === 'ready');
  const selected = requestedIds.length
    ? selectableItems.filter((item) => requestedIds.includes(item.id))
    : addingPilots
      ? []
      : selectableItems.length <= 3
        ? selectableItems
        : [selectableItems[0]!, selectableItems[Math.floor((selectableItems.length - 1) / 2)]!, selectableItems.at(-1)!];
  const maximumSelected = addingPilots ? 3 - existingPilots.length : 3;
  if (requestedIds.length && (selected.length !== requestedIds.length || selected.length > maximumSelected)) {
    throw new Error(addingPilots
      ? `Choose one to ${maximumSelected} ready image${maximumSelected === 1 ? '' : 's'} to add as Pilots.`
      : 'Choose one to three ready Pilot images from this Batch.');
  }
  if (selected.length === 0) {
    throw new Error(addingPilots
      ? 'Select at least one ready image to add as a Pilot.'
      : 'Upload at least one ready image before selecting pilots.');
  }
  await db.transaction(async (tx) => {
    if (batch.status === 'draft' || batch.status === 'ready_for_spec') {
      await tx.update(productionBatches).set({ status: 'calibrating', updatedAt: new Date() }).where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId)));
    } else if (!['calibrating', 'pilot_review'].includes(batch.status)) {
      throw new Error('Image Pilot selection is only available before production starts.');
    }
    if (!addingPilots) {
      await tx.update(productionBatchItems).set({ isPilot: false, status: 'ready', updatedAt: new Date() }).where(and(
        eq(productionBatchItems.teamId, input.teamId),
        eq(productionBatchItems.productionBatchId, input.batchId),
        inArray(productionBatchItems.status, ['ready', 'pilot']),
      ));
    }
    for (const item of selected) {
      await tx.update(productionBatchItems).set({ isPilot: true, status: 'pilot', updatedAt: new Date() }).where(and(
        eq(productionBatchItems.id, item.id),
        eq(productionBatchItems.teamId, input.teamId),
        eq(productionBatchItems.productionBatchId, input.batchId),
      ));
    }
    await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.SELECT_BATCH_PILOTS, metadata: { productionBatchId: input.batchId, itemIds: selected.map((item) => item.id), mode: addingPilots ? 'add' : 'replace' } });
  });
  return { selectedItemIds: selected.map((item) => item.id) };
}

export async function scheduleImageBatchJobs(input: { teamId: number; userId: number; batchId: number; pilotOnly: boolean }) {
  let batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.sourceMode !== 'uploaded_images') throw new Error('Image jobs require an Image-to-Video Batch.');
  if (!batch.sharedPrompt.trim()) throw new Error('Set a Shared Prompt before generating videos.');
  if (input.pilotOnly) {
    if (!['calibrating', 'pilot_review'].includes(batch.status)) throw new Error('Image Pilots require a calibrating Batch.');
  } else if (!['ready', 'producing'].includes(batch.status)) {
    throw new Error('The Image Batch must pass the Pilot gate before full production.');
  }
  const estimate = await estimateProductionBatchCost(input);
  batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (!batch.costConfirmation || !isCostConfirmationValid(estimate, jsonRecord(batch.costConfirmation))) {
    throw staleCostConfirmationError(estimate, batch.costConfirmation ? jsonRecord(batch.costConfirmation) : null);
  }
  const active = await db.select({ value: count() }).from(videoJobs).where(and(
    eq(videoJobs.teamId, input.teamId),
    sql`${videoJobs.status} IN ('queued', 'generating')`,
  ));
  const slots = Math.max(0, MAX_WORKSPACE_CONCURRENCY - Number(active[0]?.value ?? 0));
  if (slots === 0) throw new Error('Workspace video concurrency limit reached.');
  let rows = await db.select().from(productionBatchItems).where(and(
    eq(productionBatchItems.teamId, input.teamId),
    eq(productionBatchItems.productionBatchId, input.batchId),
    input.pilotOnly ? eq(productionBatchItems.isPilot, true) : eq(productionBatchItems.isPilot, false),
    input.pilotOnly ? eq(productionBatchItems.status, 'pilot') : eq(productionBatchItems.status, 'ready'),
  )).orderBy(asc(productionBatchItems.sequence));
  if (!input.pilotOnly && rows.some((item) => item.waveNumber === 0)) {
    await db.transaction(async (tx) => {
      for (const [index, item] of rows.entries()) {
        await tx.update(productionBatchItems).set({ waveNumber: Math.floor(index / batch.waveSize) + 1, updatedAt: new Date() }).where(and(
          eq(productionBatchItems.id, item.id),
          eq(productionBatchItems.teamId, input.teamId),
        ));
      }
    });
    rows = await db.select().from(productionBatchItems).where(and(
      eq(productionBatchItems.teamId, input.teamId),
      eq(productionBatchItems.productionBatchId, input.batchId),
      eq(productionBatchItems.isPilot, false),
      eq(productionBatchItems.status, 'ready'),
    )).orderBy(asc(productionBatchItems.waveNumber), asc(productionBatchItems.sequence));
  }
  if (!input.pilotOnly && rows.length > 0) {
    const nextWave = Math.min(...rows.map((item) => item.waveNumber));
    rows = rows.filter((item) => item.waveNumber === nextWave);
  }
  rows = rows.slice(0, slots);
  if (rows.length === 0) return { queued: 0, videoJobIds: [] };
  const jobIds = await db.transaction(async (tx) => {
    const ids: number[] = [];
    for (const item of rows) {
      if (item.inputAssetId === null) throw new Error(`Image ${item.sequence} has no archived input Asset.`);
      const recipe = compileImageToVideoRecipe({ batch, item });
      const existing = await tx.select({ id: videoJobs.id }).from(videoJobs).where(and(
        eq(videoJobs.teamId, input.teamId),
        eq(videoJobs.productionBatchItemId, item.id),
        sql`${videoJobs.status} IN ('queued', 'generating')`,
      )).limit(1);
      if (existing[0]) {
        ids.push(existing[0].id);
        continue;
      }
      const inserted = await tx.insert(videoJobs).values({
        teamId: input.teamId,
        productionBatchItemId: item.id,
        inputAssetId: item.inputAssetId,
        submittedBy: input.userId,
        provider: getConfiguredVideoProvider(),
        recipeSnapshot: JSON.stringify(recipe),
        status: 'queued',
      }).returning({ id: videoJobs.id });
      if (!inserted[0]) throw new Error(`Image ${item.sequence} VideoJob could not be created.`);
      await tx.update(productionBatchItems).set({ status: 'queued', updatedAt: new Date() }).where(and(
        eq(productionBatchItems.id, item.id),
        eq(productionBatchItems.teamId, input.teamId),
      ));
      ids.push(inserted[0].id);
    }
    await tx.update(productionBatches).set({ status: input.pilotOnly ? 'calibrating' : 'producing', updatedAt: new Date() }).where(and(
      eq(productionBatches.id, input.batchId),
      eq(productionBatches.teamId, input.teamId),
    ));
    await tx.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.SUBMIT_VIDEO_JOB,
      metadata: { productionBatchId: input.batchId, pilotOnly: input.pilotOnly, queued: ids.length, waveNumber: rows[0]?.waveNumber ?? 0 },
    });
    return ids;
  });
  for (const jobId of jobIds) await enqueueVideoSubmission(jobId);
  return { queued: jobIds.length, videoJobIds: jobIds };
}

export async function retryImageBatchJobs(input: { teamId: number; userId: number; batchId: number; itemIds: number[]; useCurrentPrompt: boolean }) {
  let batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.sourceMode !== 'uploaded_images') throw new Error('Image retry requires an Image-to-Video Batch.');
  if (batch.status === 'paused' || ['completed', 'cancelled'].includes(batch.status)) throw new Error('Resume this Batch before retrying images.');
  if (input.useCurrentPrompt) {
    if (!['ready', 'producing'].includes(batch.status)) throw new Error('Regeneration requires a released Image Batch.');
    const estimate = await estimateProductionBatchCost(input);
    batch = await getBatchOrThrow(input.teamId, input.batchId);
    if (!batch.costConfirmation || !isCostConfirmationValid(estimate, jsonRecord(batch.costConfirmation))) {
      throw staleCostConfirmationError(estimate, batch.costConfirmation ? jsonRecord(batch.costConfirmation) : null);
    }
  }
  const ids = [...new Set(input.itemIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0 || ids.length > 500) throw new Error('Select 1–500 image items.');
  const items = await db.select().from(productionBatchItems).where(and(
    eq(productionBatchItems.teamId, input.teamId),
    eq(productionBatchItems.productionBatchId, input.batchId),
    inArray(productionBatchItems.id, ids),
  ));
  if (items.length !== ids.length) throw new Error('One or more image items are not available in this Workspace.');
  const active = await db.select({ value: count() }).from(videoJobs).where(and(eq(videoJobs.teamId, input.teamId), sql`${videoJobs.status} IN ('queued', 'generating')`));
  const slots = Math.max(0, MAX_WORKSPACE_CONCURRENCY - Number(active[0]?.value ?? 0));
  if (slots === 0) throw new Error('Workspace video concurrency limit reached.');
  if (items.length > slots) throw new Error(`Only ${slots} Workspace video slots are available; select fewer image items.`);
  const selected = items;
  const jobIds = await db.transaction(async (tx) => {
    const createdIds: number[] = [];
    for (const item of selected) {
      if (item.inputAssetId === null) throw new Error(`Image ${item.sequence} has no archived input Asset.`);
      const latest = (await tx.select().from(videoJobs).where(and(
        eq(videoJobs.teamId, input.teamId),
        eq(videoJobs.productionBatchItemId, item.id),
      )).orderBy(sql`${videoJobs.createdAt} DESC`).limit(1))[0];
      if (latest?.status === 'queued' || latest?.status === 'generating') throw new Error(`Image ${item.sequence} already has an active VideoJob.`);
      if (!input.useCurrentPrompt && (!latest || latest.status !== 'failed' || !latest.recipeSnapshot)) {
        throw new Error(`Image ${item.sequence} does not have a failed frozen Recipe to retry.`);
      }
      const recipeSnapshot = input.useCurrentPrompt
        ? JSON.stringify(compileImageToVideoRecipe({ batch, item }))
        : latest!.recipeSnapshot!;
      const inserted = await tx.insert(videoJobs).values({
        teamId: input.teamId,
        productionBatchItemId: item.id,
        inputAssetId: item.inputAssetId,
        submittedBy: input.userId,
        provider: getConfiguredVideoProvider(),
        recipeSnapshot,
        retryOfVideoJobId: latest?.retryOfVideoJobId ?? latest?.id ?? null,
        retryReason: input.useCurrentPrompt ? 'regenerate' : 'technical',
        status: 'queued',
      }).returning({ id: videoJobs.id });
      if (!inserted[0]) throw new Error(`Image ${item.sequence} retry could not be created.`);
      await tx.update(productionBatchItems).set({ status: 'queued', lastError: null, updatedAt: new Date() }).where(and(
        eq(productionBatchItems.id, item.id),
        eq(productionBatchItems.teamId, input.teamId),
      ));
      createdIds.push(inserted[0].id);
    }
    await tx.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.RETRY_VIDEO_JOB,
      metadata: { productionBatchId: input.batchId, itemIds: selected.map((item) => item.id), useCurrentPrompt: input.useCurrentPrompt },
    });
    return createdIds;
  });
  for (const videoJobId of jobIds) await enqueueVideoSubmission(videoJobId);
  return { queued: jobIds.length, videoJobIds: jobIds };
}

function staleCostConfirmationError(estimateInput: unknown, confirmationInput: unknown): DomainError {
  const estimate = batchCostEstimateSchema.parse(estimateInput);
  const confirmation = batchCostConfirmationSchema.safeParse(confirmationInput);
  const invalidatedBy: string[] = [];
  if (!confirmation.success) {
    invalidatedBy.push('no valid cost confirmation is recorded');
  } else {
    if (confirmation.data.specHash !== estimate.specHash) {
      invalidatedBy.push('the production input fingerprint changed (approved Spec, frozen Skill, selected SKUs, or duration)');
    }
    if (confirmation.data.maxEstimatedCostCny !== estimate.maxEstimatedCostCny) {
      invalidatedBy.push(`the estimate changed from ¥${confirmation.data.maxEstimatedCostCny.toFixed(2)} to ¥${estimate.maxEstimatedCostCny.toFixed(2)}`);
    }
  }
  if (invalidatedBy.length === 0) invalidatedBy.push('the stored confirmation no longer matches the current estimate');
  return new DomainError('cost_confirmation_stale', {
    message: `Cost confirmation is stale because ${invalidatedBy.join(' and ')}. Re-estimate and confirm the current cost.`,
    details: {
      invalidatedBy: invalidatedBy.join('; '),
      currentMaxEstimatedCostCny: estimate.maxEstimatedCostCny,
    },
  });
}


export async function confirmProductionBatchCost(input: { teamId: number; userId: number; batchId: number; expectedMaxEstimatedCostCny: number }) {
  const estimate = await estimateProductionBatchCost(input);
  const confirmation = batchCostConfirmationSchema.parse({ specHash: estimate.specHash, maxEstimatedCostCny: input.expectedMaxEstimatedCostCny, confirmed: true, confirmedBy: input.userId, confirmedAt: new Date().toISOString() });
  if (!isCostConfirmationValid(estimate, confirmation)) throw staleCostConfirmationError(estimate, confirmation);
  await db.transaction(async (tx) => {
    await tx.update(productionBatches).set({ costConfirmation: JSON.stringify(confirmation), costConfirmedAt: new Date(), updatedAt: new Date() }).where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId)));
    await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.CONFIRM_BATCH_COST });
  });
  return confirmation;
}


export async function selectProductionBatchPilots(input: { teamId: number; userId: number; batchId: number }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  assertBulkProductionAction(batch.generationMode, 'Pilot selection');
  if (batch.status === 'draft') assertContractTransition('production_batch', batch.status, 'calibrating');
  else if (batch.status !== 'calibrating' && batch.status !== 'pilot_review') throw new Error('Pilot selection is only available while calibrating or reviewing.');
  const rows = await getBatchItemsWithCatalog(input.teamId, input.batchId);
  const sorted = rows.sort((a, b) => riskScore(b.catalogItem, b.visualAssetCount, b.referenceCount) - riskScore(a.catalogItem, a.visualAssetCount, a.referenceCount) || a.catalogItem.id - b.catalogItem.id);
  const pilotIds = new Set(sorted.slice(0, Math.min(3, sorted.length)).map((row) => row.item.id));
  await db.transaction(async (tx) => {
    if (batch.status === 'draft') await tx.update(productionBatches).set({ status: 'calibrating', updatedAt: new Date() }).where(eq(productionBatches.id, batch.id));
    await tx.update(productionBatchItems).set({ isPilot: false, waveNumber: 0, status: 'pending', updatedAt: new Date() }).where(eq(productionBatchItems.productionBatchId, batch.id));
    for (const row of rows) {
      if (pilotIds.has(row.item.id)) await tx.update(productionBatchItems).set({ isPilot: true, status: 'pilot', updatedAt: new Date() }).where(eq(productionBatchItems.id, row.item.id));
    }
    await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.SELECT_BATCH_PILOTS });
  });
  return { pilotItemIds: [...pilotIds], riskOrder: sorted.map((row) => ({ itemId: row.item.id, catalogItemId: row.catalogItem.id, riskScore: riskScore(row.catalogItem, row.visualAssetCount, row.referenceCount) })) };
}

export async function createPilotCampaigns(input: { teamId: number; userId: number; batchId: number }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  assertBulkProductionAction(batch.generationMode, 'Pilot Campaign creation');
  if (!['calibrating', 'pilot_review'].includes(batch.status)) throw new Error('Pilot Campaigns require a calibrating Batch.');
  const rows = await getBatchItemsWithCatalog(input.teamId, input.batchId);
  const pilots = rows.filter((row) => row.item.isPilot);
  if (pilots.length === 0) throw new Error('Select Pilot SKU before creating Pilot Campaigns.');
  const results = [];
  for (const row of pilots) {
    results.push(await ensureProductionBatchItemCampaign({
      teamId: input.teamId,
      userId: input.userId,
      batchId: input.batchId,
      itemId: row.item.id,
    }));
  }
  return { campaignIds: results.map((result) => result.campaignId), results };
}


export async function evaluateProductionBatchPilot(input: { teamId: number; userId: number; batchId: number }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  assertBulkProductionAction(batch.generationMode, 'Pilot evaluation');
  const pilotItems = await db.select().from(productionBatchItems).where(and(
    eq(productionBatchItems.teamId, input.teamId),
    eq(productionBatchItems.productionBatchId, input.batchId),
    eq(productionBatchItems.isPilot, true),
  ));
  const pilotIds = pilotItems.map((item) => item.id);
  const pilotJobs = pilotIds.length === 0 ? [] : await db.select().from(videoJobs).where(and(
    eq(videoJobs.teamId, input.teamId),
    inArray(videoJobs.productionBatchItemId, pilotIds),
  )).orderBy(asc(videoJobs.createdAt));
  const latestByItem = new Map<number, (typeof pilotJobs)[number]>();
  for (const job of pilotJobs) {
    if (job.productionBatchItemId !== null) latestByItem.set(job.productionBatchItemId, job);
  }
  const latestJobs = [...latestByItem.values()];
  const pilotReviews = latestJobs.length === 0 ? [] : await db.select().from(reviews).where(and(
    eq(reviews.teamId, input.teamId),
    inArray(reviews.videoJobId, latestJobs.map((job) => job.id)),
  ));
  const adopted = new Set(pilotReviews.filter((review) => review.decision === 'adopted').map((review) => review.videoJobId)).size;
  const unresolvedFidelity = pilotReviews.filter((review) => review.decision === 'not_adopted' && review.qualityFailureCause === 'fidelity').length;
  const allItems = batch.sourceMode === 'uploaded_images'
    ? await db.select().from(productionBatchItems).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId)))
    : (await getBatchItemsWithCatalog(input.teamId, input.batchId)).map((row) => row.item);
  const requiredPilotAdoptions = batch.sourceMode === 'uploaded_images' ? Math.min(2, pilotItems.length) : 2;
  const result = batch.sourceMode === 'uploaded_images'
    ? {
        passed: allItems.length > 0 && pilotItems.length > 0 && pilotItems.length <= 3 && adopted >= requiredPilotAdoptions && unresolvedFidelity === 0,
        reasons: [
          ...(allItems.length === 0 ? ['batch must contain at least one image'] : []),
          ...(pilotItems.length === 0 || pilotItems.length > 3 ? ['Pilot must contain one to three images'] : []),
          ...(adopted < requiredPilotAdoptions ? [`at least ${requiredPilotAdoptions} Pilot image${requiredPilotAdoptions === 1 ? '' : 's'} must be adopted`] : []),
          ...(unresolvedFidelity > 0 ? ['unresolved product-fidelity failures block release'] : []),
        ],
      }
    : evaluatePilotGate({ batchSkuCount: allItems.length, pilotSkuCount: pilotItems.length, adoptedPilotSkuCount: adopted, unresolvedProductFidelityFailures: unresolvedFidelity });
  let status = batch.status;
  await db.transaction(async (tx) => {
    const transitions: Array<{ from: string; to: string }> = [];
    const advance = async (next: typeof batch.status) => {
      if (status === next) return;
      const from = status;
      assertContractTransition('production_batch', from, next);
      await tx.update(productionBatches).set({ status: next, updatedAt: new Date() }).where(eq(productionBatches.id, batch.id));
      transitions.push({ from, to: next });
      status = next;
    };
    if (status === 'calibrating') await advance('pilot_review');
    if (result.passed) {
      if (status === 'paused') throw new Error('Resume the Batch before accepting the Pilot gate.');
      if (status === 'pilot_review') await advance('ready');
      const allTerminal = allItems.every((item) => ['completed', 'review', 'excluded'].includes(item.status));
      if (allTerminal && allItems.every((item) => item.isPilot)) {
        if (status === 'ready') await advance('producing');
        if (status === 'producing') await advance('reviewing');
        if (status === 'reviewing') await advance('completed');
      }
    }
    if (transitions.some((transition) => transition.to === 'ready')) {
      await tx.insert(activityLogs).values({
        teamId: input.teamId,
        userId: input.userId,
        action: ActivityType.RELEASE_BULK_PILOT,
        metadata: {
          productionBatchId: input.batchId,
          adoptedPilotSkuCount: adopted,
          pilotSkuCount: pilotItems.length,
          unresolvedProductFidelityFailures: unresolvedFidelity,
          transitions,
        },
      });
    }
  });
  return { ...result, adoptedPilotSkuCount: adopted, unresolvedProductFidelityFailures: unresolvedFidelity, status };
}

export async function assignProductionBatchWaves(input: { teamId: number; batchId: number }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  assertBulkProductionAction(batch.generationMode, 'Wave assignment');
  if (batch.status !== 'ready') throw new Error('Pilot must pass before assigning production Waves.');
  if (!batch.costConfirmation || !batch.specHash) throw new Error('Batch cost must be confirmed before assigning Waves.');
  const estimate = await estimateProductionBatchCost(input);
  const confirmation: unknown = jsonRecord(batch.costConfirmation);
  if (!isCostConfirmationValid(estimate, confirmation)) throw staleCostConfirmationError(estimate, confirmation);
  const rows = (await getBatchItemsWithCatalog(input.teamId, input.batchId)).filter((row) => !row.item.isPilot && row.item.status === 'pending').sort((a, b) => riskScore(b.catalogItem, b.visualAssetCount, b.referenceCount) - riskScore(a.catalogItem, a.visualAssetCount, a.referenceCount) || a.catalogItem.id - b.catalogItem.id);
  await db.transaction(async (tx) => {
    for (const [index, row] of rows.entries()) await tx.update(productionBatchItems).set({ waveNumber: Math.floor(index / batch.waveSize) + 1, status: 'ready', updatedAt: new Date() }).where(eq(productionBatchItems.id, row.item.id));
  });
  return { assigned: rows.length, waveCount: rows.length === 0 ? 0 : Math.ceil(rows.length / batch.waveSize) };
}

export async function scheduleSingleJob(input: {
  teamId: number;
  userId: number;
  batchId: number;
}) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (batch.generationMode !== 'single') throw new Error('Single scheduling is only available for Single production.');
  if (batch.status !== 'ready_to_generate') throw new Error('Single production is not ready to generate.');
  const estimate = await estimateProductionBatchCost(input);
  if (!batch.costConfirmation || !isCostConfirmationValid(estimate, jsonRecord(batch.costConfirmation))) {
    throw staleCostConfirmationError(estimate, batch.costConfirmation ? jsonRecord(batch.costConfirmation) : null);
  }
  const active = await db.select({ value: count() }).from(videoJobs).where(and(
    eq(videoJobs.teamId, input.teamId),
    sql`${videoJobs.status} IN ('queued', 'generating')`,
  ));
  if (Number(active[0]?.value ?? 0) >= MAX_WORKSPACE_CONCURRENCY) {
    throw new Error('Workspace video concurrency limit reached.');
  }
  const rows = await getBatchItemsWithCatalog(input.teamId, input.batchId);
  if (rows.length !== 1) throw new Error('Single production requires exactly one Production Batch item.');
  const row = rows[0];
  const campaignId = row.item.campaignId;
  const creativeSpecVersionId = row.item.creativeSpecVersionId;
  if (!campaignId || !creativeSpecVersionId) {
    throw new Error(`Single item ${row.catalogItem.externalSku} needs an approved Creative Spec.`);
  }
  assertProductionBatchModeTransition('single', batch.status, 'generating');
  const jobId = await db.transaction(async (tx) => {
    const context = await tx.select({
      campaign: campaigns,
      brandKit: brandKits,
      shotCard: shotCards,
      skill: shotSkills,
      skillVersion: shotSkillVersions,
      spec: creativeSpecVersions,
    }).from(campaigns)
      .innerJoin(brandKits, eq(campaigns.brandKitId, brandKits.id))
      .innerJoin(shotCards, eq(shotCards.campaignId, campaigns.id))
      .innerJoin(shotSkillVersions, eq(shotCards.shotSkillVersionId, shotSkillVersions.id))
      .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
      .innerJoin(creativeSpecVersions, eq(creativeSpecVersions.id, creativeSpecVersionId))
      .where(and(
        eq(campaigns.id, campaignId),
        eq(campaigns.teamId, input.teamId),
        eq(shotCards.status, 'selected'),
        eq(creativeSpecVersions.status, 'approved'),
        or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
      )).limit(1);
    const contextRow = context[0];
    if (!contextRow) throw new Error(`Single item ${row.catalogItem.externalSku} is missing an approved Campaign setup.`);
    const existing = await tx.select({ id: videoJobs.id }).from(videoJobs).where(and(
      eq(videoJobs.campaignId, campaignId),
      sql`${videoJobs.status} IN ('queued', 'generating')`,
    )).limit(1);
    if (existing[0]) return existing[0].id;
    if (!contextRow.shotCard.skillSelectionReason) {
      throw new Error(`Single item ${row.catalogItem.externalSku} has no persisted Shot Skill binding.`);
    }
    const definition = shotSkillCardSchema.parse(contextRow.skillVersion.normalizedDefinition);
    const recipe = compileApprovedSpecRecipe({
      specSnapshot: contextRow.spec.specSnapshot,
      shotSkillVersionId: contextRow.skillVersion.id,
      skill: definition,
      selectionReason: contextRow.shotCard.skillSelectionReason,
    });
    if (
      recipe.skill.id !== contextRow.skill.stableId
      || recipe.skill.version !== contextRow.skillVersion.version
      || recipe.skill.hash !== contextRow.skillVersion.definitionHash
    ) {
      throw new Error('Bound Shot Skill metadata does not match the compiled Recipe.');
    }
    if (!row.catalogItem.primaryAssetId) throw new Error(`Single item ${row.catalogItem.externalSku} has no primary image.`);
    const inserted = await tx.insert(videoJobs).values({
      productionBatchItemId: row.item.id,
      inputAssetId: row.catalogItem.primaryAssetId,
      teamId: input.teamId,
      campaignId,
      creativeSpecVersionId,
      shotCardId: contextRow.shotCard.id,
      submittedBy: input.userId,
      provider: getConfiguredVideoProvider(),
      shotSkillId: contextRow.skill.stableId,
      shotSkillVersionId: contextRow.skillVersion.id,
      shotSkillVersion: contextRow.skillVersion.version,
      shotSkillHash: contextRow.skillVersion.definitionHash,
      recipeSnapshot: JSON.stringify(recipe),
      status: 'queued',
    }).returning({ id: videoJobs.id });
    if (!inserted[0]) throw new Error('Single VideoJob could not be created.');
    await tx.update(productionBatchItems).set({
      status: 'queued',
      updatedAt: new Date(),
    }).where(eq(productionBatchItems.id, row.item.id));
    await tx.update(productionBatches).set({
      status: 'generating',
      updatedAt: new Date(),
    }).where(eq(productionBatches.id, batch.id));
    await tx.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.SUBMIT_VIDEO_JOB,
    });
    return inserted[0].id;
  });
  await enqueueVideoSubmission(jobId);
  return { queued: 1, videoJobId: jobId };
}

export async function scheduleNextProductionWave(input: { teamId: number; userId: number; batchId: number }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  assertBulkProductionAction(batch.generationMode, 'Wave scheduling');
  if (!['ready', 'producing'].includes(batch.status)) throw new Error('Batch is not ready to schedule a Wave.');
  const estimate = await estimateProductionBatchCost(input);
  if (!batch.costConfirmation || !isCostConfirmationValid(estimate, jsonRecord(batch.costConfirmation))) throw staleCostConfirmationError(estimate, batch.costConfirmation ? jsonRecord(batch.costConfirmation) : null);
  const active = await db.select({ value: count() }).from(videoJobs).where(and(eq(videoJobs.teamId, input.teamId), sql`${videoJobs.status} IN ('queued', 'generating')`));
  const activeCount = Number(active[0]?.value ?? 0);
  if (activeCount >= MAX_WORKSPACE_CONCURRENCY) throw new Error('Workspace video concurrency limit reached.');
  const rows = await getBatchItemsWithCatalog(input.teamId, input.batchId);
  const waveNumbers = rows.filter((row) => !row.item.isPilot && row.item.status === 'ready').map((row) => row.item.waveNumber);
  const nextWave = Math.min(...waveNumbers);
  if (!Number.isFinite(nextWave)) return { waveNumber: null, queued: 0 };
  const candidates = rows.filter((row) => !row.item.isPilot && row.item.status === 'ready' && row.item.waveNumber === nextWave).slice(0, Math.max(0, MAX_WORKSPACE_CONCURRENCY - activeCount));
  const jobIds = await db.transaction(async (tx) => {
    const ids: number[] = [];
    for (const row of candidates) {
      if (!row.item.campaignId || !row.item.creativeSpecVersionId) throw new Error(`Wave item ${row.catalogItem.externalSku} needs an approved Creative Spec.`);
      const context = await tx.select({
        campaign: campaigns,
        brandKit: brandKits,
        shotCard: shotCards,
        skill: shotSkills,
        skillVersion: shotSkillVersions,
        spec: creativeSpecVersions,
      }).from(campaigns)
        .innerJoin(brandKits, eq(campaigns.brandKitId, brandKits.id))
        .innerJoin(shotCards, eq(shotCards.campaignId, campaigns.id))
        .innerJoin(shotSkillVersions, eq(shotCards.shotSkillVersionId, shotSkillVersions.id))
        .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
        .innerJoin(creativeSpecVersions, eq(creativeSpecVersions.id, row.item.creativeSpecVersionId))
        .where(and(
          eq(campaigns.id, row.item.campaignId),
          eq(campaigns.teamId, input.teamId),
          eq(shotCards.status, 'selected'),
          eq(creativeSpecVersions.status, 'approved'),
          or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
        )).limit(1);
      const contextRow = context[0];
      if (!contextRow) throw new Error(`Wave item ${row.catalogItem.externalSku} is missing an approved Campaign setup.`);
      const existing = await tx.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.campaignId, row.item.campaignId), sql`${videoJobs.status} IN ('queued', 'generating')`)).limit(1);
      if (existing[0]) continue;
      if (!contextRow.shotCard.skillSelectionReason) {
        throw new Error(`Wave item ${row.catalogItem.externalSku} has no persisted Shot Skill binding.`);
      }
      const definition = shotSkillCardSchema.parse(contextRow.skillVersion.normalizedDefinition);
      const recipe = compileApprovedSpecRecipe({
        specSnapshot: contextRow.spec.specSnapshot,
        shotSkillVersionId: contextRow.skillVersion.id,
        skill: definition,
        selectionReason: contextRow.shotCard.skillSelectionReason,
      });
      if (
        recipe.skill.id !== contextRow.skill.stableId
        || recipe.skill.version !== contextRow.skillVersion.version
        || recipe.skill.hash !== contextRow.skillVersion.definitionHash
      ) {
        throw new Error('Bound Shot Skill metadata does not match the compiled Recipe.');
      }
      const inserted = await tx.insert(videoJobs).values({ productionBatchItemId: row.item.id, inputAssetId: row.catalogItem.primaryAssetId, teamId: input.teamId, campaignId: row.item.campaignId, creativeSpecVersionId: row.item.creativeSpecVersionId, shotCardId: contextRow.shotCard.id, submittedBy: input.userId, provider: getConfiguredVideoProvider(), shotSkillId: contextRow.skill.stableId, shotSkillVersionId: contextRow.skillVersion.id, shotSkillVersion: contextRow.skillVersion.version, shotSkillHash: contextRow.skillVersion.definitionHash, recipeSnapshot: JSON.stringify(recipe), status: 'queued' }).returning({ id: videoJobs.id });
      if (!row.catalogItem.primaryAssetId) throw new Error(`Wave item ${row.catalogItem.externalSku} has no primary image.`);
      if (!inserted[0]) throw new Error('VideoJob could not be created.');
      await tx.update(productionBatchItems).set({ status: 'queued', updatedAt: new Date() }).where(eq(productionBatchItems.id, row.item.id));
      ids.push(inserted[0].id);
    }
    if (batch.status === 'ready') await tx.update(productionBatches).set({ status: 'producing', updatedAt: new Date() }).where(eq(productionBatches.id, batch.id));
    await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.SUBMIT_VIDEO_JOB });
    if (ids.length > 0) await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.SCHEDULE_BATCH_WAVE });
    return ids;
  });
  for (const jobId of jobIds) await enqueueVideoSubmission(jobId);
  return { waveNumber: nextWave, queued: jobIds.length };
}

export async function observeProductionBatchWave(input: { teamId: number; userId: number; batchId: number; data: unknown }) {
  const parsed = observeWaveInputSchema.parse(input.data);
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  assertBulkProductionAction(batch.generationMode, 'Wave observation');
  const { waveNumber, ...observation } = parsed;
  const reasons = getWaveStopReasons({ ...observation, waveSize: batch.waveSize });
  const config = { ...jsonRecord(batch.stopLossConfig), lastObservation: parsed, lastStopReasons: reasons };
  const itemStatuses = await db.select({ status: productionBatchItems.status }).from(productionBatchItems).where(and(
    eq(productionBatchItems.teamId, input.teamId),
    eq(productionBatchItems.productionBatchId, input.batchId),
  ));
  const allTerminal = itemStatuses.length > 0 && itemStatuses.every((item) => ['completed', 'excluded'].includes(item.status));
  let status = batch.status;
  await db.transaction(async (tx) => {
    if (reasons.length > 0) {
      if (batch.status !== 'paused') assertContractTransition('production_batch', batch.status, 'paused');
      await tx.update(productionBatches).set({
        status: 'paused',
        pausedFromStatus: batch.status === 'paused' ? batch.pausedFromStatus : batch.status,
        pausedReason: reasons.join('; '),
        stopLossConfig: JSON.stringify(config),
        updatedAt: new Date(),
      }).where(eq(productionBatches.id, batch.id));
      if (batch.status !== 'paused') {
        await tx.insert(activityLogs).values({
          teamId: input.teamId,
          userId: input.userId,
          action: ActivityType.PAUSE_PRODUCTION_BATCH,
          metadata: { productionBatchId: batch.id, fromStatus: batch.status, toStatus: 'paused', generationMode: batch.generationMode, source: 'stop_loss', reasons },
        });
      }
      status = 'paused';
      return;
    }
    if (allTerminal && (batch.status === 'producing' || batch.status === 'reviewing')) {
      if (batch.status === 'producing') assertContractTransition('production_batch', 'producing', 'reviewing');
      assertContractTransition('production_batch', 'reviewing', 'completed');
      await tx.update(productionBatches).set({
        status: 'completed',
        stopLossConfig: JSON.stringify(config),
        updatedAt: new Date(),
      }).where(eq(productionBatches.id, batch.id));
      await tx.insert(activityLogs).values({
        teamId: input.teamId,
        userId: input.userId,
        action: ActivityType.COMPLETE_PRODUCTION_BATCH,
        metadata: { productionBatchId: batch.id, fromStatus: batch.status, toStatus: 'completed', generationMode: batch.generationMode, source: 'wave_observation' },
      });
      status = 'completed';
      return;
    }
    await tx.update(productionBatches).set({ stopLossConfig: JSON.stringify(config), updatedAt: new Date() }).where(eq(productionBatches.id, batch.id));
  });
  return { waveNumber, reasons, paused: reasons.length > 0, completed: status === 'completed', status };
}

export async function schedulePilotJobs(input: { teamId: number; userId: number; batchId: number }) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  assertBulkProductionAction(batch.generationMode, 'Pilot scheduling');
  if (!['calibrating', 'pilot_review'].includes(batch.status)) throw new Error('Pilot jobs require a calibrating Batch.');
  const estimate = await estimateProductionBatchCost(input);
  if (!batch.costConfirmation || !isCostConfirmationValid(estimate, jsonRecord(batch.costConfirmation))) throw staleCostConfirmationError(estimate, batch.costConfirmation ? jsonRecord(batch.costConfirmation) : null);
  const active = await db.select({ value: count() }).from(videoJobs).where(and(eq(videoJobs.teamId, input.teamId), sql`${videoJobs.status} IN ('queued', 'generating')`));
  const activeCount = Number(active[0]?.value ?? 0);
  if (activeCount >= MAX_WORKSPACE_CONCURRENCY) throw new Error('Workspace video concurrency limit reached.');
  const rows = (await getBatchItemsWithCatalog(input.teamId, input.batchId)).filter((row) => row.item.isPilot && row.item.status === 'pilot');
  const candidates = rows.slice(0, Math.max(0, MAX_WORKSPACE_CONCURRENCY - activeCount));
  const jobIds = await db.transaction(async (tx) => {
    const ids: number[] = [];
    for (const row of candidates) {
      if (!row.item.campaignId || !row.item.creativeSpecVersionId) throw new Error(`Pilot ${row.catalogItem.externalSku} needs a Campaign and approved Creative Spec.`);
      const context = await tx.select({
        campaign: campaigns,
        brandKit: brandKits,
        shotCard: shotCards,
        skill: shotSkills,
        skillVersion: shotSkillVersions,
        spec: creativeSpecVersions,
      }).from(campaigns)
        .innerJoin(brandKits, eq(campaigns.brandKitId, brandKits.id))
        .innerJoin(shotCards, eq(shotCards.campaignId, campaigns.id))
        .innerJoin(shotSkillVersions, eq(shotCards.shotSkillVersionId, shotSkillVersions.id))
        .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
        .innerJoin(creativeSpecVersions, eq(creativeSpecVersions.id, row.item.creativeSpecVersionId))
        .where(and(
          eq(campaigns.id, row.item.campaignId),
          eq(campaigns.teamId, input.teamId),
          eq(shotCards.status, 'selected'),
          eq(creativeSpecVersions.status, 'approved'),
          or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
        )).limit(1);
      const contextRow = context[0];
      if (!contextRow) throw new Error(`Pilot ${row.catalogItem.externalSku} is missing an approved Campaign setup.`);
      const existing = await tx.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.campaignId, row.item.campaignId), sql`${videoJobs.status} IN ('queued', 'generating')`)).limit(1);
      if (existing[0]) continue;
      if (!contextRow.shotCard.skillSelectionReason) {
        throw new Error(`Pilot ${row.catalogItem.externalSku} has no persisted Shot Skill binding.`);
      }
      const definition = shotSkillCardSchema.parse(contextRow.skillVersion.normalizedDefinition);
      const recipe = compileApprovedSpecRecipe({
        specSnapshot: contextRow.spec.specSnapshot,
        shotSkillVersionId: contextRow.skillVersion.id,
        skill: definition,
        selectionReason: contextRow.shotCard.skillSelectionReason,
      });
      if (
        recipe.skill.id !== contextRow.skill.stableId
        || recipe.skill.version !== contextRow.skillVersion.version
        || recipe.skill.hash !== contextRow.skillVersion.definitionHash
      ) {
        throw new Error('Bound Shot Skill metadata does not match the compiled Recipe.');
      }
      if (!row.catalogItem.primaryAssetId) throw new Error(`Pilot ${row.catalogItem.externalSku} has no primary image.`);
      const inserted = await tx.insert(videoJobs).values({ productionBatchItemId: row.item.id, inputAssetId: row.catalogItem.primaryAssetId, teamId: input.teamId, campaignId: row.item.campaignId, creativeSpecVersionId: row.item.creativeSpecVersionId, shotCardId: contextRow.shotCard.id, submittedBy: input.userId, provider: getConfiguredVideoProvider(), shotSkillId: contextRow.skill.stableId, shotSkillVersionId: contextRow.skillVersion.id, shotSkillVersion: contextRow.skillVersion.version, shotSkillHash: contextRow.skillVersion.definitionHash, recipeSnapshot: JSON.stringify(recipe), status: 'queued' }).returning({ id: videoJobs.id });
      if (!inserted[0]) throw new Error('Pilot VideoJob could not be created.');
      await tx.update(productionBatchItems).set({ status: 'queued', updatedAt: new Date() }).where(eq(productionBatchItems.id, row.item.id));
      ids.push(inserted[0].id);
    }
    if (ids.length > 0) await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.SUBMIT_VIDEO_JOB });
    return ids;
  });
  for (const jobId of jobIds) await enqueueVideoSubmission(jobId);
  return { queued: jobIds.length };
}

export async function changeProductionBatchStatus(input: {
  teamId: number;
  userId: number;
  batchId: number;
  status: 'pause' | 'resume' | 'cancel';
}) {
  const batch = await getBatchOrThrow(input.teamId, input.batchId);
  if (input.status === 'pause') {
    if (!pausableStatusesByMode[batch.generationMode].has(batch.status)) {
      throw new Error(`${batch.status} cannot be paused for ${batch.generationMode} production.`);
    }
    assertProductionBatchModeTransition(batch.generationMode, batch.status, 'paused');
    await db.update(productionBatches).set({
      status: 'paused',
      pausedFromStatus: batch.status,
      pausedReason: 'Paused by Workspace operator.',
      updatedAt: new Date(),
    }).where(eq(productionBatches.id, batch.id));
    await db.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.PAUSE_PRODUCTION_BATCH,
      metadata: { productionBatchId: batch.id, fromStatus: batch.status, toStatus: 'paused', generationMode: batch.generationMode },
    });
  } else if (input.status === 'resume') {
    const resumeStatus = getPausedResumeStatus({
      mode: batch.generationMode,
      currentStatus: batch.status,
      pausedFromStatus: batch.pausedFromStatus,
    });
    await db.update(productionBatches).set({
      status: resumeStatus,
      pausedFromStatus: null,
      pausedReason: null,
      updatedAt: new Date(),
    }).where(eq(productionBatches.id, batch.id));
    await db.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.RESUME_PRODUCTION_BATCH,
      metadata: { productionBatchId: batch.id, fromStatus: 'paused', toStatus: resumeStatus, generationMode: batch.generationMode },
    });
  } else {
    assertProductionBatchModeTransition(batch.generationMode, batch.status, 'cancelled');
    await db.transaction(async (tx) => {
      const batchItems = await tx.select({ id: productionBatchItems.id }).from(productionBatchItems).where(and(
        eq(productionBatchItems.teamId, input.teamId),
        eq(productionBatchItems.productionBatchId, batch.id),
      ));
      const batchItemIds = batchItems.map((item) => item.id);
      if (batchItemIds.length) {
        await tx.update(videoJobs).set({ status: 'failed', failureCode: 'batch_cancelled', failureReason: 'Production Batch was cancelled.', completedAt: new Date(), updatedAt: new Date() }).where(and(
          eq(videoJobs.teamId, input.teamId),
          inArray(videoJobs.productionBatchItemId, batchItemIds),
          eq(videoJobs.status, 'queued'),
        ));
      }
      await tx.update(productionBatchItems).set({
        status: 'excluded',
        updatedAt: new Date(),
      }).where(and(
        eq(productionBatchItems.teamId, input.teamId),
        eq(productionBatchItems.productionBatchId, batch.id),
        inArray(productionBatchItems.status, ['pending', 'pilot', 'ready', 'queued']),
      ));
      await tx.update(productionBatches).set({
        status: 'cancelled',
        pausedFromStatus: null,
        updatedAt: new Date(),
      }).where(eq(productionBatches.id, batch.id));
      await tx.insert(activityLogs).values({
        teamId: input.teamId,
        userId: input.userId,
        action: ActivityType.CANCEL_PRODUCTION_BATCH,
        metadata: { productionBatchId: batch.id, fromStatus: batch.status, toStatus: 'cancelled', generationMode: batch.generationMode },
      });
    });
  }
  return getBatchOrThrow(input.teamId, input.batchId);
}

export async function getProductionBatchProgress(teamId: number, batchId: number) {
  const batch = await getBatchOrThrow(teamId, batchId);
  if (batch.sourceMode === 'uploaded_images') {
    const items = await db.select().from(productionBatchItems).where(and(
      eq(productionBatchItems.teamId, teamId),
      eq(productionBatchItems.productionBatchId, batchId),
    )).orderBy(asc(productionBatchItems.sequence), asc(productionBatchItems.id));
    const itemIds = items.map((item) => item.id);
    const imageJobs = itemIds.length === 0 ? [] : await db.select().from(videoJobs).where(and(
      eq(videoJobs.teamId, teamId),
      inArray(videoJobs.productionBatchItemId, itemIds),
    ));
    const imageReviews = imageJobs.length === 0 ? [] : await db.select().from(reviews).where(and(
      eq(reviews.teamId, teamId),
      inArray(reviews.videoJobId, imageJobs.map((job) => job.id)),
    ));
    const jobsByItem = new Map<number, typeof imageJobs>();
    for (const job of imageJobs) {
      if (job.productionBatchItemId === null) continue;
      jobsByItem.set(job.productionBatchItemId, [...(jobsByItem.get(job.productionBatchItemId) ?? []), job]);
    }
    const counts = { total: items.length, pending: 0, pilot: 0, ready: 0, queued: 0, generating: 0, qualityReview: 0, completed: 0, failed: 0, excluded: 0 };
    for (const item of items) {
      const latestJob = jobsByItem.get(item.id)?.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
      if (item.isPilot && !latestJob) counts.pilot += 1;
      if (!latestJob && item.status === 'pending') counts.pending += 1;
      if (!latestJob && item.status === 'ready') counts.ready += 1;
      if (item.status === 'excluded') counts.excluded += 1;
      else if (item.status === 'completed') counts.completed += 1;
      else if (latestJob?.status === 'queued') counts.queued += 1;
      else if (latestJob?.status === 'generating') counts.generating += 1;
      else if (latestJob?.status === 'succeeded') counts.qualityReview += 1;
      else if (latestJob?.status === 'failed' || item.status === 'failed') counts.failed += 1;
    }
    const durations = imageJobs.filter((job) => job.completedAt).map((job) => (job.completedAt!.getTime() - job.createdAt.getTime()) / 1000);
    return {
      counts,
      metrics: {
        retryCount: imageJobs.reduce((sum, job) => sum + Math.max(0, job.attempts - 1), 0),
        supplierErrorCount: imageJobs.filter((job) => job.failureCode === 'supplier_error').length,
        actualCostCny: imageJobs.reduce((sum, job) => sum + Number(job.actualCostCny ?? 0), 0),
        averageCompletionSeconds: durations.length === 0 ? 0 : durations.reduce((sum, value) => sum + value, 0) / durations.length,
      },
      singleSummary: null,
      items: items.map((item) => ({ ...item, externalSku: `IMAGE-${item.sequence}`, riskScore: 0 })),
    };
  }
  const rows = await getBatchItemsWithCatalog(teamId, batchId);
  const campaignIds = rows.map((row) => row.item.campaignId).filter((id): id is number => id !== null);
  const jobs = campaignIds.length === 0
    ? []
    : await db.select().from(videoJobs).where(and(eq(videoJobs.teamId, teamId), inArray(videoJobs.campaignId, campaignIds)));
  const jobReviews = jobs.length === 0
    ? []
    : await db.select().from(reviews).where(and(eq(reviews.teamId, teamId), inArray(reviews.videoJobId, jobs.map((job) => job.id))));
  const reviewByJobId = new Map(jobReviews.map((review) => [review.videoJobId, review]));
  const latestJob = [...jobs].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  const counts = { total: rows.length, pending: 0, pilot: 0, ready: 0, queued: 0, generating: 0, qualityReview: 0, completed: 0, failed: 0, excluded: 0 };
  for (const row of rows) {
    if (row.item.isPilot) counts.pilot += 1;
    if (row.item.status === 'pending') counts.pending += 1;
    if (row.item.status === 'ready') counts.ready += 1;
    if (row.item.status === 'excluded') counts.excluded += 1;
    if (row.item.status === 'failed') counts.failed += 1;
  }
  for (const job of jobs) {
    if (job.status === 'queued') counts.queued += 1;
    if (job.status === 'generating') counts.generating += 1;
    if (job.status === 'succeeded') counts.qualityReview += 1;
    if (job.status === 'failed') counts.failed += 1;
  }
  counts.completed = rows.filter((row) => row.item.status === 'completed').length;
  const completedDurations = jobs.filter((job) => job.completedAt).map((job) => (job.completedAt!.getTime() - job.createdAt.getTime()) / 1000);
  const latestReview = latestJob ? reviewByJobId.get(latestJob.id) : undefined;
  return {
    counts,
    metrics: {
      retryCount: jobs.reduce((sum, job) => sum + Math.max(0, job.attempts - 1), 0),
      supplierErrorCount: jobs.filter((job) => job.failureCode === 'supplier_error').length,
      actualCostCny: jobs.reduce((sum, job) => sum + Number(job.actualCostCny ?? 0), 0),
      averageCompletionSeconds: completedDurations.length === 0 ? 0 : completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length,
    },
    singleSummary: batch.generationMode === 'single' ? {
      videoJobId: latestJob?.id ?? null,
      videoJobStatus: latestJob?.status ?? null,
      completedAt: latestJob?.completedAt ?? null,
      outputAssetId: latestJob?.outputAssetId ?? null,
      actualCostCny: latestJob ? Number(latestJob.actualCostCny ?? 0) : 0,
      attempts: latestJob?.attempts ?? 0,
      review: latestReview ? {
        decision: latestReview.decision,
        reason: latestReview.reason,
        qualityFailureCause: latestReview.qualityFailureCause,
        reviewedAt: latestReview.createdAt,
      } : null,
    } : null,
    items: rows.map((row) => ({ ...row.item, externalSku: row.catalogItem.externalSku, riskScore: riskScore(row.catalogItem, row.visualAssetCount, row.referenceCount) })),
  };
}

export { createBatchInputSchema, observeWaveInputSchema };
