import type { GenerationMode } from '@/lib/bulk/workflow-contracts';
import { DomainError } from '@/lib/errors/domain';
import {
  canTransition,
  productionBatchStatusSchema,
} from '@/lib/bulk/contracts';

export type ProductionBatchStatus = typeof productionBatchStatusSchema._type;

export const singleProductionStatuses = [
  'draft',
  'ready_for_spec',
  'ready_to_generate',
  'generating',
  'review',
  'paused',
  'completed',
  'cancelled',
] as const satisfies readonly ProductionBatchStatus[];

export const bulkProductionStatuses = [
  'draft',
  'calibrating',
  'pilot_review',
  'ready',
  'producing',
  'paused',
  'reviewing',
  'completed',
  'cancelled',
] as const satisfies readonly ProductionBatchStatus[];

const statusesByMode = {
  single: new Set<ProductionBatchStatus>(singleProductionStatuses),
  bulk: new Set<ProductionBatchStatus>(bulkProductionStatuses),
} satisfies Record<GenerationMode, ReadonlySet<ProductionBatchStatus>>;

export const pausableStatusesByMode = {
  single: new Set<ProductionBatchStatus>(['ready_for_spec', 'ready_to_generate', 'generating', 'review']),
  bulk: new Set<ProductionBatchStatus>(['calibrating', 'pilot_review', 'ready', 'producing', 'reviewing']),
} satisfies Record<GenerationMode, ReadonlySet<ProductionBatchStatus>>;

export function assertProductionBatchModeStatus(
  mode: GenerationMode,
  status: string,
): asserts status is ProductionBatchStatus {
  const parsed = productionBatchStatusSchema.parse(status);
  if (!statusesByMode[mode].has(parsed)) {
    throw new Error(`${mode === 'single' ? 'Single' : 'Bulk'} production does not support status ${parsed}.`);
  }
}

export function assertProductionBatchModeTransition(
  mode: GenerationMode,
  from: string,
  to: string,
): asserts to is ProductionBatchStatus {
  assertProductionBatchModeStatus(mode, from);
  assertProductionBatchModeStatus(mode, to);
  if (!canTransition('production_batch', from, to)) {
    throw new DomainError('invalid_transition', {
      message: `The task is currently ${from.replaceAll('_', ' ')} and cannot move directly to ${to.replaceAll('_', ' ')}. Refresh the task and use its highlighted Next action.`,
      details: { currentStatus: from, requestedStatus: to, nextAction: 'Use the highlighted Next action' },
    });
  }
}

export function assertBulkProductionAction(mode: GenerationMode, action: string): void {
  if (mode !== 'bulk') {
    throw new Error(`${action} is not supported for Single production. Single production does not use Pilots or Waves.`);
  }
}

export function getPausedResumeStatus(input: {
  mode: GenerationMode;
  currentStatus: string;
  pausedFromStatus: string | null;
}): ProductionBatchStatus {
  if (input.currentStatus !== 'paused') {
    throw new DomainError('invalid_transition', {
      message: `The task is currently ${input.currentStatus.replaceAll('_', ' ')}. Resume is available only while paused; use the highlighted Next action.`,
      details: { currentStatus: input.currentStatus, requiredStatus: 'paused', nextAction: 'Use the highlighted Next action' },
    });
  }
  if (!input.pausedFromStatus) {
    throw new DomainError('invalid_transition', {
      message: 'The paused task has no safe resume target. Refresh it and use the highlighted Next action.',
      details: { currentStatus: 'paused', requiredStatus: 'recorded resume target', nextAction: 'Refresh task status' },
    });
  }
  const target = productionBatchStatusSchema.parse(input.pausedFromStatus);
  if (!pausableStatusesByMode[input.mode].has(target)) {
    throw new Error(`Recorded resume status ${target} is invalid for ${input.mode} production.`);
  }
  assertProductionBatchModeTransition(input.mode, 'paused', target);
  return target;
}
