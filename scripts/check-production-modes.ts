import assert from 'node:assert/strict';
import { evaluatePilotGate } from '../lib/bulk/contracts';
import { validateGenerationModeSkuCount } from '../lib/bulk/workflow-contracts';
import {
  assertBulkProductionAction,
  assertProductionBatchModeTransition,
  getPausedResumeStatus,
  pausableStatusesByMode,
} from '../lib/production-batches/state';

assert.equal(validateGenerationModeSkuCount({ mode: 'single', skuCount: 1 }).valid, true);
assert.equal(validateGenerationModeSkuCount({ mode: 'bulk', skuCount: 3 }).valid, true);
const twoSku = validateGenerationModeSkuCount({ mode: 'bulk', skuCount: 2 });
assert.equal(twoSku.valid, false);
assert.deepEqual(twoSku.valid ? [] : twoSku.issue.remediations, ['add_sku', 'split_into_single_tasks']);

const singleTransitions = [
  ['draft', 'ready_for_spec'],
  ['ready_for_spec', 'ready_to_generate'],
  ['ready_to_generate', 'generating'],
  ['generating', 'review'],
  ['review', 'completed'],
] as const;
for (const [from, to] of singleTransitions) {
  assert.doesNotThrow(() => assertProductionBatchModeTransition('single', from, to));
}
assert.throws(() => assertProductionBatchModeTransition('single', 'draft', 'calibrating'));
assert.throws(() => assertProductionBatchModeTransition('single', 'ready_to_generate', 'producing'));
assert.throws(() => assertBulkProductionAction('single', 'Pilot selection'), /does not use Pilots or Waves/);
assert.throws(() => assertBulkProductionAction('single', 'Wave scheduling'), /does not use Pilots or Waves/);

const bulkTransitions = [
  ['draft', 'calibrating'],
  ['calibrating', 'pilot_review'],
  ['pilot_review', 'ready'],
  ['ready', 'producing'],
  ['producing', 'reviewing'],
  ['reviewing', 'completed'],
] as const;
for (const [from, to] of bulkTransitions) {
  assert.doesNotThrow(() => assertProductionBatchModeTransition('bulk', from, to));
}
assert.throws(() => assertProductionBatchModeTransition('bulk', 'draft', 'ready_for_spec'));
assert.equal(evaluatePilotGate({ batchSkuCount: 3, pilotSkuCount: 2, adoptedPilotSkuCount: 1, unresolvedProductFidelityFailures: 0 }).passed, false);
assert.equal(evaluatePilotGate({ batchSkuCount: 3, pilotSkuCount: 2, adoptedPilotSkuCount: 2, unresolvedProductFidelityFailures: 1 }).passed, false);
assert.equal(evaluatePilotGate({ batchSkuCount: 3, pilotSkuCount: 2, adoptedPilotSkuCount: 2, unresolvedProductFidelityFailures: 0 }).passed, true);

assert.equal(pausableStatusesByMode.single.has('review'), true);
assert.equal(pausableStatusesByMode.bulk.has('pilot_review'), true);
assert.equal(getPausedResumeStatus({ mode: 'single', currentStatus: 'paused', pausedFromStatus: 'review' }), 'review');
assert.equal(getPausedResumeStatus({ mode: 'bulk', currentStatus: 'paused', pausedFromStatus: 'pilot_review' }), 'pilot_review');
assert.throws(() => getPausedResumeStatus({ mode: 'single', currentStatus: 'paused', pausedFromStatus: 'producing' }));
assert.throws(() => getPausedResumeStatus({ mode: 'bulk', currentStatus: 'paused', pausedFromStatus: 'ready_for_spec' }));

console.log('Production mode state-machine checks passed.');
