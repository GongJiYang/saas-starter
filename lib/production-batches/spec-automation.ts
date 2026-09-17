import { and, desc, eq, sql } from 'drizzle-orm';
import { createCreativeSpecDraft } from '@/lib/creative-spec/actions';
import { db } from '@/lib/db/drizzle';
import {
  ActivityType,
  activityLogs,
  campaigns,
  catalogItems,
  creativeSpecVersions,
  productionBatchItems,
  productionBatches,
  shotCards,
} from '@/lib/db/schema';
import { executionPlanTemplate } from '@/lib/campaigns/execution-plan';
import { assertProductionBatchModeTransition } from './state';

export type BatchItemCampaignResult = {
  batchId: number;
  itemId: number;
  campaignId: number;
  created: boolean;
};

export type BatchItemSpecDraftResult = {
  batchId: number;
  itemId: number;
  externalSku: string;
  campaignId: number;
  specVersionId: number;
  specVersion: string;
  specStatus: string;
  created: boolean;
};

function firstLockedSkillVersionId(value: string): number | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    for (const candidate of Object.values(parsed)) {
      if (!candidate || typeof candidate !== 'object' || !('shotSkillVersionId' in candidate)) continue;
      const versionId = Number((candidate as { shotSkillVersionId: unknown }).shotSkillVersionId);
      if (Number.isSafeInteger(versionId) && versionId > 0) return versionId;
    }
  } catch {
    // Invalid legacy locks are handled by the normal Skill binding path.
  }
  return null;
}

export async function ensureProductionBatchItemCampaign(input: {
  teamId: number;
  userId: number;
  batchId: number;
  itemId: number;
}): Promise<BatchItemCampaignResult> {
  return db.transaction(async (transaction) => {
    const item = (await transaction.select().from(productionBatchItems).where(and(
      eq(productionBatchItems.id, input.itemId),
      eq(productionBatchItems.productionBatchId, input.batchId),
      eq(productionBatchItems.teamId, input.teamId),
    )).limit(1).for('update'))[0];
    if (!item) throw new Error('Production Batch item is not available in the current Workspace.');
    if (item.catalogItemId === null) throw new Error('Uploaded image items do not use Campaign automation.');
    const [batch, catalogItem] = await Promise.all([
      transaction.select().from(productionBatches).where(and(
        eq(productionBatches.id, input.batchId),
        eq(productionBatches.teamId, input.teamId),
      )).limit(1),
      transaction.select().from(catalogItems).where(and(
        eq(catalogItems.id, item.catalogItemId),
        eq(catalogItems.teamId, input.teamId),
      )).limit(1),
    ]);
    const currentBatch = batch[0];
    const product = catalogItem[0];
    if (!currentBatch || !product) throw new Error('Production Batch or SKU is not available in the current Workspace.');
    if (
      currentBatch.generationMode === 'bulk'
      && !item.isPilot
      && !['ready', 'producing', 'reviewing'].includes(currentBatch.status)
    ) {
      throw new Error(`SKU ${product.externalSku} must be selected as a Pilot before creating its Campaign, or wait until the Pilot gate releases production Waves.`);
    }
    if (!product.primaryAssetId) throw new Error(`SKU ${product.externalSku} needs a verified primary product image.`);
    const lockedSkillVersionId = firstLockedSkillVersionId(currentBatch.skillVersionLock);

    if (item.campaignId) {
      const existingCampaign = (await transaction.select({ id: campaigns.id }).from(campaigns).where(and(
        eq(campaigns.id, item.campaignId),
        eq(campaigns.teamId, input.teamId),
      )).limit(1))[0];
      if (!existingCampaign) throw new Error('The BatchItem Campaign is not available in the current Workspace.');
      if (lockedSkillVersionId) {
        await transaction.update(shotCards).set({
          shotSkillVersionId: lockedSkillVersionId,
          skillSelectionReason: 'Frozen by the Production task Eligibility selection.',
          updatedAt: new Date(),
        }).where(and(
          eq(shotCards.teamId, input.teamId),
          eq(shotCards.campaignId, item.campaignId),
          eq(shotCards.status, 'selected'),
        ));
      }
      if (currentBatch.generationMode === 'single' && currentBatch.status === 'draft') {
        assertProductionBatchModeTransition('single', currentBatch.status, 'ready_for_spec');
        await transaction.update(productionBatches).set({
          status: 'ready_for_spec',
          updatedAt: new Date(),
        }).where(and(
          eq(productionBatches.id, currentBatch.id),
          eq(productionBatches.teamId, input.teamId),
        ));
      }
      return { batchId: currentBatch.id, itemId: item.id, campaignId: item.campaignId, created: false };
    }

    const createdCampaign = (await transaction.insert(campaigns).values({
      teamId: input.teamId,
      createdBy: input.userId,
      brandKitId: currentBatch.defaultBrandKitId ?? product.brandKitId,
      productAssetId: product.primaryAssetId,
      name: `${currentBatch.name} · ${product.externalSku}`,
      sellingPoints: product.approvedClaims,
      targetPlatform: currentBatch.targetPlatform,
      durationSeconds: currentBatch.durationSeconds,
      status: 'ready',
    }).returning({ id: campaigns.id }))[0];
    if (!createdCampaign) throw new Error('Campaign could not be created for the BatchItem.');
    await transaction.insert(shotCards).values({
      teamId: input.teamId,
      campaignId: createdCampaign.id,
      ...executionPlanTemplate,
      status: 'selected',
      shotSkillVersionId: lockedSkillVersionId,
      skillSelectionReason: lockedSkillVersionId
        ? 'Frozen by the Production task Eligibility selection.'
        : null,
    });
    await transaction.update(productionBatchItems).set({
      campaignId: createdCampaign.id,
      updatedAt: new Date(),
    }).where(and(
      eq(productionBatchItems.id, item.id),
      eq(productionBatchItems.teamId, input.teamId),
    ));
    if (currentBatch.generationMode === 'single' && currentBatch.status === 'draft') {
      assertProductionBatchModeTransition('single', currentBatch.status, 'ready_for_spec');
      await transaction.update(productionBatches).set({
        status: 'ready_for_spec',
        updatedAt: new Date(),
      }).where(and(
        eq(productionBatches.id, currentBatch.id),
        eq(productionBatches.teamId, input.teamId),
      ));
    }
    await transaction.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.CREATE_CAMPAIGN,
      metadata: {
        productionBatchId: currentBatch.id,
        productionBatchItemId: item.id,
        campaignId: createdCampaign.id,
      },
    });
    return { batchId: currentBatch.id, itemId: item.id, campaignId: createdCampaign.id, created: true };
  });
}

export async function createProductionBatchItemSpecDraft(input: {
  teamId: number;
  userId: number;
  batchId: number;
  itemId: number;
}): Promise<BatchItemSpecDraftResult> {
  const campaign = await ensureProductionBatchItemCampaign(input);
  const row = (await db.select({ item: productionBatchItems, product: catalogItems })
    .from(productionBatchItems)
    .innerJoin(catalogItems, eq(catalogItems.id, productionBatchItems.catalogItemId))
    .where(and(
      eq(productionBatchItems.id, input.itemId),
      eq(productionBatchItems.productionBatchId, input.batchId),
      eq(productionBatchItems.teamId, input.teamId),
      eq(catalogItems.teamId, input.teamId),
    ))
    .limit(1))[0];
  if (!row) throw new Error('Production Batch item is not available in the current Workspace.');

  const existing = (await db.select().from(creativeSpecVersions).where(and(
    eq(creativeSpecVersions.teamId, input.teamId),
    eq(creativeSpecVersions.campaignId, campaign.campaignId),
  )).orderBy(desc(creativeSpecVersions.createdAt)).limit(1))[0];
  if (existing && existing.status !== 'rejected') {
    return {
      batchId: input.batchId,
      itemId: input.itemId,
      externalSku: row.product.externalSku,
      campaignId: campaign.campaignId,
      specVersionId: existing.id,
      specVersion: existing.version,
      specStatus: existing.status,
      created: false,
    };
  }

  try {
    const spec = await createCreativeSpecDraft({
      teamId: input.teamId,
      userId: input.userId,
      campaignId: campaign.campaignId,
      catalogItemId: row.product.id,
    });
    return {
      batchId: input.batchId,
      itemId: input.itemId,
      externalSku: row.product.externalSku,
      campaignId: campaign.campaignId,
      specVersionId: spec.id,
      specVersion: spec.version,
      specStatus: spec.status,
      created: true,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const concurrent = (await db.select().from(creativeSpecVersions).where(and(
        eq(creativeSpecVersions.teamId, input.teamId),
        eq(creativeSpecVersions.campaignId, campaign.campaignId),
      )).orderBy(desc(creativeSpecVersions.createdAt)).limit(1))[0];
      if (concurrent) {
        return {
          batchId: input.batchId,
          itemId: input.itemId,
          externalSku: row.product.externalSku,
          campaignId: campaign.campaignId,
          specVersionId: concurrent.id,
          specVersion: concurrent.version,
          specStatus: concurrent.status,
          created: false,
        };
      }
    }
    if (campaign.created) {
      await db.transaction(async (transaction) => {
        await transaction.update(productionBatchItems).set({ campaignId: null, updatedAt: new Date() }).where(and(
          eq(productionBatchItems.id, input.itemId),
          eq(productionBatchItems.teamId, input.teamId),
          eq(productionBatchItems.productionBatchId, input.batchId),
        ));
        await transaction.delete(shotCards).where(and(
          eq(shotCards.teamId, input.teamId),
          eq(shotCards.campaignId, campaign.campaignId),
        ));
        const currentBatch = (await transaction.select({ status: productionBatches.status, generationMode: productionBatches.generationMode }).from(productionBatches).where(and(
          eq(productionBatches.id, input.batchId),
          eq(productionBatches.teamId, input.teamId),
        )).limit(1))[0];
        if (currentBatch?.generationMode === 'single' && currentBatch.status === 'ready_for_spec') {
          await transaction.update(productionBatches).set({ status: 'draft', updatedAt: new Date() }).where(eq(productionBatches.id, input.batchId));
        }
        await transaction.delete(campaigns).where(and(
          eq(campaigns.id, campaign.campaignId),
          eq(campaigns.teamId, input.teamId),
        ));
        await transaction.delete(activityLogs).where(and(
          eq(activityLogs.teamId, input.teamId),
          eq(activityLogs.userId, input.userId),
          eq(activityLogs.action, ActivityType.CREATE_CAMPAIGN),
          sql`${activityLogs.metadata}->>'productionBatchItemId' = ${String(input.itemId)}`,
        ));
      });
    }
    throw error;
  }
}

export async function createPilotSpecDrafts(input: {
  teamId: number;
  userId: number;
  batchId: number;
}) {
  const items = await db.select({ item: productionBatchItems, externalSku: catalogItems.externalSku })
    .from(productionBatchItems)
    .innerJoin(catalogItems, eq(catalogItems.id, productionBatchItems.catalogItemId))
    .where(and(
      eq(productionBatchItems.teamId, input.teamId),
      eq(productionBatchItems.productionBatchId, input.batchId),
      eq(productionBatchItems.isPilot, true),
    ));
  if (items.length === 0) throw new Error('Select Pilot SKU before creating Creative Specs.');
  const results: Array<BatchItemSpecDraftResult | {
    batchId: number;
    itemId: number;
    externalSku: string;
    created: false;
    error: string;
  }> = [];
  for (const row of items) {
    try {
      results.push(await createProductionBatchItemSpecDraft({ ...input, itemId: row.item.id }));
    } catch (error) {
      results.push({
        batchId: input.batchId,
        itemId: row.item.id,
        externalSku: row.externalSku,
        created: false,
        error: error instanceof Error ? error.message : 'Creative Spec draft could not be created.',
      });
    }
  }
  return { results };
}
