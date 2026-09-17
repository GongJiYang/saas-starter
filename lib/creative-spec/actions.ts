import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  ActivityType,
  activityLogs,
  brandKits,
  campaigns,
  catalogItems,
  creativeSpecVersions,
  productionBatchItems,
  productionBatches,
  referenceAnalyses,
  shotCards,
  shotSkills,
  shotSkillVersions,
} from '@/lib/db/schema';
import { assertContractTransition, remediationRequestSchema } from '@/lib/bulk/contracts';
import { assertProductionBatchModeTransition } from '@/lib/production-batches/state';
import {
  compileProductBrief,
  compileSpecEnvelope,
  hashSpecEnvelope,
  rankEligibleAngles,
  specEnvelopeSchema,
} from './compiler';

function nextVersion(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) throw new Error('Invalid Spec version.');
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

async function loadDependencies(input: {
  teamId: number;
  campaignId: number;
  catalogItemId: number;
  referenceAnalysisId?: number;
}) {
  const campaign = await db.select().from(campaigns).where(and(eq(campaigns.teamId, input.teamId), eq(campaigns.id, input.campaignId))).limit(1);
  const catalogItem = await db.select().from(catalogItems).where(and(eq(catalogItems.teamId, input.teamId), eq(catalogItems.id, input.catalogItemId))).limit(1);
  if (!campaign[0] || !catalogItem[0]) throw new Error('Campaign or CatalogItem does not belong to the current workspace.');
  if (catalogItem[0].readinessStatus !== 'ready') throw new Error('Only ready CatalogItems can create a Creative Spec.');
  const brandKit = await db.select().from(brandKits).where(and(eq(brandKits.teamId, input.teamId), eq(brandKits.id, campaign[0].brandKitId))).limit(1);
  if (!brandKit[0]) throw new Error('Campaign Brand Kit does not belong to the current workspace.');
  let referenceAnalysis: typeof referenceAnalyses.$inferSelect | null = null;
  if (input.referenceAnalysisId) {
    const analysis = await db.select().from(referenceAnalyses).where(and(
      eq(referenceAnalyses.teamId, input.teamId),
      eq(referenceAnalyses.id, input.referenceAnalysisId),
      eq(referenceAnalyses.status, 'approved'),
    )).limit(1);
    if (!analysis[0]) throw new Error('Reference Analysis must be approved before use in a Creative Spec.');
    referenceAnalysis = analysis[0];
  }
  return { campaign: campaign[0], catalogItem: catalogItem[0], brandKit: brandKit[0], referenceAnalysis };
}

async function insertSpec(input: {
  teamId: number;
  userId: number;
  campaignId: number;
  referenceAnalysisId?: number;
  parentVersionId?: number;
  version: string;
  envelope: ReturnType<typeof specEnvelopeSchema.parse>;
  rejectionCode?: string;
  rejectionNote?: string;
}) {
  const inserted = await db.insert(creativeSpecVersions).values({
    teamId: input.teamId,
    campaignId: input.campaignId,
    referenceAnalysisId: input.referenceAnalysisId,
    parentVersionId: input.parentVersionId,
    createdBy: input.userId,
    version: input.version,
    status: 'draft',
    specHash: hashSpecEnvelope(input.envelope),
    specSnapshot: JSON.stringify(input.envelope),
    rejectionCode: input.rejectionCode,
    rejectionNote: input.rejectionNote,
  }).returning();
  if (!inserted[0]) throw new Error('Creative Spec could not be saved.');
  return inserted[0];
}

export async function createCreativeSpecDraft(input: {
  teamId: number;
  userId: number;
  campaignId: number;
  catalogItemId: number;
  referenceAnalysisId?: number;
  selectedAngleId?: string;
}) {
  const dependencies = await loadDependencies(input);
  const brief = compileProductBrief({ catalogItem: dependencies.catalogItem, campaign: dependencies.campaign });
  const proposals = rankEligibleAngles(brief);
  const envelope = compileSpecEnvelope({
    brief,
    brandKit: dependencies.brandKit,
    proposals,
    referenceAnalysis: dependencies.referenceAnalysis,
    selectedAngleId: input.selectedAngleId,
  });
  return insertSpec({
    teamId: input.teamId,
    userId: input.userId,
    campaignId: input.campaignId,
    referenceAnalysisId: dependencies.referenceAnalysis?.id,
    version: envelope.creativeSpec.version,
    envelope,
  });
}

export async function submitCreativeSpecForApproval(input: { teamId: number; specVersionId: number }) {
  const current = await getCreativeSpecForTeam(input.teamId, input.specVersionId);
  if (!current) throw new Error('Creative Spec not found.');
  assertContractTransition('creative_spec', current.status, 'awaiting_approval');
  const updated = await db.update(creativeSpecVersions).set({ status: 'awaiting_approval', updatedAt: new Date() })
    .where(and(eq(creativeSpecVersions.teamId, input.teamId), eq(creativeSpecVersions.id, input.specVersionId))).returning();
  return updated[0];
}

export async function approveCreativeSpec(input: { teamId: number; userId: number; specVersionId: number }) {
  return db.transaction(async (transaction) => {
    const current = (await transaction.select().from(creativeSpecVersions).where(and(
      eq(creativeSpecVersions.teamId, input.teamId),
      eq(creativeSpecVersions.id, input.specVersionId),
    )).limit(1).for('update'))[0];
    if (!current) throw new Error('Creative Spec not found.');
    assertContractTransition('creative_spec', current.status, 'approved');

    const items = await transaction.select().from(productionBatchItems).where(and(
      eq(productionBatchItems.teamId, input.teamId),
      eq(productionBatchItems.campaignId, current.campaignId),
    )).limit(2).for('update');
    if (items.length > 1) throw new Error('A Campaign cannot belong to more than one Production Batch item.');
    const item = items[0];
    let binding: {
      productionBatchId: number;
      itemId: number;
      campaignId: number;
      specVersionId: number;
      batchStatus: string;
      nextAction: string;
    } | null = null;
    if (item) {
      const batch = (await transaction.select().from(productionBatches).where(and(
        eq(productionBatches.teamId, input.teamId),
        eq(productionBatches.id, item.productionBatchId),
      )).limit(1).for('update'))[0];
      if (!batch) throw new Error('The Creative Spec Production Batch is not available in this Workspace.');
      if (item.creativeSpecVersionId && item.creativeSpecVersionId !== current.id) {
        const bound = (await transaction.select({ status: creativeSpecVersions.status }).from(creativeSpecVersions).where(and(
          eq(creativeSpecVersions.teamId, input.teamId),
          eq(creativeSpecVersions.id, item.creativeSpecVersionId),
          eq(creativeSpecVersions.campaignId, current.campaignId),
        )).limit(1))[0];
        if (bound?.status === 'approved') {
          throw new Error('This Campaign already has an approved Creative Spec bound to its Production task.');
        }
      }
      let batchStatus = batch.status;
      if (batch.generationMode === 'single') {
        if (batch.status === 'ready_for_spec') {
          assertProductionBatchModeTransition('single', batch.status, 'ready_to_generate');
          batchStatus = 'ready_to_generate';
        } else if (batch.status !== 'ready_to_generate') {
          throw new Error('Single production must be ready for Spec approval before binding.');
        }
      }
      await transaction.update(productionBatchItems).set({
        creativeSpecVersionId: current.id,
        status: batch.generationMode === 'single' ? 'ready' : item.status,
        updatedAt: new Date(),
      }).where(and(
        eq(productionBatchItems.id, item.id),
        eq(productionBatchItems.teamId, input.teamId),
        eq(productionBatchItems.campaignId, current.campaignId),
      ));
      await transaction.update(productionBatches).set({
        status: batchStatus,
        specHash: null,
        maxEstimatedCostCny: null,
        costConfirmation: null,
        costConfirmedAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(productionBatches.id, batch.id),
        eq(productionBatches.teamId, input.teamId),
      ));
      binding = {
        productionBatchId: batch.id,
        itemId: item.id,
        campaignId: current.campaignId,
        specVersionId: current.id,
        batchStatus,
        nextAction: 'Estimate and confirm the updated production cost.',
      };
    }

    const updated = await transaction.update(creativeSpecVersions).set({
      status: 'approved',
      approvedBy: input.userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(creativeSpecVersions.teamId, input.teamId),
      eq(creativeSpecVersions.id, input.specVersionId),
      eq(creativeSpecVersions.status, 'awaiting_approval'),
    )).returning();
    if (!updated[0]) throw new Error('Creative Spec approval changed concurrently. Refresh and try again.');
    await transaction.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.APPROVE_CREATIVE_SPEC,
      metadata: binding ? {
        specVersionId: current.id,
        productionBatchId: binding.productionBatchId,
        productionBatchItemId: binding.itemId,
        generationMode: (await transaction.select({ generationMode: productionBatches.generationMode }).from(productionBatches).where(eq(productionBatches.id, binding.productionBatchId)).limit(1))[0]?.generationMode,
        nextBatchStatus: binding.batchStatus,
      } : { specVersionId: current.id },
    });
    if (binding) {
      await transaction.insert(activityLogs).values({
        teamId: input.teamId,
        userId: input.userId,
        action: ActivityType.BIND_PRODUCTION_BATCH_SPEC,
        metadata: {
          specVersionId: binding.specVersionId,
          productionBatchId: binding.productionBatchId,
          productionBatchItemId: binding.itemId,
          campaignId: binding.campaignId,
          nextBatchStatus: binding.batchStatus,
        },
      });
    }
    return { spec: updated[0], binding };
  });
}

export async function rejectCreativeSpec(input: {
  teamId: number;
  userId: number;
  specVersionId: number;
  rejectionCode: string;
  rejectionNote?: string;
}) {
  const current = await getCreativeSpecForTeam(input.teamId, input.specVersionId);
  if (!current) throw new Error('Creative Spec not found.');
  assertContractTransition('creative_spec', current.status, 'rejected');
  const envelope = specEnvelopeSchema.parse(JSON.parse(current.specSnapshot));
  const next = await db.transaction(async (tx) => {
    await tx.update(creativeSpecVersions).set({
      status: 'rejected',
      rejectionCode: input.rejectionCode,
      rejectionNote: input.rejectionNote,
      updatedAt: new Date(),
    }).where(and(eq(creativeSpecVersions.teamId, input.teamId), eq(creativeSpecVersions.id, input.specVersionId)));
    const successor = await tx.insert(creativeSpecVersions).values({
      teamId: input.teamId,
      campaignId: current.campaignId,
      referenceAnalysisId: current.referenceAnalysisId,
      parentVersionId: current.id,
      createdBy: input.userId,
      version: nextVersion(current.version),
      status: 'draft',
      specHash: hashSpecEnvelope(envelope),
      specSnapshot: JSON.stringify(envelope),
    }).returning();
    return successor[0];
  });
  return next;
}

export async function updateBatchSpecCommonFields(input: {
  teamId: number;
  userId: number;
  productionBatchId: number;
  fields: {
    visualTreatment?: string;
    pacing?: string;
    captionPlan?: string;
    mustShowElements?: string[];
    immutableElements?: string[];
    forbiddenElements?: string[];
  };
}) {
  const items = await db.select({ spec: creativeSpecVersions, item: productionBatchItems })
    .from(productionBatchItems)
    .innerJoin(creativeSpecVersions, eq(productionBatchItems.creativeSpecVersionId, creativeSpecVersions.id))
    .where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.productionBatchId)));
  const created = [];
  for (const item of items) {
    const envelope = specEnvelopeSchema.parse(JSON.parse(item.spec.specSnapshot));
    const nextEnvelope = specEnvelopeSchema.parse({
      ...envelope,
      creativeSpec: { ...envelope.creativeSpec, ...input.fields },
    });
    const createdSpec = await insertSpec({
      teamId: input.teamId,
      userId: input.userId,
      campaignId: item.spec.campaignId,
      referenceAnalysisId: item.spec.referenceAnalysisId ?? undefined,
      parentVersionId: item.spec.id,
      version: nextVersion(item.spec.version),
      envelope: nextEnvelope,
    });
    await db.update(productionBatchItems).set({ creativeSpecVersionId: createdSpec.id, updatedAt: new Date() }).where(and(
      eq(productionBatchItems.teamId, input.teamId),
      eq(productionBatchItems.id, item.item.id),
    ));
    created.push(createdSpec);
  }
  return created;
}

export async function createRemediationSpecVersions(input: {
  teamId: number;
  userId: number;
  productionBatchId: number;
  itemIds: number[];
  request: unknown;
  fields: {
    visualTreatment?: string;
    pacing?: string;
    captionPlan?: string;
    mustShowElements?: string[];
    immutableElements?: string[];
    forbiddenElements?: string[];
  };
}) {
  const request = remediationRequestSchema.parse(input.request);
  const itemIds = [...new Set(input.itemIds)];
  if (itemIds.length < 2 || itemIds.length > 3) throw new Error('A remediation Canary must contain two or three rejected SKU.');
  const batch = await db.select().from(productionBatches).where(and(eq(productionBatches.id, input.productionBatchId), eq(productionBatches.teamId, input.teamId))).limit(1);
  if (!batch[0] || batch[0].status !== 'paused') throw new Error('Remediation Spec versions require a paused Production Batch.');
  const items = await db.select({ spec: creativeSpecVersions, item: productionBatchItems })
    .from(productionBatchItems)
    .innerJoin(creativeSpecVersions, eq(productionBatchItems.creativeSpecVersionId, creativeSpecVersions.id))
    .where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.productionBatchId), inArray(productionBatchItems.id, itemIds)));
  if (items.length !== itemIds.length) throw new Error('Every remediation item must belong to the paused Production Batch and have a current Spec.');
  const created = [];
  for (const item of items) {
    const envelope = specEnvelopeSchema.parse(JSON.parse(item.spec.specSnapshot));
    const nextEnvelope = specEnvelopeSchema.parse({ ...envelope, creativeSpec: { ...envelope.creativeSpec, ...input.fields } });
    created.push(await insertSpec({
      teamId: input.teamId,
      userId: input.userId,
      campaignId: item.spec.campaignId,
      referenceAnalysisId: item.spec.referenceAnalysisId ?? undefined,
      parentVersionId: item.spec.id,
      version: nextVersion(item.spec.version),
      envelope: nextEnvelope,
    }));
  }
  return { cause: request.cause, changedInputField: request.changedInputField, itemIds, specs: created };
}

export async function approveCreativeSpecs(input: { teamId: number; userId: number; specVersionIds: number[] }) {
  const specVersionIds = [...new Set(input.specVersionIds)];
  if (specVersionIds.length === 0) throw new Error('Select at least one Creative Spec.');
  if (specVersionIds.length !== input.specVersionIds.length) throw new Error('Creative Spec selections must be unique.');
  const results: Array<{
    specVersionId: number;
    status: 'approved' | 'failed';
    binding: Awaited<ReturnType<typeof approveCreativeSpec>>['binding'];
    error: string | null;
  }> = [];
  for (const specVersionId of specVersionIds) {
    try {
      const approved = await approveCreativeSpec({
        teamId: input.teamId,
        userId: input.userId,
        specVersionId,
      });
      results.push({ specVersionId, status: 'approved', binding: approved.binding, error: null });
    } catch (error) {
      results.push({
        specVersionId,
        status: 'failed',
        binding: null,
        error: error instanceof Error ? error.message : 'Creative Spec approval failed.',
      });
    }
  }
  return { results };
}

export async function assertApprovedCreativeSpec(teamId: number, specVersionId: number) {
  const spec = await getCreativeSpecForTeam(teamId, specVersionId);
  if (!spec || spec.status !== 'approved') throw new Error('An approved Creative Spec is required before creating a VideoJob.');
  return spec;
}

export async function getCreativeSpecForTeam(teamId: number, specVersionId: number) {
  const result = await db.select().from(creativeSpecVersions).where(and(eq(creativeSpecVersions.teamId, teamId), eq(creativeSpecVersions.id, specVersionId))).limit(1);
  return result[0] ?? null;
}

export async function listCreativeSpecsForTeam(teamId: number) {
  const rows = await db.select({
    spec: creativeSpecVersions,
    campaignName: campaigns.name,
    batchId: productionBatches.id,
    batchName: productionBatches.name,
    batchItemId: productionBatchItems.id,
    externalSku: catalogItems.externalSku,
    productName: catalogItems.productName,
    brandKitName: brandKits.name,
    skillName: shotSkills.name,
    skillStableId: shotSkills.stableId,
    skillVersion: shotSkillVersions.version,
  })
    .from(creativeSpecVersions)
    .innerJoin(campaigns, and(
      eq(campaigns.id, creativeSpecVersions.campaignId),
      eq(campaigns.teamId, teamId),
    ))
    .innerJoin(brandKits, and(
      eq(brandKits.id, campaigns.brandKitId),
      eq(brandKits.teamId, teamId),
    ))
    .leftJoin(productionBatchItems, and(
      eq(productionBatchItems.campaignId, campaigns.id),
      eq(productionBatchItems.teamId, teamId),
    ))
    .leftJoin(productionBatches, and(
      eq(productionBatches.id, productionBatchItems.productionBatchId),
      eq(productionBatches.teamId, teamId),
    ))
    .leftJoin(catalogItems, and(
      eq(catalogItems.id, productionBatchItems.catalogItemId),
      eq(catalogItems.teamId, teamId),
    ))
    .leftJoin(shotCards, and(
      eq(shotCards.campaignId, campaigns.id),
      eq(shotCards.teamId, teamId),
      eq(shotCards.status, 'selected'),
    ))
    .leftJoin(shotSkillVersions, eq(shotSkillVersions.id, shotCards.shotSkillVersionId))
    .leftJoin(shotSkills, eq(shotSkills.id, shotSkillVersions.shotSkillId))
    .where(eq(creativeSpecVersions.teamId, teamId))
    .orderBy(desc(creativeSpecVersions.createdAt));
  return rows.map((row) => ({
    ...row.spec,
    sourceContext: {
      productionBatchId: row.batchId,
      productionBatchName: row.batchName,
      productionBatchItemId: row.batchItemId,
      externalSku: row.externalSku,
      productName: row.productName,
      brandKitName: row.brandKitName,
      campaignName: row.campaignName,
      skillName: row.skillName,
      skillStableId: row.skillStableId,
      skillVersion: row.skillVersion,
    },
  }));
}
