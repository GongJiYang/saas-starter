import { z } from 'zod';

export const domainErrorCodeSchema = z.enum([
  'request_invalid',
  'catalog_conflict',
  'catalog_not_ready',
  'workspace_entity_not_found',
  'workspace_entity_forbidden',
  'asset_upload_failed',
  'skill_ineligible',
  'spec_not_approved',
  'cost_confirmation_stale',
  'invalid_transition',
  'quality_gate_failed',
  'generation_failed',
  'internal_error',
]);
export type DomainErrorCode = z.infer<typeof domainErrorCodeSchema>;

export const domainRemediationSchema = z.object({
  action: z.string().trim().min(1),
  label: z.string().trim().min(1),
  href: z.string().startsWith('/dashboard/'),
}).strict();
export type DomainRemediation = z.infer<typeof domainRemediationSchema>;

export const domainErrorRegistry: Record<DomainErrorCode, {
  status: number;
  message: string;
  remediations: DomainRemediation[];
}> = {
  request_invalid: {
    status: 400,
    message: 'Some submitted values are invalid. Review the highlighted fields and try again.',
    remediations: [],
  },
  catalog_conflict: {
    status: 409,
    message: 'This SKU already exists in the current Workspace.',
    remediations: [{ action: 'open_catalog', label: 'Open SKU Catalog', href: '/dashboard/catalog' }],
  },
  catalog_not_ready: {
    status: 409,
    message: 'Complete the product information and required images before starting production.',
    remediations: [{ action: 'open_catalog', label: 'Open SKU Catalog', href: '/dashboard/catalog' }],
  },
  workspace_entity_not_found: {
    status: 404,
    message: 'The requested item is not available in the current Workspace.',
    remediations: [],
  },
  workspace_entity_forbidden: {
    status: 403,
    message: 'This item belongs to another Workspace or is no longer available here. Choose an item listed in the current Workspace.',
    remediations: [{ action: 'open_workspace', label: 'Open Workspace', href: '/dashboard' }],
  },
  asset_upload_failed: {
    status: 503,
    message: 'The upload could not reach object storage. Check the network and storage CORS settings, then retry; the server upload fallback remains available.',
    remediations: [{ action: 'open_catalog', label: 'Return to product images', href: '/dashboard/catalog' }],
  },
  skill_ineligible: {
    status: 409,
    message: 'No Active Shot Skill supports the current SKU materials, scene, platform, and duration.',
    remediations: [
      { action: 'fix_product', label: 'Review SKU materials', href: '/dashboard/catalog' },
      { action: 'open_skills', label: 'Open Shot Skills', href: '/dashboard/skills' },
    ],
  },
  spec_not_approved: {
    status: 409,
    message: 'An approved Creative Spec is required before production can continue.',
    remediations: [{ action: 'review_specs', label: 'Review Creative Specs', href: '/dashboard/specs' }],
  },
  cost_confirmation_stale: {
    status: 409,
    message: 'The cost confirmation is stale because the approved Spec, frozen Skill, SKU selection, quantity, or duration changed. Re-estimate and confirm the current cost.',
    remediations: [{ action: 'open_batches', label: 'Return to Production task', href: '/dashboard/batches' }],
  },
  invalid_transition: {
    status: 409,
    message: 'This action is not available in the current task state. Refresh the task and use its highlighted Next action.',
    remediations: [{ action: 'open_batches', label: 'Open Production tasks', href: '/dashboard/batches' }],
  },
  quality_gate_failed: {
    status: 409,
    message: 'Quality evidence does not pass the current production gate. Review the failed checks and apply the recommended remediation.',
    remediations: [{ action: 'open_reviews', label: 'Open Reviews', href: '/dashboard/reviews' }],
  },
  generation_failed: {
    status: 503,
    message: 'Video generation failed. Review the recorded supplier or technical failure before retrying.',
    remediations: [{ action: 'open_jobs', label: 'Open Video jobs', href: '/dashboard/jobs' }],
  },
  internal_error: {
    status: 500,
    message: 'The request could not be completed. Share the request ID with support if the problem continues.',
    remediations: [],
  },
};

export type DomainErrorOptions = {
  message?: string;
  field?: string;
  details?: Record<string, string | number | boolean | null>;
  remediations?: DomainRemediation[];
  status?: number;
  cause?: unknown;
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly field?: string;
  readonly details: Record<string, string | number | boolean | null>;
  readonly remediations: DomainRemediation[];
  readonly status: number;
  readonly technicalCause?: unknown;

  constructor(code: DomainErrorCode, options: DomainErrorOptions = {}) {
    const registered = domainErrorRegistry[code];
    super(options.message ?? registered.message);
    this.name = 'DomainError';
    this.code = code;
    this.field = options.field;
    this.details = options.details ?? {};
    this.remediations = options.remediations ?? registered.remediations;
    this.status = options.status ?? registered.status;
    this.technicalCause = options.cause;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '';
}

export function normalizeDomainError(error: unknown, fallback: DomainErrorCode = 'internal_error'): DomainError {
  if (error instanceof DomainError) return error;
  if (error instanceof z.ZodError) {
    return new DomainError('request_invalid', {
      field: error.issues[0]?.path.map(String).join('.') || undefined,
      cause: error,
    });
  }
  const message = messageOf(error);
  const normalized = message.toLowerCase();
  const externalCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (externalCode === 'external_sku_conflict') return new DomainError('catalog_conflict', { message, cause: error });
  if (externalCode === 'network_failure' || error instanceof TypeError || normalized.includes('failed to fetch')) {
    return new DomainError('asset_upload_failed', { cause: error });
  }
  if (normalized.includes('current workspace') || normalized.includes('does not belong to the current workspace') || normalized.includes('another workspace')) {
    return new DomainError('workspace_entity_forbidden', { cause: error });
  }
  if (normalized.includes('not found') || normalized.includes('not available in the current workspace')) {
    return new DomainError('workspace_entity_not_found', { cause: error });
  }
  if (normalized.includes('no active shot skill') || normalized.includes('not eligible') || normalized.includes('no shot skill')) {
    return new DomainError('skill_ineligible', { cause: error });
  }
  if (normalized.includes('approved creative spec') || normalized.includes('spec approval') || normalized.includes('needs an approved creative spec')) {
    return new DomainError('spec_not_approved', { cause: error });
  }
  if (normalized.includes('cost confirmation') || normalized.includes('confirmed cost') || normalized.includes('cost gate')) {
    return new DomainError('cost_confirmation_stale', { cause: error });
  }
  const transition = message.match(/Invalid [a-z_]+ transition: ([a-z_]+) → ([a-z_]+)/i);
  if (transition) {
    return new DomainError('invalid_transition', {
      message: `The task is currently ${transition[1]!.replaceAll('_', ' ')} and cannot move directly to ${transition[2]!.replaceAll('_', ' ')}. Refresh the task and use its highlighted Next action.`,
      details: { currentStatus: transition[1]!, requestedStatus: transition[2]! },
      cause: error,
    });
  }
  if (normalized.includes('only available') || normalized.includes('requires a') || normalized.includes('invalid transition') || normalized.includes('cannot transition') || normalized.includes('not ready to')) {
    return new DomainError('invalid_transition', { cause: error });
  }
  if (normalized.includes('quality') || normalized.includes('qa evidence')) {
    return new DomainError('quality_gate_failed', { cause: error });
  }
  return new DomainError(fallback, { cause: error });
}

export function customerNetworkError(error: unknown): DomainError {
  return normalizeDomainError(error, 'asset_upload_failed');
}
