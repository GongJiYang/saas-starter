import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  ActivityType,
  activityLogs,
  brandKits,
  catalogItems,
  creativeReferences,
  importBatches,
  importRows,
  teams,
} from '@/lib/db/schema';
import { getImportBatchForTeam } from '@/lib/db/bulk-queries';
import {
  normalizeCsvRecord,
  type CsvImportIssue,
  type CsvNormalizationContext,
  type NormalizedCsvRow,
} from './csv';
import { catalogProductInputSchema } from '@/lib/catalog/contracts';
import { writeCatalogItemInTransaction } from '@/lib/catalog/service';
import { CSV_LEGACY_TEMPLATE_VERSION, CSV_TEMPLATE_VERSION, defaultCsvImportDecision, type CsvTemplateVersion } from './contracts';

export type ImportRowDecision = 'create' | 'update' | 'exclude';

function parseJson<T>(value: string | null, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function appendIssue(issues: CsvImportIssue[], code: string, field: string, message: string): CsvImportIssue[] {
  return [...issues, { code: code as CsvImportIssue['code'], field, message }];
}
function isBlockingIssue(issue: CsvImportIssue): boolean {
  return issue.code !== ('catalog_duplicate_sku' as CsvImportIssue['code']);
}

async function getCsvContext(teamId: number, importBatchId: number): Promise<CsvNormalizationContext> {
  const [batchRows, workspaceRows, workspaceBrandKits] = await Promise.all([
    db.select({ templateVersion: importBatches.templateVersion })
      .from(importBatches)
      .where(and(eq(importBatches.teamId, teamId), eq(importBatches.id, importBatchId)))
      .limit(1),
    db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1),
    db.select({ id: brandKits.id, name: brandKits.name }).from(brandKits).where(eq(brandKits.teamId, teamId)),
  ]);
  const templateVersion = batchRows[0]?.templateVersion;
  const version: CsvTemplateVersion = templateVersion === CSV_LEGACY_TEMPLATE_VERSION
    ? CSV_LEGACY_TEMPLATE_VERSION
    : templateVersion === CSV_TEMPLATE_VERSION
      ? CSV_TEMPLATE_VERSION
      : (() => { throw new Error('Import batch has an unsupported CSV template version.'); })();
  return {
    version,
    brandKits: workspaceBrandKits,
    workspaceName: workspaceRows[0]?.name ?? `Workspace ${teamId}`,
  };
}


async function refreshImportBatchSummary(teamId: number, importBatchId: number): Promise<void> {
  const rows = await db
    .select({ status: importRows.status })
    .from(importRows)
    .where(and(eq(importRows.teamId, teamId), eq(importRows.importBatchId, importBatchId)));
  const validRows = rows.filter((row) => row.status === 'ready').length;
  const invalidRows = rows.filter((row) => row.status === 'needs_fix').length;
  const status = rows.length > 0 && validRows > 0 && invalidRows === 0 ? 'ready' : 'needs_fix';
  await db
    .update(importBatches)
    .set({
      totalRows: rows.length,
      validRows,
      invalidRows,
      status,
      updatedAt: new Date(),
    })
    .where(and(eq(importBatches.teamId, teamId), eq(importBatches.id, importBatchId)));
}


export async function updateImportRowForTeam(input: {
  teamId: number;
  importBatchId: number;
  rowNumber: number;
  rawValues: Record<string, string>;
}) {
  const rows = await db
    .select()
    .from(importRows)
    .where(and(
      eq(importRows.teamId, input.teamId),
      eq(importRows.importBatchId, input.importBatchId),
      eq(importRows.rowNumber, input.rowNumber),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('Import row not found.');

  const context = await getCsvContext(input.teamId, input.importBatchId);
  const previous = parseJson<Record<string, unknown>>(row.normalizedValues, {});
  const result = normalizeCsvRecord(input.rawValues, context);
  const unchangedAssets = typeof previous.primaryAssetId === 'number'
    && previous.primaryImageUrl === result.normalizedValues.primaryImageUrl
    && JSON.stringify(previous.detailImageUrls ?? []) === JSON.stringify(result.normalizedValues.detailImageUrls)
    && previous.referenceVideoUrl === result.normalizedValues.referenceVideoUrl;
  let issues = result.issues;
  const existingSku = result.normalizedValues.externalSku
    ? await db.select({ id: catalogItems.id }).from(catalogItems).where(and(
        eq(catalogItems.teamId, input.teamId),
        eq(catalogItems.externalSku, result.normalizedValues.externalSku),
      )).limit(1)
    : [];
  if (existingSku[0]) {
    issues = appendIssue(
      issues,
      'catalog_duplicate_sku',
      'external_sku',
      'SKU already exists in this Workspace; update is selected by default.',
    );
  }
  if (result.readinessStatus === 'ready' && !unchangedAssets) {
    issues = appendIssue(issues, 'asset_archive_required', 'primary_image_url', 'Revalidate this row to archive changed remote assets.');
  }
  const normalizedValues = unchangedAssets
    ? { ...result.normalizedValues, ...pickArchivedValues(previous) }
    : result.normalizedValues;
  const status = issues.every((entry) => !isBlockingIssue(entry)) && result.readinessStatus === 'ready' ? 'ready' : 'needs_fix';
  const updated = await db
    .update(importRows)
    .set({
      rawValues: JSON.stringify(input.rawValues),
      normalizedValues: JSON.stringify(normalizedValues),
      errors: JSON.stringify(issues),
      status,
      updatedAt: new Date(),
    })
    .where(eq(importRows.id, row.id))
    .returning();
  await refreshImportBatchSummary(input.teamId, input.importBatchId);
  return updated[0];
}

function pickArchivedValues(value: Record<string, unknown>): Record<string, unknown> {
  const archived: Record<string, unknown> = {};
  for (const key of ['primaryAssetId', 'detailAssetIds', 'creativeReferenceId']) {
    if (value[key] !== undefined) archived[key] = value[key];
  }
  return archived;
}

export async function mapImportRowsBrandKitForTeam(input: {
  teamId: number;
  importBatchId: number;
  rowNumbers: number[];
  brandKitName: string;
}) {
  const context = await getCsvContext(input.teamId, input.importBatchId);
  if (context.version === CSV_LEGACY_TEMPLATE_VERSION) {
    throw new Error('Historical v1 imports are read-only. Download a v2 repaired CSV to continue.');
  }
  const selected = context.brandKits.find((kit) => kit.name === input.brandKitName);
  if (!selected) {
    throw new Error(
      `Brand Kit "${input.brandKitName}" is not available in Workspace "${context.workspaceName}". Available Brand Kits: ${context.brandKits.map((kit) => kit.name).join(', ') || 'none'}.`,
    );
  }
  const rows = await db.select().from(importRows).where(and(
    eq(importRows.teamId, input.teamId),
    eq(importRows.importBatchId, input.importBatchId),
    inArray(importRows.rowNumber, input.rowNumbers),
  ));
  const updated = [];
  for (const row of rows) {
    const rawValues = parseJson<Record<string, string>>(row.rawValues, {});
    rawValues.brand_kit_name = selected.name;
    const result = await updateImportRowForTeam({
      teamId: input.teamId,
      importBatchId: input.importBatchId,
      rowNumber: row.rowNumber,
      rawValues,
    });
    if (result) updated.push(result);
  }
  return updated;
}

export async function excludeImportRowsForTeam(input: {
  teamId: number;
  importBatchId: number;
  rowNumbers: number[];
}) {
  if (input.rowNumbers.length === 0) return [];
  const rows = await db
    .select()
    .from(importRows)
    .where(and(
      eq(importRows.teamId, input.teamId),
      eq(importRows.importBatchId, input.importBatchId),
      inArray(importRows.rowNumber, input.rowNumbers),
    ));
  const updated = [];
  for (const row of rows) {
    const errors = appendIssue(
      parseJson<CsvImportIssue[]>(row.errors, []),
      'excluded_by_user',
      'row',
      'Row was excluded by a workspace member.',
    );
    const result = await db
      .update(importRows)
      .set({ status: 'excluded', errors: JSON.stringify(errors), updatedAt: new Date() })
      .where(eq(importRows.id, row.id))
      .returning();
    if (result[0]) updated.push(result[0]);
  }
  await refreshImportBatchSummary(input.teamId, input.importBatchId);
  return updated;
}

export async function commitImportBatch(input: {
  teamId: number;
  userId: number;
  importBatchId: number;
  decisions: Record<string, ImportRowDecision>;
}) {
  const batch = await getImportBatchForTeam(input.teamId, input.importBatchId);
  if (!batch) throw new Error('Import batch not found.');
  if (batch.status === 'committed') return { idempotent: true, catalogItemIds: [] };
  if (batch.status === 'failed' || batch.status === 'validating') {
    throw new Error('Import batch is not ready to commit.');
  }

  const rows = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.teamId, input.teamId), eq(importRows.importBatchId, input.importBatchId)));
  const included = rows.filter((row) => row.status !== 'excluded' && input.decisions[String(row.rowNumber)] !== 'exclude');
  const activeSkus = new Map<string, number>();
  const duplicateRows = new Set<number>();
  for (const row of included) {
    const normalized = parseJson<Partial<NormalizedCsvRow>>(row.normalizedValues, {});
    if (!normalized.externalSku) continue;
    const previous = activeSkus.get(normalized.externalSku);
    if (previous) {
      duplicateRows.add(previous);
      duplicateRows.add(row.rowNumber);
    } else {
      activeSkus.set(normalized.externalSku, row.rowNumber);
    }
  }
  if (duplicateRows.size > 0) {
    throw new Error(`Duplicate SKU rows must be excluded before commit: ${[...duplicateRows].join(', ')}.`);
  }

  const brandKitIds = [...new Set(included.map((row) => parseJson<Partial<NormalizedCsvRow>>(row.normalizedValues, {}).brandKitId).filter((id): id is number => typeof id === 'number'))];
  if (brandKitIds.length > 0) {
    const [validBrandKits, workspaceRows, availableBrandKits] = await Promise.all([
      db.select({ id: brandKits.id }).from(brandKits).where(and(eq(brandKits.teamId, input.teamId), inArray(brandKits.id, brandKitIds))),
      db.select({ name: teams.name }).from(teams).where(eq(teams.id, input.teamId)).limit(1),
      db.select({ name: brandKits.name }).from(brandKits).where(eq(brandKits.teamId, input.teamId)),
    ]);
    if (validBrandKits.length !== brandKitIds.length) {
      const validIds = new Set(validBrandKits.map((kit) => kit.id));
      const invalidIds = brandKitIds.filter((id) => !validIds.has(id));
      throw new Error(
        `CSV Brand Kit IDs "${invalidIds.join(', ')}" are not available in Workspace "${workspaceRows[0]?.name ?? input.teamId}". Available Brand Kits: ${availableBrandKits.map((kit) => kit.name).join(', ') || 'none'}.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    const catalogItemIds: number[] = [];
    for (const row of rows) {
      const requestedDecision = input.decisions[String(row.rowNumber)];
      if (requestedDecision === 'exclude' || row.status === 'excluded') {
        if (row.status !== 'excluded') {
          await tx.update(importRows).set({ status: 'excluded', updatedAt: new Date() }).where(eq(importRows.id, row.id));
        }
        continue;
      }
      if (row.status !== 'ready') throw new Error(`Row ${row.rowNumber} must be fixed or excluded before commit.`);

      const normalized = parseJson<NormalizedCsvRow & { primaryAssetId?: number; detailAssetIds?: number[]; creativeReferenceId?: number }>(row.normalizedValues, {} as NormalizedCsvRow);
      const existingCatalogItem = await tx.select({ id: catalogItems.id }).from(catalogItems).where(and(
        eq(catalogItems.teamId, input.teamId),
        eq(catalogItems.externalSku, normalized.externalSku),
      )).limit(1);
      const decision = requestedDecision ?? defaultCsvImportDecision(Boolean(existingCatalogItem[0]));
      if (!normalized.primaryAssetId) throw new Error(`Row ${row.rowNumber} has no archived primary image.`);
      const detailAssetIds = normalized.detailAssetIds ?? [];
      const data = catalogProductInputSchema.parse({
        externalSku: normalized.externalSku,
        productName: normalized.productName,
        category: normalized.category,
        primaryImageUrl: normalized.primaryImageUrl,
        productPageUrl: normalized.productPageUrl,
        primaryImageAuthorized: true,
        primaryAssetId: normalized.primaryAssetId,
        detailImageUrls: normalized.detailImageUrls,
        detailAssetIds,
        approvedClaims: normalized.approvedClaims,
        prohibitedClaims: normalized.prohibitedClaims,
        mustShowElements: normalized.mustShowElements,
        immutableElements: normalized.immutableElements,
        targetAudience: normalized.targetAudience,
        campaignGoal: normalized.campaignGoal,
        platform: normalized.platform,
        durationSeconds: normalized.durationSeconds,
        brandKitId: normalized.brandKitId,
        cta: normalized.cta,
        referenceVideoUrl: normalized.referenceVideoUrl,
        referenceRights: normalized.referenceRights,
        referenceMode: normalized.referenceMode,
      });
      const saved = await writeCatalogItemInTransaction(tx, {
        teamId: input.teamId,
        userId: input.userId,
        operation: decision,
        data,
        primaryAssetId: normalized.primaryAssetId,
        detailAssetIds,
        readiness: { status: 'ready', issues: [] },
        logActivity: false,
      });
      const catalogItemId = saved.id;
      catalogItemIds.push(catalogItemId);
      if (normalized.creativeReferenceId) {
        await tx.update(creativeReferences)
          .set({ catalogItemId, updatedAt: new Date() })
          .where(and(eq(creativeReferences.teamId, input.teamId), eq(creativeReferences.id, normalized.creativeReferenceId)));
      }
      await tx.update(importRows).set({ status: 'committed', errors: '[]', updatedAt: new Date() }).where(eq(importRows.id, row.id));
    }

    await tx.update(importBatches).set({
      status: 'committed',
      updatedAt: new Date(),
      committedAt: new Date(),
    }).where(and(eq(importBatches.teamId, input.teamId), eq(importBatches.id, input.importBatchId)));
    await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.COMMIT_CSV_IMPORT });
    return { idempotent: false, catalogItemIds };
  });
}
