import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

export const generationModeSchema = z.enum(['single', 'bulk']);
export type GenerationMode = z.infer<typeof generationModeSchema>;

export const SINGLE_GENERATION_SKU_COUNT = 1;
export const MIN_BULK_GENERATION_SKU_COUNT = 3;
export const MAX_BULK_PILOT_SKU_COUNT = 3;

export const workflowStageSchema = z.enum([
  'sku',
  'campaign',
  'spec',
  'cost',
  'generation',
  'qa',
  'review',
  'pilot_gate',
  'wave',
  'complete',
]);
export type WorkflowStage = z.infer<typeof workflowStageSchema>;

export const workflowActionSchema = z.enum([
  'select_sku',
  'add_product',
  'upload_asset',
  'edit_sku',
  'create_campaign',
  'create_spec',
  'submit_spec',
  'approve_spec',
  'estimate_cost',
  'confirm_cost',
  'schedule_generation',
  'wait_generation',
  'retry_generation',
  'wait_quality',
  'remediate_quality',
  'review_output',
  'revise_output',
  'evaluate_pilot',
  'remediate_pilot',
  'assign_waves',
  'schedule_wave',
  'wait_wave',
  'create_private_skill',
  'pause_task',
  'resume_task',
  'cancel_task',
  'view_result',
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export const singleGenerationFlow = {
  mode: 'single',
  skuCount: { exact: SINGLE_GENERATION_SKU_COUNT },
  usesPilotGate: false,
  usesWaves: false,
  completesOnAdoption: true,
  stages: ['sku', 'campaign', 'spec', 'cost', 'generation', 'qa', 'review', 'complete'],
} as const;

export const bulkGenerationFlow = {
  mode: 'bulk',
  skuCount: { minimum: MIN_BULK_GENERATION_SKU_COUNT },
  pilotSkuCount: { minimum: 1, maximum: MAX_BULK_PILOT_SKU_COUNT },
  minimumAdoptedPilotSkuCount: 2,
  usesPilotGate: true,
  usesWaves: true,
  completesOnAdoption: false,
  stages: ['sku', 'campaign', 'spec', 'cost', 'generation', 'qa', 'review', 'pilot_gate', 'wave', 'complete'],
} as const;

export const generationFlowByMode = {
  single: singleGenerationFlow,
  bulk: bulkGenerationFlow,
} as const;

export const generationModeSkuCountRemediationSchema = z.enum([
  'add_sku',
  'remove_sku',
  'use_single',
  'use_bulk',
  'split_into_single_tasks',
]);

const generationModeSkuCountIssueSchema = z.object({
  code: z.enum(['single_requires_one_sku', 'bulk_requires_three_sku']),
  message: nonEmptyString,
  remediations: z.array(generationModeSkuCountRemediationSchema).min(1),
}).strict();

export const generationModeSkuCountResultSchema = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(true),
    mode: generationModeSchema,
    skuCount: z.number().int().nonnegative(),
    issue: z.null(),
  }).strict(),
  z.object({
    valid: z.literal(false),
    mode: generationModeSchema,
    skuCount: z.number().int().nonnegative(),
    issue: generationModeSkuCountIssueSchema,
  }).strict(),
]);
export type GenerationModeSkuCountResult = z.infer<typeof generationModeSkuCountResultSchema>;

export function validateGenerationModeSkuCount(input: {
  mode: GenerationMode;
  skuCount: number;
}): GenerationModeSkuCountResult {
  const mode = generationModeSchema.parse(input.mode);
  const skuCount = z.number().int().nonnegative().parse(input.skuCount);
  if (mode === 'single' && skuCount !== SINGLE_GENERATION_SKU_COUNT) {
    return generationModeSkuCountResultSchema.parse({
      valid: false,
      mode,
      skuCount,
      issue: {
        code: 'single_requires_one_sku',
        message: 'Single video generation requires exactly one SKU.',
        remediations: skuCount === 0 ? ['add_sku'] : ['remove_sku', 'use_bulk'],
      },
    });
  }
  if (mode === 'bulk' && skuCount < MIN_BULK_GENERATION_SKU_COUNT) {
    const remediations = skuCount === 1
      ? ['use_single', 'add_sku'] as const
      : skuCount === 2
        ? ['add_sku', 'split_into_single_tasks'] as const
        : ['add_sku'] as const;
    return generationModeSkuCountResultSchema.parse({
      valid: false,
      mode,
      skuCount,
      issue: {
        code: 'bulk_requires_three_sku',
        message: 'Batch production requires at least three SKU.',
        remediations,
      },
    });
  }
  return generationModeSkuCountResultSchema.parse({ valid: true, mode, skuCount, issue: null });
}

export const workflowContextSchema = z.object({
  mode: generationModeSchema,
  skuCount: z.number().int().nonnegative(),
  lifecycle: z.enum(['active', 'paused', 'cancelled']).default('active'),
  campaignState: z.enum(['missing', 'ready']),
  specState: z.enum(['missing', 'draft', 'awaiting_approval', 'approved', 'rejected']),
  costState: z.enum(['missing', 'estimated', 'confirmed']),
  generationState: z.enum(['not_started', 'queued', 'generating', 'succeeded', 'failed']),
  qualityState: z.enum(['not_started', 'pending', 'passed', 'failed']),
  reviewState: z.enum(['not_started', 'pending', 'adopted', 'not_adopted']),
  pilotGateState: z.enum(['not_applicable', 'pending', 'passed', 'failed']),
  waveState: z.enum(['not_applicable', 'unassigned', 'assigned', 'producing', 'reviewing', 'completed', 'paused']),
}).strict().superRefine((value, context) => {
  if (value.mode === 'single' && value.pilotGateState !== 'not_applicable') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pilotGateState'], message: 'Single generation does not use a Pilot gate.' });
  }
  if (value.mode === 'single' && value.waveState !== 'not_applicable') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['waveState'], message: 'Single generation does not use Waves.' });
  }
  if (value.mode === 'bulk' && value.pilotGateState === 'not_applicable') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pilotGateState'], message: 'Batch production requires a Pilot gate.' });
  }
  if (value.mode === 'bulk' && value.waveState === 'not_applicable') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['waveState'], message: 'Batch production requires Wave state.' });
  }
});
export type WorkflowContext = z.infer<typeof workflowContextSchema>;

export const workflowTargetSchema = z.enum([
  'catalog',
  'task',
  'campaign',
  'spec',
  'cost',
  'generation',
  'review',
  'skill',
  'result',
]);

export const workflowRemediationSchema = z.object({
  action: workflowActionSchema,
  label: nonEmptyString,
  target: workflowTargetSchema,
}).strict();
export type WorkflowRemediation = z.infer<typeof workflowRemediationSchema>;

export const workflowBlockerSchema = z.object({
  code: nonEmptyString,
  message: nonEmptyString,
  remediations: z.array(workflowRemediationSchema).min(1),
}).strict();
export type WorkflowBlocker = z.infer<typeof workflowBlockerSchema>;

export const workflowNextActionSchema = z.object({
  stage: workflowStageSchema,
  action: workflowActionSchema.nullable(),
  kind: z.enum(['user', 'system_wait', 'terminal']),
  label: nonEmptyString,
  target: workflowTargetSchema,
  availableActions: z.array(workflowActionSchema),
  blockers: z.array(workflowBlockerSchema),
  terminal: z.boolean(),
}).strict();
export type WorkflowNextAction = z.infer<typeof workflowNextActionSchema>;

type ActionMetadata = {
  stage: WorkflowStage;
  kind: 'user' | 'system_wait' | 'terminal';
  label: string;
  target: z.infer<typeof workflowTargetSchema>;
};

const actionMetadata: Record<WorkflowAction, ActionMetadata> = {
  select_sku: { stage: 'sku', kind: 'user', label: 'Select SKU', target: 'catalog' },
  add_product: { stage: 'sku', kind: 'user', label: 'Add product', target: 'catalog' },
  upload_asset: { stage: 'sku', kind: 'user', label: 'Upload product image', target: 'catalog' },
  edit_sku: { stage: 'sku', kind: 'user', label: 'Complete product information', target: 'catalog' },
  create_campaign: { stage: 'campaign', kind: 'user', label: 'Create Campaign', target: 'campaign' },
  create_spec: { stage: 'spec', kind: 'user', label: 'Create Creative Spec', target: 'spec' },
  submit_spec: { stage: 'spec', kind: 'user', label: 'Submit Creative Spec', target: 'spec' },
  approve_spec: { stage: 'spec', kind: 'user', label: 'Approve Creative Spec', target: 'spec' },
  estimate_cost: { stage: 'cost', kind: 'user', label: 'Estimate cost', target: 'cost' },
  confirm_cost: { stage: 'cost', kind: 'user', label: 'Confirm cost', target: 'cost' },
  schedule_generation: { stage: 'generation', kind: 'user', label: 'Generate video', target: 'generation' },
  wait_generation: { stage: 'generation', kind: 'system_wait', label: 'Video generation is running', target: 'generation' },
  retry_generation: { stage: 'generation', kind: 'user', label: 'Retry video generation', target: 'generation' },
  wait_quality: { stage: 'qa', kind: 'system_wait', label: 'Quality checks are running', target: 'generation' },
  remediate_quality: { stage: 'qa', kind: 'user', label: 'Resolve quality failures', target: 'generation' },
  review_output: { stage: 'review', kind: 'user', label: 'Review generated video', target: 'review' },
  revise_output: { stage: 'review', kind: 'user', label: 'Resolve review feedback', target: 'review' },
  evaluate_pilot: { stage: 'pilot_gate', kind: 'user', label: 'Evaluate Pilot', target: 'task' },
  remediate_pilot: { stage: 'pilot_gate', kind: 'user', label: 'Resolve Pilot blockers', target: 'task' },
  assign_waves: { stage: 'wave', kind: 'user', label: 'Assign production Waves', target: 'task' },
  schedule_wave: { stage: 'wave', kind: 'user', label: 'Schedule next Wave', target: 'generation' },
  wait_wave: { stage: 'wave', kind: 'system_wait', label: 'Production Wave is running', target: 'generation' },
  create_private_skill: { stage: 'spec', kind: 'user', label: 'Create compatible private Skill', target: 'skill' },
  pause_task: { stage: 'generation', kind: 'user', label: 'Pause task', target: 'task' },
  resume_task: { stage: 'generation', kind: 'user', label: 'Resume task', target: 'task' },
  cancel_task: { stage: 'complete', kind: 'user', label: 'Cancel task', target: 'task' },
  view_result: { stage: 'complete', kind: 'terminal', label: 'View completed result', target: 'result' },
};

function actionResult(input: {
  action: WorkflowAction | null;
  blockers?: WorkflowBlocker[];
  availableActions?: WorkflowAction[];
  terminal?: boolean;
  label?: string;
  stage?: WorkflowStage;
  target?: z.infer<typeof workflowTargetSchema>;
}): WorkflowNextAction {
  if (input.action === null) {
    return workflowNextActionSchema.parse({
      stage: input.stage ?? 'complete',
      action: null,
      kind: 'terminal',
      label: input.label ?? 'No further action',
      target: input.target ?? 'result',
      availableActions: input.availableActions ?? [],
      blockers: input.blockers ?? [],
      terminal: input.terminal ?? true,
    });
  }
  const metadata = actionMetadata[input.action];
  const availableActions = input.availableActions ?? [input.action];
  return workflowNextActionSchema.parse({
    ...metadata,
    stage: input.stage ?? metadata.stage,
    action: input.action,
    label: input.label ?? metadata.label,
    target: input.target ?? metadata.target,
    availableActions,
    blockers: input.blockers ?? [],
    terminal: input.terminal ?? metadata.kind === 'terminal',
  });
}

function countBlocker(result: Exclude<GenerationModeSkuCountResult, { valid: true }>): WorkflowBlocker {
  const remediationByCode: Record<z.infer<typeof generationModeSkuCountRemediationSchema>, WorkflowRemediation> = {
    add_sku: { action: 'select_sku', label: 'Add another SKU', target: 'catalog' },
    remove_sku: { action: 'select_sku', label: 'Keep exactly one SKU', target: 'catalog' },
    use_single: { action: 'select_sku', label: 'Switch to Single video', target: 'task' },
    use_bulk: { action: 'select_sku', label: 'Switch to Batch production', target: 'task' },
    split_into_single_tasks: { action: 'select_sku', label: 'Create two Single video tasks', target: 'task' },
  };
  return workflowBlockerSchema.parse({
    code: result.issue.code,
    message: result.issue.message,
    remediations: result.issue.remediations.map((code) => remediationByCode[code]),
  });
}

function activeActions(primary: WorkflowAction): WorkflowAction[] {
  if (['wait_generation', 'wait_wave'].includes(primary)) return [primary, 'pause_task', 'cancel_task'];
  if (primary === 'view_result') return ['view_result'];
  return [primary, 'cancel_task'];
}

export function resolveWorkflowNextAction(input: unknown): WorkflowNextAction {
  const context = workflowContextSchema.parse(input);
  const skuCountResult = validateGenerationModeSkuCount({ mode: context.mode, skuCount: context.skuCount });
  if (!skuCountResult.valid) {
    return actionResult({
      action: 'select_sku',
      blockers: [countBlocker(skuCountResult)],
      availableActions: ['select_sku', 'cancel_task'],
    });
  }
  if (context.lifecycle === 'cancelled') {
    return actionResult({ action: null, label: 'Task cancelled', terminal: true });
  }
  if (context.lifecycle === 'paused' || context.waveState === 'paused') {
    return actionResult({ action: 'resume_task', availableActions: ['resume_task', 'cancel_task'] });
  }
  if (context.campaignState === 'missing') return actionResult({ action: 'create_campaign', availableActions: activeActions('create_campaign') });
  if (context.specState === 'missing' || context.specState === 'rejected') return actionResult({ action: 'create_spec', availableActions: activeActions('create_spec') });
  if (context.specState === 'draft') return actionResult({ action: 'submit_spec', availableActions: activeActions('submit_spec') });
  if (context.specState === 'awaiting_approval') return actionResult({ action: 'approve_spec', availableActions: activeActions('approve_spec') });
  if (context.costState === 'missing') return actionResult({ action: 'estimate_cost', availableActions: activeActions('estimate_cost') });
  if (context.costState === 'estimated') return actionResult({ action: 'confirm_cost', availableActions: activeActions('confirm_cost') });
  if (context.generationState === 'not_started') return actionResult({ action: 'schedule_generation', availableActions: activeActions('schedule_generation') });
  if (context.generationState === 'queued' || context.generationState === 'generating') return actionResult({ action: 'wait_generation', availableActions: activeActions('wait_generation') });
  if (context.generationState === 'failed') return actionResult({ action: 'retry_generation', availableActions: activeActions('retry_generation') });
  if (context.qualityState === 'not_started' || context.qualityState === 'pending') return actionResult({ action: 'wait_quality', availableActions: activeActions('wait_quality') });
  if (context.qualityState === 'failed') return actionResult({ action: 'remediate_quality', availableActions: activeActions('remediate_quality') });
  if (context.reviewState === 'not_started' || context.reviewState === 'pending') return actionResult({ action: 'review_output', availableActions: activeActions('review_output') });
  if (context.reviewState === 'not_adopted') return actionResult({ action: 'revise_output', availableActions: activeActions('revise_output') });
  if (context.mode === 'single') return actionResult({ action: 'view_result', terminal: true });
  if (context.pilotGateState === 'pending') return actionResult({ action: 'evaluate_pilot', availableActions: activeActions('evaluate_pilot') });
  if (context.pilotGateState === 'failed') return actionResult({ action: 'remediate_pilot', availableActions: activeActions('remediate_pilot') });
  if (context.waveState === 'unassigned') return actionResult({ action: 'assign_waves', availableActions: activeActions('assign_waves') });
  if (context.waveState === 'assigned') return actionResult({ action: 'schedule_wave', availableActions: activeActions('schedule_wave') });
  if (context.waveState === 'producing') return actionResult({ action: 'wait_wave', availableActions: activeActions('wait_wave') });
  if (context.waveState === 'reviewing') return actionResult({ action: 'review_output', availableActions: activeActions('review_output') });
  return actionResult({ action: 'view_result', terminal: true });
}

export const workspaceEntitySelectionSchema = z.discriminatedUnion('entity', [
  z.object({ entity: z.literal('brand_kit'), name: nonEmptyString }).strict(),
  z.object({ entity: z.literal('catalog_item'), externalSku: nonEmptyString }).strict(),
  z.object({ entity: z.literal('campaign'), taskName: nonEmptyString, externalSku: nonEmptyString }).strict(),
  z.object({ entity: z.literal('creative_spec'), taskName: nonEmptyString, externalSku: nonEmptyString, version: nonEmptyString }).strict(),
]);
export type WorkspaceEntitySelection = z.infer<typeof workspaceEntitySelectionSchema>;

export const FORBIDDEN_CUSTOMER_WORKFLOW_ID_KEYS = [
  'teamId',
  'workspaceId',
  'brandKitId',
  'assetId',
  'catalogItemId',
  'productionBatchId',
  'productionBatchItemId',
  'itemId',
  'campaignId',
  'creativeSpecVersionId',
  'specId',
  'shotSkillVersionId',
  'videoJobId',
] as const;

function findForbiddenIdPath(value: unknown, path: readonly string[] = []): string[] | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = findForbiddenIdPath(item, [...path, String(index)]);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_CUSTOMER_WORKFLOW_ID_KEYS as readonly string[]).includes(key)) return [...path, key];
    const result = findForbiddenIdPath(item, [...path, key]);
    if (result) return result;
  }
  return null;
}

export function assertNoRawWorkflowIds(value: unknown): void {
  const path = findForbiddenIdPath(value);
  if (path) throw new Error(`Customer workflow commands cannot contain raw database IDs: ${path.join('.')}`);
}

export const customerWorkflowCommandSchema = z.object({
  action: workflowActionSchema,
  selection: workspaceEntitySelectionSchema.optional(),
  payload: z.record(z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  const path = findForbiddenIdPath(value);
  if (path) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'Customer workflow commands cannot contain raw database IDs.',
    });
  }
});

export const workflowErrorCodeSchema = z.enum([
  'generation_mode_sku_count',
  'workspace_entity_not_found',
  'workspace_entity_forbidden',
  'workflow_action_blocked',
  'skill_ineligible',
  'asset_upload_failed',
  'spec_not_approved',
  'cost_confirmation_stale',
  'invalid_transition',
]);

const safeErrorDetailValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const workflowErrorResponseSchema = z.object({
  error: z.object({
    code: workflowErrorCodeSchema,
    message: nonEmptyString,
    field: nonEmptyString.optional(),
    details: z.record(safeErrorDetailValueSchema).default({}),
    remediations: z.array(workflowRemediationSchema).default([]),
  }).strict(),
}).strict();
export type WorkflowErrorResponse = z.infer<typeof workflowErrorResponseSchema>;

export function createWorkflowError(input: WorkflowErrorResponse['error']): WorkflowErrorResponse {
  return workflowErrorResponseSchema.parse({ error: input });
}
