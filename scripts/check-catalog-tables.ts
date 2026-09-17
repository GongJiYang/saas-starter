import assert from 'node:assert/strict';
import { csvColumns } from '../lib/bulk/csv';
import { catalogItems, productionBatchItems } from '../lib/db/schema';

for (const required of ['external_sku', 'product_name', 'category', 'primary_image_url', 'approved_claim_1', 'target_audience', 'campaign_goal', 'platform', 'duration_seconds', 'brand_kit_name', 'cta']) assert.ok(csvColumns.includes(required), `${required} must remain in the v2 CSV template`);
for (const field of ['teamId', 'externalSku', 'productName', 'readinessStatus', 'brandKitId', 'category', 'updatedAt']) assert.ok(Object.keys(catalogItems).includes(field), `Catalog field ${field} is missing`);
for (const field of ['productionBatchId', 'catalogItemId', 'status', 'isPilot', 'waveNumber', 'lastError']) assert.ok(Object.keys(productionBatchItems).includes(field), `Batch field ${field} is missing`);
assert.equal(Math.min(50, 500), 50);
console.log('Catalog and Batch table checks passed.');
