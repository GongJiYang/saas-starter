import assert from 'node:assert/strict';
import {
  assertContractTransition,
  batchCostEstimateSchema,
  evaluatePilotGate,
  getWaveStopReasons,
  isCostConfirmationValid,
} from '../lib/bulk/contracts';

const estimate = batchCostEstimateSchema.parse({
  specHash: 'a'.repeat(64),
  currency: 'CNY',
  itemCount: 3,
  shotCount: 24,
  generatedSeconds: 15,
  retryReserveSeconds: 3,
  modelCostCny: 30,
  retryReserveCostCny: 6,
  storageAndServiceReserveCny: 3,
  maxEstimatedCostCny: 39,
});
const confirmation = {
  specHash: estimate.specHash,
  maxEstimatedCostCny: estimate.maxEstimatedCostCny,
  confirmed: true as const,
  confirmedBy: 1,
  confirmedAt: new Date().toISOString(),
};
assert.equal(isCostConfirmationValid(estimate, confirmation), true);
assert.equal(isCostConfirmationValid(estimate, { ...confirmation, maxEstimatedCostCny: 40 }), false);
assert.deepEqual(evaluatePilotGate({ batchSkuCount: 3, pilotSkuCount: 3, adoptedPilotSkuCount: 2, unresolvedProductFidelityFailures: 0 }), { passed: true, reasons: [] });
assert.equal(evaluatePilotGate({ batchSkuCount: 3, pilotSkuCount: 3, adoptedPilotSkuCount: 1, unresolvedProductFidelityFailures: 0 }).passed, false);
assert.deepEqual(getWaveStopReasons({
  waveSize: 10,
  productFidelityFailures: [{ sku: 'A', count: 1 }, { sku: 'B', count: 1 }],
  reviewedResults: [],
  supplierErrorRate: 0,
  averageCostCny: 1,
  confirmedAverageCostCny: 1,
}).length, 1);
assert.equal(getWaveStopReasons({
  waveSize: 10,
  productFidelityFailures: [],
  reviewedResults: Array.from({ length: 5 }, (_, index) => ({ sku: `SKU-${index}`, rejectionCause: 'spec_mismatch' })),
  supplierErrorRate: 0,
  averageCostCny: 1,
  confirmedAverageCostCny: 1,
}).length, 1);
assert.doesNotThrow(() => assertContractTransition('production_batch', 'draft', 'calibrating'));
assert.throws(() => assertContractTransition('production_batch', 'draft', 'producing'));
console.log('Production Batch checks passed.');
