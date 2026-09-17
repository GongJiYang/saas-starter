import assert from 'node:assert/strict';
import {
  MAX_BULK_PILOT_SKU_COUNT,
  MIN_BULK_GENERATION_SKU_COUNT,
  SINGLE_GENERATION_SKU_COUNT,
  assertNoRawWorkflowIds,
  bulkGenerationFlow,
  createWorkflowError,
  customerWorkflowCommandSchema,
  generationFlowByMode,
  generationModeSchema,
  resolveWorkflowNextAction,
  singleGenerationFlow,
  validateGenerationModeSkuCount,
  workflowContextSchema,
  workflowErrorResponseSchema,
  workspaceEntitySelectionSchema,
  type WorkflowContext,
} from '../lib/bulk';

assert.equal(generationModeSchema.parse('single'), 'single');
assert.equal(generationModeSchema.parse('bulk'), 'bulk');
assert.throws(() => generationModeSchema.parse('batch'));

assert.equal(singleGenerationFlow.skuCount.exact, SINGLE_GENERATION_SKU_COUNT);
assert.equal(singleGenerationFlow.usesPilotGate, false);
assert.equal(singleGenerationFlow.usesWaves, false);
assert.equal(singleGenerationFlow.completesOnAdoption, true);
assert.deepEqual(singleGenerationFlow.stages, ['sku', 'campaign', 'spec', 'cost', 'generation', 'qa', 'review', 'complete']);
assert.equal(bulkGenerationFlow.skuCount.minimum, MIN_BULK_GENERATION_SKU_COUNT);
assert.equal(bulkGenerationFlow.pilotSkuCount.maximum, MAX_BULK_PILOT_SKU_COUNT);
assert.equal(bulkGenerationFlow.minimumAdoptedPilotSkuCount, 2);
assert.equal(bulkGenerationFlow.usesPilotGate, true);
assert.equal(bulkGenerationFlow.usesWaves, true);
assert.equal(generationFlowByMode.single, singleGenerationFlow);
assert.equal(generationFlowByMode.bulk, bulkGenerationFlow);

assert.equal(validateGenerationModeSkuCount({ mode: 'single', skuCount: 1 }).valid, true);
const emptySingle = validateGenerationModeSkuCount({ mode: 'single', skuCount: 0 });
assert.equal(emptySingle.valid, false);
assert.deepEqual(emptySingle.issue?.remediations, ['add_sku']);
const crowdedSingle = validateGenerationModeSkuCount({ mode: 'single', skuCount: 2 });
assert.equal(crowdedSingle.valid, false);
assert.deepEqual(crowdedSingle.issue?.remediations, ['remove_sku', 'use_bulk']);
const oneBulk = validateGenerationModeSkuCount({ mode: 'bulk', skuCount: 1 });
assert.equal(oneBulk.valid, false);
assert.deepEqual(oneBulk.issue?.remediations, ['use_single', 'add_sku']);
const twoBulk = validateGenerationModeSkuCount({ mode: 'bulk', skuCount: 2 });
assert.equal(twoBulk.valid, false);
assert.deepEqual(twoBulk.issue?.remediations, ['add_sku', 'split_into_single_tasks']);
assert.equal(validateGenerationModeSkuCount({ mode: 'bulk', skuCount: 3 }).valid, true);

const singleBase: WorkflowContext = {
  mode: 'single',
  skuCount: 1,
  lifecycle: 'active',
  campaignState: 'ready',
  specState: 'approved',
  costState: 'confirmed',
  generationState: 'succeeded',
  qualityState: 'passed',
  reviewState: 'adopted',
  pilotGateState: 'not_applicable',
  waveState: 'not_applicable',
};

const bulkBase: WorkflowContext = {
  mode: 'bulk',
  skuCount: 3,
  lifecycle: 'active',
  campaignState: 'ready',
  specState: 'approved',
  costState: 'confirmed',
  generationState: 'succeeded',
  qualityState: 'passed',
  reviewState: 'adopted',
  pilotGateState: 'pending',
  waveState: 'unassigned',
};

assert.throws(() => workflowContextSchema.parse({ ...singleBase, pilotGateState: 'pending' }));
assert.throws(() => workflowContextSchema.parse({ ...singleBase, waveState: 'unassigned' }));
assert.throws(() => workflowContextSchema.parse({ ...bulkBase, pilotGateState: 'not_applicable' }));
assert.throws(() => workflowContextSchema.parse({ ...bulkBase, waveState: 'not_applicable' }));

assert.equal(resolveWorkflowNextAction({ ...singleBase, skuCount: 2 }).action, 'select_sku');
assert.equal(resolveWorkflowNextAction({ ...singleBase, skuCount: 2 }).blockers[0]?.code, 'single_requires_one_sku');
assert.equal(resolveWorkflowNextAction({ ...singleBase, lifecycle: 'cancelled' }).action, null);
assert.equal(resolveWorkflowNextAction({ ...singleBase, lifecycle: 'paused' }).action, 'resume_task');
assert.equal(resolveWorkflowNextAction({ ...singleBase, campaignState: 'missing' }).action, 'create_campaign');
assert.equal(resolveWorkflowNextAction({ ...singleBase, specState: 'missing' }).action, 'create_spec');
assert.equal(resolveWorkflowNextAction({ ...singleBase, specState: 'draft' }).action, 'submit_spec');
assert.equal(resolveWorkflowNextAction({ ...singleBase, specState: 'awaiting_approval' }).action, 'approve_spec');
assert.equal(resolveWorkflowNextAction({ ...singleBase, costState: 'missing' }).action, 'estimate_cost');
assert.equal(resolveWorkflowNextAction({ ...singleBase, costState: 'estimated' }).action, 'confirm_cost');
assert.equal(resolveWorkflowNextAction({ ...singleBase, generationState: 'not_started' }).action, 'schedule_generation');
const generating = resolveWorkflowNextAction({ ...singleBase, generationState: 'generating' });
assert.equal(generating.action, 'wait_generation');
assert.deepEqual(generating.availableActions, ['wait_generation', 'pause_task', 'cancel_task']);
assert.equal(resolveWorkflowNextAction({ ...singleBase, generationState: 'failed' }).action, 'retry_generation');
assert.equal(resolveWorkflowNextAction({ ...singleBase, qualityState: 'pending' }).action, 'wait_quality');
assert.equal(resolveWorkflowNextAction({ ...singleBase, qualityState: 'failed' }).action, 'remediate_quality');
assert.equal(resolveWorkflowNextAction({ ...singleBase, reviewState: 'pending' }).action, 'review_output');
assert.equal(resolveWorkflowNextAction({ ...singleBase, reviewState: 'not_adopted' }).action, 'revise_output');
const singleComplete = resolveWorkflowNextAction(singleBase);
assert.equal(singleComplete.action, 'view_result');
assert.equal(singleComplete.terminal, true);

assert.equal(resolveWorkflowNextAction(bulkBase).action, 'evaluate_pilot');
assert.equal(resolveWorkflowNextAction({ ...bulkBase, pilotGateState: 'failed' }).action, 'remediate_pilot');
assert.equal(resolveWorkflowNextAction({ ...bulkBase, pilotGateState: 'passed' }).action, 'assign_waves');
assert.equal(resolveWorkflowNextAction({ ...bulkBase, pilotGateState: 'passed', waveState: 'assigned' }).action, 'schedule_wave');
assert.equal(resolveWorkflowNextAction({ ...bulkBase, pilotGateState: 'passed', waveState: 'producing' }).action, 'wait_wave');
assert.equal(resolveWorkflowNextAction({ ...bulkBase, pilotGateState: 'passed', waveState: 'reviewing' }).action, 'review_output');
const bulkComplete = resolveWorkflowNextAction({ ...bulkBase, pilotGateState: 'passed', waveState: 'completed' });
assert.equal(bulkComplete.action, 'view_result');
assert.equal(bulkComplete.terminal, true);

assert.doesNotThrow(() => workspaceEntitySelectionSchema.parse({ entity: 'brand_kit', name: 'BREWFOG' }));
assert.doesNotThrow(() => workspaceEntitySelectionSchema.parse({ entity: 'catalog_item', externalSku: 'BF-MINI-BLACK' }));
assert.doesNotThrow(() => workspaceEntitySelectionSchema.parse({ entity: 'campaign', taskName: 'one-5s', externalSku: 'BF-MINI-BLACK' }));
assert.doesNotThrow(() => workspaceEntitySelectionSchema.parse({ entity: 'creative_spec', taskName: 'one-5s', externalSku: 'BF-MINI-BLACK', version: '1.0.0' }));
assert.throws(() => workspaceEntitySelectionSchema.parse({ entity: 'brand_kit', brandKitId: 14 }));

assert.doesNotThrow(() => assertNoRawWorkflowIds({ externalSku: 'BF-MINI-BLACK', nested: { taskName: 'one-5s' } }));
assert.throws(() => assertNoRawWorkflowIds({ payload: { itemId: 22 } }), /payload\.itemId/);
assert.throws(() => customerWorkflowCommandSchema.parse({ action: 'create_spec', payload: { campaignId: 28 } }));
assert.doesNotThrow(() => customerWorkflowCommandSchema.parse({
  action: 'create_spec',
  selection: { entity: 'campaign', taskName: 'one-5s', externalSku: 'BF-MINI-BLACK' },
  payload: {},
}));

const workflowError = createWorkflowError({
  code: 'skill_ineligible',
  message: 'No active Skill supports 10 second output.',
  field: 'durationSeconds',
  details: { requestedDurationSeconds: 10 },
  remediations: [
    { action: 'edit_sku', label: 'Change output duration to 5 seconds', target: 'catalog' },
    { action: 'create_private_skill', label: 'Create a compatible private Skill', target: 'skill' },
  ],
});
assert.equal(workflowError.error.code, 'skill_ineligible');
assert.equal(workflowError.error.remediations.length, 2);
assert.doesNotThrow(() => workflowErrorResponseSchema.parse(workflowError));
assert.throws(() => workflowErrorResponseSchema.parse({ error: { code: 'unknown', message: 'bad' } }));

console.info('Customer workflow contracts passed.');
