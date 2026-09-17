import { and, eq, inArray } from 'drizzle-orm';
import { DomainError } from '@/lib/errors/domain';
import { db } from '@/lib/db/drizzle';
import {
  ActivityType,
  activityLogs,
  assets,
  brandKits,
  catalogItemAssets,
  catalogItems,
  type CatalogItem,
} from '@/lib/db/schema';
import {
  catalogProductInputSchema,
  catalogProductUpdateSchema,
  compactCatalogProductInput,
  previewCatalogReadiness,
  type CatalogProductInput,
  type CatalogProductUpdate,
} from './contracts';
import { archiveCatalogImage, type CatalogTransaction } from './assets';

export class CatalogSkuConflictError extends DomainError {
  constructor(readonly existing: Pick<CatalogItem, 'id' | 'externalSku' | 'productName'>) {
    super('catalog_conflict', {
      message: `SKU ${existing.externalSku} already exists in this Workspace.`,
      details: { existingCatalogItemId: existing.id, externalSku: existing.externalSku },
      remediations: [{
        action: 'open_existing_sku',
        label: 'Open existing SKU',
        href: `/dashboard/catalog/${existing.id}`,
      }],
    });
  }
}

export class CatalogWorkspaceReferenceError extends DomainError {
  constructor(internalDetail: string) {
    super('workspace_entity_forbidden', { cause: new Error(internalDetail) });
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type CatalogReadiness = {
  status: 'ready' | 'needs_input';
  issues: Array<{ code: string; field: string; message: string }>;
};

async function assertWorkspaceReferences(
  transaction: CatalogTransaction,
  input: {
    teamId: number;
    brandKitId: number;
    primaryAssetId: number | null;
    detailAssetIds: number[];
  },
): Promise<void> {
  const brand = await transaction
    .select({ id: brandKits.id })
    .from(brandKits)
    .where(and(eq(brandKits.teamId, input.teamId), eq(brandKits.id, input.brandKitId)))
    .limit(1);
  if (!brand[0]) throw new CatalogWorkspaceReferenceError('Brand Kit does not belong to the current workspace.');

  const assetIds = [...new Set([
    ...(input.primaryAssetId ? [input.primaryAssetId] : []),
    ...input.detailAssetIds,
  ])];
  if (assetIds.length === 0) return;
  const workspaceAssets = await transaction
    .select({ id: assets.id, type: assets.type })
    .from(assets)
    .where(and(eq(assets.teamId, input.teamId), inArray(assets.id, assetIds)));
  if (workspaceAssets.length !== assetIds.length || workspaceAssets.some((asset) => asset.type !== 'product_image')) {
    throw new CatalogWorkspaceReferenceError('Every product Asset must belong to the current workspace.');
  }
}

function catalogValues(input: {
  data: CatalogProductInput;
  primaryAssetId: number | null;
  readiness: CatalogReadiness;
}) {
  return {
    productName: input.data.productName,
    category: input.data.category,
    primaryImageUrl: input.data.primaryImageUrl,
    productPageUrl: input.data.productPageUrl ?? null,
    primaryAssetId: input.primaryAssetId,
    readinessStatus: input.readiness.status,
    readinessErrors: JSON.stringify(input.readiness.issues),
    approvedClaims: JSON.stringify(input.data.approvedClaims),
    prohibitedClaims: JSON.stringify(input.data.prohibitedClaims),
    mustShowElements: JSON.stringify(input.data.mustShowElements),
    immutableElements: JSON.stringify(input.data.immutableElements),
    targetAudience: input.data.targetAudience,
    campaignGoal: input.data.campaignGoal,
    platform: input.data.platform,
    durationSeconds: input.data.durationSeconds,
    brandKitId: input.data.brandKitId,
    cta: input.data.cta,
    updatedAt: new Date(),
  };
}

export async function writeCatalogItemInTransaction(
  transaction: CatalogTransaction,
  input: {
    teamId: number;
    userId: number;
    operation: 'create' | 'update';
    data: CatalogProductInput;
    primaryAssetId: number | null;
    detailAssetIds: number[];
    readiness: CatalogReadiness;
    logActivity?: boolean;
  },
): Promise<CatalogItem> {
  const detailAssetIds = [...new Set(input.detailAssetIds)].filter((id) => id !== input.primaryAssetId);
  await assertWorkspaceReferences(transaction, {
    teamId: input.teamId,
    brandKitId: input.data.brandKitId,
    primaryAssetId: input.primaryAssetId,
    detailAssetIds,
  });

  const existing = await transaction
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.teamId, input.teamId), eq(catalogItems.externalSku, input.data.externalSku)))
    .limit(1);
  if (input.operation === 'create' && existing[0]) throw new CatalogSkuConflictError(existing[0]);
  if (input.operation === 'update' && !existing[0]) throw new Error(`SKU ${input.data.externalSku} no longer exists for update.`);

  const values = catalogValues({ data: input.data, primaryAssetId: input.primaryAssetId, readiness: input.readiness });
  const saved = input.operation === 'create'
    ? await transaction.insert(catalogItems).values({
        ...values,
        teamId: input.teamId,
        createdBy: input.userId,
        externalSku: input.data.externalSku,
      }).returning()
    : await transaction.update(catalogItems).set(values).where(and(
        eq(catalogItems.teamId, input.teamId),
        eq(catalogItems.id, existing[0]!.id),
      )).returning();
  const item = saved[0];
  if (!item) throw new Error('Catalog SKU could not be saved.');

  await transaction.delete(catalogItemAssets).where(and(
    eq(catalogItemAssets.teamId, input.teamId),
    eq(catalogItemAssets.catalogItemId, item.id),
  ));
  const bindings = [
    ...(input.primaryAssetId ? [{
      teamId: input.teamId,
      catalogItemId: item.id,
      assetId: input.primaryAssetId,
      purpose: 'primary',
      position: 1,
    }] : []),
    ...detailAssetIds.map((assetId, index) => ({
      teamId: input.teamId,
      catalogItemId: item.id,
      assetId,
      purpose: 'detail',
      position: index + 1,
    })),
  ];
  if (bindings.length > 0) await transaction.insert(catalogItemAssets).values(bindings);

  if (input.logActivity !== false) {
    await transaction.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: input.operation === 'create' ? ActivityType.CREATE_CATALOG_ITEM : ActivityType.UPDATE_CATALOG_ITEM,
    });
  }
  return item;
}

async function archiveMissingImages(
  transaction: CatalogTransaction,
  input: {
    teamId: number;
    userId: number;
    data: CatalogProductInput;
    primaryAssetId: number | null;
    detailAssetIds: number[];
    readiness: CatalogReadiness;
  },
): Promise<{ primaryAssetId: number | null; detailAssetIds: number[] }> {
  if (input.readiness.status !== 'ready') {
    return { primaryAssetId: input.primaryAssetId, detailAssetIds: input.detailAssetIds };
  }
  const primaryAssetId = input.primaryAssetId ?? await archiveCatalogImage(transaction, {
    teamId: input.teamId,
    userId: input.userId,
    sourceUrl: input.data.primaryImageUrl,
    uploadSource: 'remote_archive',
  });
  const detailAssetIds = input.detailAssetIds.length > 0
    ? input.detailAssetIds
    : await Promise.all(input.data.detailImageUrls.map((sourceUrl) => archiveCatalogImage(transaction, {
        teamId: input.teamId,
        userId: input.userId,
        sourceUrl,
        uploadSource: 'remote_archive',
      })));
  return { primaryAssetId, detailAssetIds };
}

export async function createCatalogItemForTeam(input: {
  teamId: number;
  userId: number;
  data: unknown;
  logActivity?: boolean;
}): Promise<CatalogItem> {
  const data = compactCatalogProductInput(catalogProductInputSchema.parse(input.data));
  const readiness = previewCatalogReadiness(data);
  return db.transaction(async (transaction) => {
    const archived = await archiveMissingImages(transaction, {
      teamId: input.teamId,
      userId: input.userId,
      data,
      primaryAssetId: data.primaryAssetId ?? null,
      detailAssetIds: data.detailAssetIds,
      readiness,
    });
    return writeCatalogItemInTransaction(transaction, {
      teamId: input.teamId,
      userId: input.userId,
      operation: 'create',
      data,
      ...archived,
      readiness,
      logActivity: input.logActivity,
    });
  });
}

function inputFromCatalogItem(
  item: CatalogItem,
  detailAssetIds: number[],
): CatalogProductInput {
  return catalogProductInputSchema.parse({
    externalSku: item.externalSku,
    productName: item.productName,
    category: item.category,
    primaryImageUrl: item.primaryImageUrl,
    productPageUrl: item.productPageUrl ?? undefined,
    primaryImageAuthorized: Boolean(item.primaryAssetId),
    primaryAssetId: item.primaryAssetId,
    detailImageUrls: [],
    detailAssetIds,
    approvedClaims: parseJson(item.approvedClaims, []),
    prohibitedClaims: parseJson(item.prohibitedClaims, []),
    mustShowElements: parseJson(item.mustShowElements, []),
    immutableElements: parseJson(item.immutableElements, []),
    targetAudience: item.targetAudience,
    campaignGoal: item.campaignGoal,
    platform: item.platform,
    durationSeconds: item.durationSeconds,
    brandKitId: item.brandKitId,
    cta: item.cta,
  });
}

export async function updateCatalogItemForTeam(input: {
  teamId: number;
  userId: number;
  catalogItemId: number;
  data: unknown;
  logActivity?: boolean;
}): Promise<CatalogItem | null> {
  const update = catalogProductUpdateSchema.parse(input.data) as CatalogProductUpdate;
  return db.transaction(async (transaction) => {
    const current = await transaction.select().from(catalogItems).where(and(
      eq(catalogItems.teamId, input.teamId),
      eq(catalogItems.id, input.catalogItemId),
    )).limit(1);
    if (!current[0]) return null;
    const bindings = await transaction.select({ assetId: catalogItemAssets.assetId, purpose: catalogItemAssets.purpose })
      .from(catalogItemAssets)
      .where(and(eq(catalogItemAssets.teamId, input.teamId), eq(catalogItemAssets.catalogItemId, input.catalogItemId)));
    const currentDetailAssetIds = bindings
      .filter((binding) => binding.purpose === 'detail' && binding.assetId)
      .map((binding) => binding.assetId!);
    const previous = inputFromCatalogItem(current[0], currentDetailAssetIds);
    const data = compactCatalogProductInput(catalogProductInputSchema.parse({ ...previous, ...update }));
    const imageChanged = update.primaryImageUrl !== undefined && update.primaryImageUrl !== previous.primaryImageUrl;
    const detailsChanged = update.detailImageUrls !== undefined;
    const readiness = previewCatalogReadiness(data);
    const archived = await archiveMissingImages(transaction, {
      teamId: input.teamId,
      userId: input.userId,
      data,
      primaryAssetId: update.primaryAssetId !== undefined
        ? update.primaryAssetId ?? null
        : imageChanged ? null : previous.primaryAssetId ?? null,
      detailAssetIds: update.detailAssetIds ?? (detailsChanged ? [] : currentDetailAssetIds),
      readiness,
    });
    return writeCatalogItemInTransaction(transaction, {
      teamId: input.teamId,
      userId: input.userId,
      operation: 'update',
      data,
      ...archived,
      readiness,
      logActivity: input.logActivity,
    });
  });
}

export async function copyCatalogItemForTeam(input: {
  teamId: number;
  userId: number;
  catalogItemId: number;
  externalSku: string;
  logActivity?: boolean;
}): Promise<CatalogItem | null> {
  return db.transaction(async (transaction) => {
    const source = await transaction.select().from(catalogItems).where(and(
      eq(catalogItems.teamId, input.teamId),
      eq(catalogItems.id, input.catalogItemId),
    )).limit(1);
    if (!source[0]) return null;
    const bindings = await transaction.select({ assetId: catalogItemAssets.assetId, purpose: catalogItemAssets.purpose })
      .from(catalogItemAssets)
      .where(and(eq(catalogItemAssets.teamId, input.teamId), eq(catalogItemAssets.catalogItemId, input.catalogItemId)));
    const detailAssetIds = bindings.filter((binding) => binding.purpose === 'detail' && binding.assetId).map((binding) => binding.assetId!);
    const data = compactCatalogProductInput(catalogProductInputSchema.parse({
      ...inputFromCatalogItem(source[0], detailAssetIds),
      externalSku: input.externalSku,
      productPageUrl: undefined,
    }));
    const copied = await writeCatalogItemInTransaction(transaction, {
      teamId: input.teamId,
      userId: input.userId,
      operation: 'create',
      data,
      primaryAssetId: source[0].primaryAssetId,
      detailAssetIds,
      readiness: {
        status: 'needs_input',
        issues: [{
          code: 'copied_sku_requires_review',
          field: 'externalSku',
          message: 'Review copied product data before starting generation.',
        }],
      },
      logActivity: false,
    });
    if (input.logActivity !== false) {
      await transaction.insert(activityLogs).values({
        teamId: input.teamId,
        userId: input.userId,
        action: ActivityType.COPY_CATALOG_ITEM,
      });
    }
    return copied;
  });
}
