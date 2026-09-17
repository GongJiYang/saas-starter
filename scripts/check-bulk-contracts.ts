import assert from 'node:assert/strict';
import {
  CSV_ALL_COLUMNS,
  CSV_REQUIRED_COLUMNS,
  assertContractTransition,
  canTransition,
  creativeSpecSchema,
  evaluatePilotGate,
  getWaveStopReasons,
  isCostConfirmationValid,
  remediationPolicies,
  remediationRequestSchema,
  referenceAnalysisSchema,
  validateCsvHeaders,
  validateSkuReadiness,
} from '../lib/bulk';

const validSku = {
  externalSku: 'SKU-001',
  productName: 'Demo product',
  category: 'fragrance',
  primaryImageUrl: 'https://assets.example.com/product.png',
  primaryImageAuthorized: true,
  detailImageUrls: ['https://assets.example.com/detail.png'],
  approvedClaims: [{ text: 'Compact glass bottle', source: 'approved product sheet' }],
  prohibitedClaims: ['medical treatment'],
  mustShowElements: ['the bottle'],
  immutableElements: ['bottle shape', 'label placement'],
  targetAudience: 'mobile shoppers',
  campaignGoal: 'test product awareness',
  platform: 'tiktok',
  durationSeconds: 5,
  brandKitId: 1,
  cta: 'Learn more',
};

const validHeaders = validateCsvHeaders(CSV_ALL_COLUMNS);
assert.equal(validHeaders.valid, true);
assert.equal(validateCsvHeaders(['external_sku']).valid, false);
assert.match(validateCsvHeaders([...CSV_REQUIRED_COLUMNS, 'unknown']).unknown[0]!, /unknown/);
assert.equal(validateCsvHeaders([...CSV_REQUIRED_COLUMNS, 'external_sku']).duplicates[0], 'external_sku');

assert.equal(validateSkuReadiness(validSku).status, 'ready');
assert.equal(validateSkuReadiness({ ...validSku, primaryImageAuthorized: false }).status, 'needs_input');
assert.equal(validateSkuReadiness({ ...validSku, referenceVideoUrl: 'https://assets.example.com/reference.mp4' }).status, 'needs_input');
assert.equal(validateSkuReadiness({
  ...validSku,
  referenceVideoUrl: 'https://assets.example.com/reference.mp4',
  referenceRights: 'owned',
  referenceMode: 'owned_template',
}).status, 'ready');
assert.equal(validateSkuReadiness({
  ...validSku,
  referenceVideoUrl: 'https://assets.example.com/reference.mp4',
  referenceRights: 'inspiration_only',
  referenceMode: 'owned_template',
}).status, 'needs_input');

const validAnalysis = {
  sourceId: 'reference-1',
  version: '1.0.0',
  durationSeconds: 10,
  ratio: '9:16' as const,
  shots: [
    { fromSeconds: 0, toSeconds: 3, role: 'hook' as const, pace: 'fast' as const, cameraMovement: 'static' },
    { fromSeconds: 3, toSeconds: 10, role: 'hero' as const, pace: 'medium' as const, cameraMovement: 'slow push-in' },
  ],
  borrowedStructure: ['shot_boundaries' as const, 'pace' as const, 'cta_position' as const],
  excludedContent: ['original_script' as const, 'original_audio' as const, 'third_party_logo' as const],
};
assert.equal(referenceAnalysisSchema.parse(validAnalysis).shots.length, 2);
assert.throws(() => referenceAnalysisSchema.parse({
  ...validAnalysis,
  shots: [validAnalysis.shots[1], validAnalysis.shots[0]],
}));
assert.throws(() => referenceAnalysisSchema.parse({ ...validAnalysis, originalAudio: 'data' }));

const validSpec = {
  version: '1.0.0',
  status: 'awaiting_approval' as const,
  selectedAngle: {
    id: 'product-detail',
    label: 'Product detail',
    rationale: 'The supplied detail image supports a tactile opening.',
    evidenceIds: ['claim-1'],
    riskNotes: ['Do not redraw the label.'],
  },
  hookVariants: [
    { id: 'A' as const, openingHook: 'Start on the bottle edge.', firstShotDescription: 'Macro detail.', approvedClaimIds: ['claim-1'] },
    { id: 'B' as const, openingHook: 'Reveal the cap detail.', firstShotDescription: 'Cap macro.', approvedClaimIds: ['claim-1'] },
    { id: 'C' as const, openingHook: 'Open on a controlled reflection.', firstShotDescription: 'Glass reflection.', approvedClaimIds: ['claim-1'] },
  ],
  sharedBodyShotList: [{ id: 'body-1', description: 'Resolve to one complete bottle.', approvedClaimIds: ['claim-1'] }],
  visualTreatment: 'Controlled studio',
  pacing: 'Slow and legible',
  captionPlan: 'Programmatic captions only',
  mustShowElements: ['the bottle'],
  immutableElements: ['bottle shape'],
  forbiddenElements: ['additional product'],
  referenceBorrowedStructure: ['pace'],
  referenceExcludedContent: ['original_audio'],
  estimated: { shotCount: 5, durationSeconds: 5, maxEstimatedCostCny: 10 },
};
assert.equal(creativeSpecSchema.parse(validSpec).hookVariants.length, 3);
assert.throws(() => creativeSpecSchema.parse({ ...validSpec, status: 'approved', estimated: { ...validSpec.estimated, maxEstimatedCostCny: 0 } }));

assert.equal(canTransition('production_batch', 'draft', 'calibrating'), true);
assert.equal(canTransition('production_batch', 'completed', 'producing'), false);
assert.doesNotThrow(() => assertContractTransition('creative_spec', 'awaiting_approval', 'approved'));
assert.throws(() => assertContractTransition('creative_spec', 'approved', 'draft'));

assert.equal(evaluatePilotGate({
  batchSkuCount: 3,
  pilotSkuCount: 3,
  adoptedPilotSkuCount: 2,
  unresolvedProductFidelityFailures: 0,
}).passed, true);
assert.equal(evaluatePilotGate({
  batchSkuCount: 2,
  pilotSkuCount: 2,
  adoptedPilotSkuCount: 2,
  unresolvedProductFidelityFailures: 0,
}).passed, false);

const waveReasons = getWaveStopReasons({
  waveSize: 10,
  productFidelityFailures: [{ sku: 'SKU-001', count: 1 }, { sku: 'SKU-002', count: 1 }],
  reviewedResults: [
    { sku: 'SKU-001', rejectionCause: 'spec_mismatch' },
    { sku: 'SKU-002', rejectionCause: 'spec_mismatch' },
    { sku: 'SKU-003', rejectionCause: 'spec_mismatch' },
    { sku: 'SKU-004', rejectionCause: 'spec_mismatch' },
    { sku: 'SKU-005', rejectionCause: 'technical' },
  ],
  supplierErrorRate: 0,
  averageCostCny: 10,
  confirmedAverageCostCny: 10,
});
assert.equal(waveReasons.length, 2);

assert.equal(remediationPolicies.fidelity.customerChange, false);
assert.equal(remediationPolicies.preference_change.requiresNewSpec, true);
assert.doesNotThrow(() => remediationRequestSchema.parse({
  cause: 'technical',
  changedInputField: 'provider.retry',
}));
assert.throws(() => remediationRequestSchema.parse({ cause: 'technical' }));

const estimate = {
  specHash: 'a'.repeat(64),
  currency: 'CNY' as const,
  itemCount: 3,
  shotCount: 15,
  generatedSeconds: 75,
  retryReserveSeconds: 10,
  modelCostCny: 37.5,
  retryReserveCostCny: 5,
  storageAndServiceReserveCny: 2,
  maxEstimatedCostCny: 44.5,
};
const confirmation = {
  specHash: estimate.specHash,
  maxEstimatedCostCny: estimate.maxEstimatedCostCny,
  confirmed: true as const,
  confirmedBy: 1,
  confirmedAt: '2026-08-04T00:00:00.000Z',
};
assert.equal(isCostConfirmationValid(estimate, confirmation), true);
assert.equal(isCostConfirmationValid(estimate, { ...confirmation, specHash: 'b'.repeat(64) }), false);

console.info('Bulk product contract checks passed.');
