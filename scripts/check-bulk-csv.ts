import assert from 'node:assert/strict';
import {
  CSV_ALL_COLUMNS,
  CSV_LEGACY_TEMPLATE_VERSION,
  CSV_MAX_ROWS,
  CSV_REQUIRED_COLUMNS,
  CSV_TEMPLATE_VERSION,
  CSV_V1_ALL_COLUMNS,
  defaultCsvImportDecision,
  validateCsvHeaders,
} from '../lib/bulk';
import {
  findDuplicateExternalSkuRows,
  parseCsvDocument,
} from '../lib/bulk/csv';
import { createCsvDocument, createCsvTemplate } from '../lib/bulk/template';

const brandKits = [
  { id: 7, name: 'P5 Acceptance Brand' },
  { id: 8, name: '中文品牌' },
];
const parseOptions = { brandKits, workspaceName: 'E CSV Acceptance Workspace' };

function validRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    external_sku: 'SKU-001',
    product_name: 'Example product',
    category: 'beauty',
    primary_image_url: 'https://assets.example.com/product.jpg',
    approved_claim_1: 'Compact glass bottle',
    approved_claim_source_1: 'Approved product sheet',
    prohibited_claim_1: 'Medical treatment claim',
    must_show_1: 'Bottle and label',
    immutable_element_1: 'Bottle shape',
    target_audience: 'Mobile shoppers',
    campaign_goal: 'Product awareness',
    platform: 'tiktok',
    duration_seconds: '5',
    brand_kit_name: 'P5 Acceptance Brand',
    cta: 'Learn more',
    ...overrides,
  };
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const template = createCsvTemplate(brandKits);
const parsedTemplate = parseCsvDocument(`\uFEFF${template}`, parseOptions);
assert.equal(parsedTemplate.version, CSV_TEMPLATE_VERSION);
assert.equal(parsedTemplate.headers.length, CSV_ALL_COLUMNS.length);
assert.equal(parsedTemplate.headers.includes('brand_kit_name'), true);
assert.equal(parsedTemplate.headers.includes('brand_kit_id'), false);
assert.equal(parsedTemplate.rows[0]?.normalizedValues?.brandKitId, 7);
assert.equal(parsedTemplate.rows[0]?.normalizedValues?.brandKitName, 'P5 Acceptance Brand');
assert.equal(parsedTemplate.rows[0]?.readinessStatus, 'ready');
assert.match(template, /available_brand_kits=P5 Acceptance Brand \| 中文品牌/);

const single = parseCsvDocument(createCsvDocument([validRow()]), parseOptions);
assert.equal(single.rows.length, 1);
assert.equal(single.rows[0]?.readinessStatus, 'ready');

const threeRows = parseCsvDocument(createCsvDocument([
  validRow({ external_sku: 'SKU-THREE-1' }),
  validRow({
    external_sku: 'SKU-THREE-2',
    product_name: '香水，夏日',
    approved_claim_1: 'Claim, with "quotes"',
    approved_claim_source_1: '批准\n资料',
    brand_kit_name: '中文品牌',
  }),
  validRow({ external_sku: 'SKU-THREE-3' }),
]), parseOptions);
assert.equal(threeRows.rows.length, 3);
assert.equal(threeRows.rows.every((row) => row.readinessStatus === 'ready' && row.issues.length === 0), true);
assert.equal(threeRows.rows[1]?.rawValues.product_name, '香水，夏日');
assert.equal(threeRows.rows[1]?.rawValues.approved_claim_1, 'Claim, with "quotes"');
assert.equal(threeRows.rows[1]?.rawValues.approved_claim_source_1, '批准\n资料');
assert.equal(threeRows.rows[1]?.normalizedValues?.brandKitId, 8);

const unknownBrand = parseCsvDocument(createCsvDocument([
  validRow({ brand_kit_name: 'Missing Brand' }),
]), parseOptions);
assert.equal(unknownBrand.rows[0]?.readinessStatus, 'needs_input');
assert.equal(unknownBrand.rows[0]?.issues.some((entry) => entry.code === 'unknown_brand_kit_name'), true);
assert.match(unknownBrand.rows[0]?.issues[0]?.message ?? '', /Missing Brand/);
assert.match(unknownBrand.rows[0]?.issues[0]?.message ?? '', /E CSV Acceptance Workspace/);
assert.match(unknownBrand.rows[0]?.issues[0]?.message ?? '', /P5 Acceptance Brand/);

const duplicateSku = parseCsvDocument(createCsvDocument([
  validRow({ external_sku: 'SKU-DUPLICATE' }),
  validRow({ external_sku: 'SKU-DUPLICATE', product_name: 'Second duplicate' }),
  validRow({ external_sku: 'SKU-UNIQUE' }),
]), parseOptions);
assert.deepEqual(findDuplicateExternalSkuRows(duplicateSku.rows), [2, 3]);
assert.equal(defaultCsvImportDecision(true), 'update');
assert.equal(defaultCsvImportDecision(false), 'create');

const legacyRecord: Record<string, string> = { ...validRow(), brand_kit_id: '7' };
delete legacyRecord.brand_kit_name;
const legacyCsv = [
  '# csv_template_version=v1',
  CSV_V1_ALL_COLUMNS.join(','),
  CSV_V1_ALL_COLUMNS.map((column) => csvEscape(legacyRecord[column] ?? '')).join(','),
].join('\n');
const rejectedLegacyUpload = parseCsvDocument(legacyCsv, parseOptions);
assert.equal(rejectedLegacyUpload.issues.some((entry) => entry.code === 'invalid_csv_template_version'), true);
const parsedLegacyAudit = parseCsvDocument(legacyCsv, {
  ...parseOptions,
  expectedVersion: CSV_LEGACY_TEMPLATE_VERSION,
});
assert.equal(parsedLegacyAudit.rows[0]?.readinessStatus, 'ready');
assert.equal(parsedLegacyAudit.rows[0]?.normalizedValues?.brandKitName, 'P5 Acceptance Brand');

assert.equal(validateCsvHeaders(CSV_REQUIRED_COLUMNS.slice(0, -1)).valid, false);
assert.equal(CSV_MAX_ROWS, 1000);

console.log('CSV v2 Workspace mapping checks passed.');
