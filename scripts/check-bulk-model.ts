import assert from 'node:assert/strict';
import {
  assetUploadSource,
  assetUploadStage,
  assetUploadStatus,
  assetUploads,
  assets,
  catalogItemAssets,
  catalogItems,
  creativeReferenceMode,
  creativeReferenceRights,
  creativeReferences,
  creativeSpecStatus,
  creativeSpecVersions,
  importBatchStatus,
  importBatches,
  importRows,
  productionBatchItemStatus,
  productionBatchItems,
  productionBatchStatus,
  productionGenerationMode,
  productionBatches,
  referenceAnalyses,
  referenceAnalysisStatus,
} from '../lib/db/schema';

const tableColumns: Array<[string, unknown, string[]]> = [
  ['assets', assets, [
    'teamId', 'uploadedBy', 'type', 'uploadSource', 'objectKey', 'contentType', 'byteSize',
  ]],
  ['asset_uploads', assetUploads, [
    'teamId', 'createdBy', 'assetId', 'source', 'status', 'stage', 'objectKey',
    'contentType', 'byteSize', 'signedAt', 'uploadedAt', 'archivedAt', 'failedAt',
    'expiresAt', 'errorCode', 'errorMessage',
  ]],
  ['catalog_items', catalogItems, [
    'teamId', 'externalSku', 'productName', 'primaryImageUrl', 'readinessStatus',
    'approvedClaims', 'prohibitedClaims', 'mustShowElements', 'immutableElements',
    'brandKitId', 'durationSeconds',
  ]],
  ['catalog_item_assets', catalogItemAssets, [
    'teamId', 'catalogItemId', 'assetId', 'purpose', 'position', 'sourceUrl',
  ]],
  ['import_batches', importBatches, [
    'teamId', 'uploadedBy', 'fileObjectKey', 'fileHash', 'templateVersion',
    'status', 'idempotencyKey',
  ]],
  ['import_rows', importRows, [
    'teamId', 'importBatchId', 'rowNumber', 'rawValues', 'normalizedValues',
    'errors', 'status',
  ]],
  ['creative_references', creativeReferences, [
    'teamId', 'catalogItemId', 'sourceId', 'objectKey', 'rights', 'mode', 'status',
  ]],
  ['reference_analyses', referenceAnalyses, [
    'teamId', 'creativeReferenceId', 'version', 'status', 'analysisSnapshot',
    'borrowedStructure', 'excludedContent',
  ]],
  ['production_batches', productionBatches, [
    'teamId', 'createdBy', 'status', 'generationMode', 'waveSize',
    'stopLossConfig', 'specHash', 'maxEstimatedCostCny', 'costConfirmation',
    'pausedFromStatus',
  ]],
  ['production_batch_items', productionBatchItems, [
    'teamId', 'productionBatchId', 'catalogItemId', 'campaignId',
    'creativeSpecVersionId', 'isPilot', 'waveNumber', 'status',
  ]],
  ['creative_spec_versions', creativeSpecVersions, [
    'teamId', 'campaignId', 'referenceAnalysisId', 'parentVersionId', 'version',
    'status', 'specHash', 'specSnapshot',
  ]],
];

for (const [tableName, table, columns] of tableColumns) {
  const actualColumns = Object.keys(table as object);
  for (const column of columns) {
    assert.ok(actualColumns.includes(column), `${tableName}.${column} is missing`);
  }
}

assert.deepEqual(importBatchStatus.enumValues, [
  'uploaded', 'validating', 'needs_fix', 'ready', 'committed', 'failed',
]);
assert.deepEqual(creativeReferenceRights.enumValues, ['owned', 'licensed', 'inspiration_only']);
assert.deepEqual(creativeReferenceMode.enumValues, ['structure', 'owned_template']);
assert.deepEqual(referenceAnalysisStatus.enumValues, ['draft', 'approved', 'rejected', 'failed']);
assert.deepEqual(assetUploadSource.enumValues, [
  'legacy', 'local_upload', 'remote_archive', 'csv_import', 'generated',
]);
assert.deepEqual(assetUploadStatus.enumValues, [
  'signed', 'uploading', 'uploaded', 'archiving', 'completed', 'failed', 'expired',
]);
assert.deepEqual(assetUploadStage.enumValues, [
  'signing', 'transfer', 'verification', 'archive', 'complete',
]);
assert.deepEqual(productionGenerationMode.enumValues, ['single', 'bulk']);
assert.deepEqual(productionBatchStatus.enumValues, [
  'draft', 'ready_for_spec', 'ready_to_generate', 'generating', 'review',
  'calibrating', 'pilot_review', 'ready', 'producing', 'paused',
  'reviewing', 'completed', 'cancelled',
]);
assert.deepEqual(productionBatchItemStatus.enumValues, [
  'pending', 'pilot', 'ready', 'queued', 'producing', 'quality_review',
  'review', 'completed', 'failed', 'excluded',
]);
assert.deepEqual(creativeSpecStatus.enumValues, [
  'draft', 'awaiting_approval', 'approved', 'rejected', 'superseded',
]);

console.log('Bulk data model checks passed.');
