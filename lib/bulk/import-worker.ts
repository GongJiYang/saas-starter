import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { archiveRemoteObject, downloadCsvObject } from '@/lib/storage/cos';
import { db } from '@/lib/db/drizzle';
import {
  brandKits,
  catalogItems,
  creativeReferences,
  importBatches,
  importRows,
  teams,
} from '@/lib/db/schema';
import { getImportBatchForTeam } from '@/lib/db/bulk-queries';
import { CSV_LEGACY_TEMPLATE_VERSION, CSV_TEMPLATE_VERSION, type CsvTemplateVersion, validateSkuReadiness } from './contracts';
import {
  findDuplicateExternalSkuRows,
  normalizeCsvRecord,
  parseCsvDocument,
  type CsvImportIssue,
  type ParsedCsvDocument,
  type NormalizedCsvRow,
} from './csv';
import { assertSafeRemoteUrl } from './url-safety';
import { consumeRateLimit } from '@/lib/ops/rate-limit';
import { archiveCatalogImage } from '@/lib/catalog/assets';

function addIssue(issues: CsvImportIssue[], code: string, field: string, message: string): void {
  issues.push({
    code: code as CsvImportIssue['code'],
    field,
    message,
  });
}

function isBlockingIssue(issue: CsvImportIssue): boolean {
  return issue.code !== ('catalog_duplicate_sku' as CsvImportIssue['code']);
}


function assertRemoteHostRateLimit(sourceUrl: string): void {
  const hostname = new URL(sourceUrl).hostname;
  if (!consumeRateLimit(`remote-host:${hostname}`, 120, 60_000)) {
    throw new Error(`Remote host rate limit exceeded for ${hostname}.`);
  }
}

async function archiveReference(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    teamId: number;
    userId: number;
    batchId: number;
    rowNumber: number;
    sourceUrl: string;
    rights: 'owned' | 'licensed' | 'inspiration_only';
    mode: 'structure' | 'owned_template';
  },
): Promise<number> {
  const sourceId = `csv-${input.batchId}-${input.rowNumber}`;
  const existing = await tx
    .select({ id: creativeReferences.id })
    .from(creativeReferences)
    .where(and(eq(creativeReferences.teamId, input.teamId), eq(creativeReferences.sourceId, sourceId)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  assertRemoteHostRateLimit(input.sourceUrl);
  const archived = await archiveRemoteObject({
    teamId: input.teamId,
    sourceUrl: input.sourceUrl,
    kind: 'reference',
  });
  const inserted = await tx
    .insert(creativeReferences)
    .values({
      teamId: input.teamId,
      uploadedBy: input.userId,
      sourceId,
      objectKey: archived.objectKey,
      sourceUrl: input.sourceUrl,
      rights: input.rights,
      mode: input.mode,
      contentType: archived.contentType,
      byteSize: archived.byteSize,
    })
    .returning({ id: creativeReferences.id });
  return inserted[0].id;
}

async function prepareArchivedValues(input: {
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0];
  teamId: number;
  userId: number;
  batchId: number;
  rowNumber: number;
  normalized: NormalizedCsvRow;
  issues: CsvImportIssue[];
}): Promise<Record<string, unknown>> {
  const normalized = input.normalized;
  const urls = [
    normalized.primaryImageUrl,
    ...normalized.detailImageUrls,
    normalized.productPageUrl,
    normalized.referenceVideoUrl,
  ].filter((url): url is string => Boolean(url));

  for (const url of urls) {
    try {
      await assertSafeRemoteUrl(url);
    } catch (error) {
      addIssue(input.issues, 'unsafe_remote_url', 'url', error instanceof Error ? error.message : 'URL is unsafe.');
    }
  }

  if (input.issues.length > 0) {
    return {};
  }

  try {
    const primaryAssetId = await archiveCatalogImage(input.tx, {
      teamId: input.teamId,
      userId: input.userId,
      sourceUrl: normalized.primaryImageUrl,
      uploadSource: 'csv_import',
    });
    const detailAssetIds: number[] = [];
    for (const sourceUrl of normalized.detailImageUrls) {
      detailAssetIds.push(await archiveCatalogImage(input.tx, {
        teamId: input.teamId,
        userId: input.userId,
        sourceUrl,
        uploadSource: 'csv_import',
      }));
    }

    let creativeReferenceId: number | undefined;
    if (normalized.referenceVideoUrl) {
      creativeReferenceId = await archiveReference(input.tx, {
        teamId: input.teamId,
        userId: input.userId,
        batchId: input.batchId,
        rowNumber: input.rowNumber,
        sourceUrl: normalized.referenceVideoUrl,
        rights: normalized.referenceRights!,
        mode: normalized.referenceMode === 'owned_template' ? 'owned_template' : 'structure',
      });
    }

    return { primaryAssetId, detailAssetIds, creativeReferenceId };
  } catch (error) {
    addIssue(
      input.issues,
      'asset_archive_failed',
      'primary_image_url',
      error instanceof Error ? error.message : 'Remote asset could not be archived.',
    );
    return {};
  }
}

export async function processCsvImport(input: {
  teamId: number;
  importBatchId: number;
}): Promise<void> {
  const batch = await getImportBatchForTeam(input.teamId, input.importBatchId);
  if (!batch || batch.status === 'committed') return;
  const version: CsvTemplateVersion = batch.templateVersion === CSV_LEGACY_TEMPLATE_VERSION
    ? CSV_LEGACY_TEMPLATE_VERSION
    : batch.templateVersion === CSV_TEMPLATE_VERSION
      ? CSV_TEMPLATE_VERSION
      : (() => { throw new Error(`Unsupported CSV template version ${batch.templateVersion}.`); })();
  const [workspaceRows, workspaceBrandKits] = await Promise.all([
    db.select({ name: teams.name }).from(teams).where(eq(teams.id, input.teamId)).limit(1),
    db.select({ id: brandKits.id, name: brandKits.name }).from(brandKits).where(eq(brandKits.teamId, input.teamId)),
  ]);
  const csvContext = {
    version,
    brandKits: workspaceBrandKits,
    workspaceName: workspaceRows[0]?.name ?? `Workspace ${input.teamId}`,
  };

  await db
    .update(importBatches)
    .set({ status: 'validating', updatedAt: new Date() })
    .where(and(eq(importBatches.teamId, input.teamId), eq(importBatches.id, input.importBatchId)));

  try {
    const previousRows = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.teamId, input.teamId), eq(importRows.importBatchId, input.importBatchId)));
    let parsed: ParsedCsvDocument;
    if (['needs_fix', 'ready'].includes(batch.status) && previousRows.length > 0) {
      parsed = {
        version: batch.templateVersion,
        headers: [],
        issues: [],
        rows: previousRows.map((row) => {
          const value: unknown = JSON.parse(row.rawValues);
          if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.values(value).some((field) => typeof field !== 'string')) {
            throw new Error(`Import row ${row.rowNumber} has invalid raw values.`);
          }
          const rawValues = value as Record<string, string>;
          return { rowNumber: row.rowNumber, rawValues, ...normalizeCsvRecord(rawValues, csvContext) };
        }),
      };
    } else {
      const body = await downloadCsvObject({ teamId: input.teamId, objectKey: batch.fileObjectKey });
      const actualHash = createHash('sha256').update(body).digest('hex');
      if (actualHash !== batch.fileHash) throw new Error('CSV object hash does not match the import request.');
      parsed = parseCsvDocument(new Uint8Array(body), {
        expectedVersion: version,
        brandKits: workspaceBrandKits,
        workspaceName: csvContext.workspaceName,
      });
    }
    const existingItems = await db
      .select({ id: catalogItems.id, externalSku: catalogItems.externalSku })
      .from(catalogItems)
      .where(eq(catalogItems.teamId, input.teamId));
    const existingBySku = new Map(existingItems.map((item) => [item.externalSku, item.id]));
    const duplicateRows = new Set(findDuplicateExternalSkuRows(parsed.rows));

    await db.transaction(async (tx) => {
      await tx.delete(importRows).where(
        and(eq(importRows.teamId, input.teamId), eq(importRows.importBatchId, input.importBatchId)),
      );

      let validRows = 0;
      for (const row of parsed.rows) {
        const issues = [...parsed.issues, ...row.issues];
        const normalized = row.normalizedValues;
        if (normalized) {
          if (duplicateRows.has(row.rowNumber)) {
            addIssue(issues, 'duplicate_external_sku', 'external_sku', 'SKU is duplicated in this import file; exclude or rename every duplicate row.');
          }
          if (existingBySku.has(normalized.externalSku)) {
            addIssue(issues, 'catalog_duplicate_sku', 'external_sku', 'SKU already exists in this Workspace; update is selected by default.');
          }
        }

        const advisoryIssues = issues.filter((entry) => !isBlockingIssue(entry));
        const blockingIssues = issues.filter(isBlockingIssue);
        let archivedValues: Record<string, unknown> = {};
        if (normalized && row.readinessStatus === 'ready' && blockingIssues.length === 0) {
          archivedValues = await prepareArchivedValues({
            tx,
            teamId: input.teamId,
            userId: batch.uploadedBy,
            batchId: input.importBatchId,
            rowNumber: row.rowNumber,
            normalized,
            issues: blockingIssues,
          });
        }

        const finalIssues = [...blockingIssues, ...advisoryIssues];
        const finalStatus = blockingIssues.length === 0 && row.readinessStatus === 'ready' ? 'ready' : 'needs_fix';
        if (finalStatus === 'ready') validRows += 1;
        await tx.insert(importRows).values({
          teamId: input.teamId,
          importBatchId: input.importBatchId,
          rowNumber: row.rowNumber,
          rawValues: JSON.stringify(row.rawValues),
          normalizedValues: normalized ? JSON.stringify({ ...normalized, ...archivedValues }) : null,
          errors: JSON.stringify(finalIssues),
          status: finalStatus,
        });
      }

      const invalidRows = parsed.rows.length - validRows;
      await tx
        .update(importBatches)
        .set({
          totalRows: parsed.rows.length,
          validRows,
          invalidRows,
          status: parsed.issues.length === 0 && invalidRows === 0 && validRows > 0 ? 'ready' : 'needs_fix',
          updatedAt: new Date(),
        })
        .where(and(eq(importBatches.teamId, input.teamId), eq(importBatches.id, input.importBatchId)));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CSV worker validation failed.';
    await db.transaction(async (tx) => {
      await tx.delete(importRows).where(and(
        eq(importRows.teamId, input.teamId),
        eq(importRows.importBatchId, input.importBatchId),
      ));
      await tx.insert(importRows).values({
        teamId: input.teamId,
        importBatchId: input.importBatchId,
        rowNumber: 1,
        rawValues: '{}',
        normalizedValues: null,
        errors: JSON.stringify([{
          code: 'worker_validation_failed',
          field: 'worker',
          message: `Worker validation failed: ${message}`,
        }]),
        status: 'needs_fix',
      });
      await tx
        .update(importBatches)
        .set({
          status: 'failed',
          totalRows: 1,
          validRows: 0,
          invalidRows: 1,
          updatedAt: new Date(),
        })
        .where(and(eq(importBatches.teamId, input.teamId), eq(importBatches.id, input.importBatchId)));
    });
    throw error;
  }
}

export function validateNormalizedSku(value: unknown): ReturnType<typeof validateSkuReadiness> {
  return validateSkuReadiness(value);
}
