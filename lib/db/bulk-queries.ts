import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from './drizzle';
import {
  catalogItemAssets,
  catalogItems,
  creativeReferences,
  creativeSpecVersions,
  importBatches,
  importRows,
  productionBatchItems,
  productionBatches,
  referenceAnalyses,
} from './schema';

/**
 * Every bulk-domain query requires the authenticated workspace teamId.
 * Callers must derive it from membership rather than client input.
 */
export async function getCatalogItemForTeam(teamId: number, catalogItemId: number) {
  const result = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.teamId, teamId), eq(catalogItems.id, catalogItemId)))
    .limit(1);

  return result[0] ?? null;
}

export async function listCatalogItemsForTeam(teamId: number) {
  return db
    .select()
    .from(catalogItems)
    .where(eq(catalogItems.teamId, teamId))
    .orderBy(desc(catalogItems.createdAt));
}

export async function listCatalogItemAssetsForTeam(teamId: number, catalogItemId: number) {
  return db
    .select()
    .from(catalogItemAssets)
    .where(
      and(
        eq(catalogItemAssets.teamId, teamId),
        eq(catalogItemAssets.catalogItemId, catalogItemId),
      ),
    )
    .orderBy(asc(catalogItemAssets.position));
}

export async function getImportBatchForTeam(teamId: number, importBatchId: number) {
  const result = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.teamId, teamId), eq(importBatches.id, importBatchId)))
    .limit(1);

  return result[0] ?? null;
}

export async function listImportBatchesForTeam(teamId: number) {
  return db
    .select()
    .from(importBatches)
    .where(eq(importBatches.teamId, teamId))
    .orderBy(desc(importBatches.createdAt));
}

export async function listImportRowsForBatch(teamId: number, importBatchId: number) {
  return db
    .select()
    .from(importRows)
    .where(
      and(eq(importRows.teamId, teamId), eq(importRows.importBatchId, importBatchId)),
    )
    .orderBy(asc(importRows.rowNumber));
}

export async function getCreativeReferenceForTeam(
  teamId: number,
  creativeReferenceId: number,
) {
  const result = await db
    .select()
    .from(creativeReferences)
    .where(
      and(
        eq(creativeReferences.teamId, teamId),
        eq(creativeReferences.id, creativeReferenceId),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

export async function listReferenceAnalysesForTeam(
  teamId: number,
  creativeReferenceId: number,
) {
  return db
    .select()
    .from(referenceAnalyses)
    .where(
      and(
        eq(referenceAnalyses.teamId, teamId),
        eq(referenceAnalyses.creativeReferenceId, creativeReferenceId),
      ),
    )
    .orderBy(desc(referenceAnalyses.createdAt));
}

export async function getProductionBatchForTeam(
  teamId: number,
  productionBatchId: number,
) {
  const result = await db
    .select()
    .from(productionBatches)
    .where(
      and(
        eq(productionBatches.teamId, teamId),
        eq(productionBatches.id, productionBatchId),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

export async function listProductionBatchesForTeam(teamId: number) {
  return db
    .select()
    .from(productionBatches)
    .where(eq(productionBatches.teamId, teamId))
    .orderBy(desc(productionBatches.createdAt));
}

export async function listProductionBatchItemsForTeam(
  teamId: number,
  productionBatchId: number,
) {
  return db
    .select()
    .from(productionBatchItems)
    .where(
      and(
        eq(productionBatchItems.teamId, teamId),
        eq(productionBatchItems.productionBatchId, productionBatchId),
      ),
    )
    .orderBy(asc(productionBatchItems.waveNumber), asc(productionBatchItems.id));
}

export async function getCreativeSpecVersionForTeam(
  teamId: number,
  creativeSpecVersionId: number,
) {
  const result = await db
    .select()
    .from(creativeSpecVersions)
    .where(
      and(
        eq(creativeSpecVersions.teamId, teamId),
        eq(creativeSpecVersions.id, creativeSpecVersionId),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

export async function listCreativeSpecVersionsForCampaign(
  teamId: number,
  campaignId: number,
) {
  return db
    .select()
    .from(creativeSpecVersions)
    .where(
      and(
        eq(creativeSpecVersions.teamId, teamId),
        eq(creativeSpecVersions.campaignId, campaignId),
      ),
    )
    .orderBy(desc(creativeSpecVersions.createdAt));
}
