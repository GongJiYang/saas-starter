import { z } from 'zod';
import { DomainError } from '@/lib/errors/domain';

export const CSV_TEMPLATE_VERSION = 'v2' as const;
export const CSV_LEGACY_TEMPLATE_VERSION = 'v1' as const;
export type CsvTemplateVersion = typeof CSV_TEMPLATE_VERSION | typeof CSV_LEGACY_TEMPLATE_VERSION;
export const CSV_MAX_ROWS = 1000;
export const CSV_MAX_BYTES = 10 * 1024 * 1024;

const CSV_SHARED_REQUIRED_COLUMNS = [
  'external_sku',
  'product_name',
  'category',
  'primary_image_url',
  'approved_claim_1',
  'approved_claim_source_1',
  'prohibited_claim_1',
  'must_show_1',
  'immutable_element_1',
  'target_audience',
  'campaign_goal',
  'platform',
  'duration_seconds',
] as const;

export const CSV_REQUIRED_COLUMNS = [
  ...CSV_SHARED_REQUIRED_COLUMNS,
  'brand_kit_name',
  'cta',
] as const;

export const CSV_V1_REQUIRED_COLUMNS = [
  ...CSV_SHARED_REQUIRED_COLUMNS,
  'brand_kit_id',
  'cta',
] as const;

export const CSV_OPTIONAL_COLUMNS = [
  'product_page_url',
  ...Array.from({ length: 9 }, (_, index) => `detail_image_url_${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `approved_claim_${index + 2}`),
  ...Array.from({ length: 4 }, (_, index) => `approved_claim_source_${index + 2}`),
  ...Array.from({ length: 4 }, (_, index) => `prohibited_claim_${index + 2}`),
  ...Array.from({ length: 4 }, (_, index) => `must_show_${index + 2}`),
  ...Array.from({ length: 4 }, (_, index) => `immutable_element_${index + 2}`),
  'reference_video_url',
  'reference_rights',
  'reference_mode',
  'notes',
] as const;

export const CSV_ALL_COLUMNS = [...CSV_REQUIRED_COLUMNS, ...CSV_OPTIONAL_COLUMNS] as const;
export const CSV_V1_ALL_COLUMNS = [...CSV_V1_REQUIRED_COLUMNS, ...CSV_OPTIONAL_COLUMNS] as const;

export function getCsvColumns(version: CsvTemplateVersion): readonly string[] {
  return version === CSV_LEGACY_TEMPLATE_VERSION ? CSV_V1_ALL_COLUMNS : CSV_ALL_COLUMNS;
}

const nonEmptyString = z.string().trim().min(1);
const httpsUrl = z.string().url().refine((value) => value.startsWith('https://'), {
  message: 'must use HTTPS',
});

export const csvTemplateSchema = z.object({
  version: z.literal(CSV_TEMPLATE_VERSION),
  maxRows: z.literal(CSV_MAX_ROWS),
  requiredColumns: z.array(z.enum(CSV_REQUIRED_COLUMNS)).length(CSV_REQUIRED_COLUMNS.length),
  optionalColumns: z.array(z.enum(CSV_OPTIONAL_COLUMNS)),
});

export const csvTemplate = csvTemplateSchema.parse({
  version: CSV_TEMPLATE_VERSION,
  maxRows: CSV_MAX_ROWS,
  requiredColumns: [...CSV_REQUIRED_COLUMNS],
  optionalColumns: [...CSV_OPTIONAL_COLUMNS],
});

export function validateCsvHeaders(headers: readonly string[], version: CsvTemplateVersion = CSV_TEMPLATE_VERSION): {
  valid: boolean;
  missing: string[];
  unknown: string[];
  duplicates: string[];
} {
  const normalized = headers.map((header) => header.trim());
  const counts = new Map<string, number>();
  for (const header of normalized) counts.set(header, (counts.get(header) ?? 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([header]) => header);
  const required: readonly string[] = version === CSV_LEGACY_TEMPLATE_VERSION ? CSV_V1_REQUIRED_COLUMNS : CSV_REQUIRED_COLUMNS;
  const known = new Set(getCsvColumns(version));
  const missing = required.filter((column) => !counts.has(column));
  const unknown = normalized.filter((header) => !known.has(header));
  return {
    valid: missing.length === 0 && unknown.length === 0 && duplicates.length === 0,
    missing,
    unknown: [...new Set(unknown)],
    duplicates,
  };
}
export function defaultCsvImportDecision(skuExistsInWorkspace: boolean): 'create' | 'update' {
  return skuExistsInWorkspace ? 'update' : 'create';
}


export const referenceRightsSchema = z.enum(['owned', 'licensed', 'inspiration_only']);
export const referenceModeSchema = z.enum(['none', 'structure', 'owned_template']);

export const skuReadinessInputSchema = z.object({
  externalSku: nonEmptyString,
  productName: nonEmptyString,
  category: nonEmptyString,
  primaryImageUrl: z.preprocess((value) => value === '' ? undefined : value, httpsUrl.optional()),
  primaryAssetId: z.number().int().positive().optional(),
  primaryImageAuthorized: z.boolean(),
  detailImageUrls: z.array(httpsUrl),
  approvedClaims: z.array(z.object({ text: nonEmptyString, source: nonEmptyString })).min(1),
  prohibitedClaims: z.array(nonEmptyString).min(1),
  mustShowElements: z.array(nonEmptyString).min(1),
  immutableElements: z.array(nonEmptyString).min(1),
  targetAudience: nonEmptyString,
  campaignGoal: nonEmptyString,
  platform: nonEmptyString,
  durationSeconds: z.number().int().min(4).max(15),
  brandKitId: z.number().int().positive(),
  cta: nonEmptyString,
  referenceVideoUrl: httpsUrl.optional(),
  referenceRights: referenceRightsSchema.optional(),
  referenceMode: referenceModeSchema.optional(),
}).superRefine((value, context) => {
  if (!value.primaryImageUrl && !value.primaryAssetId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryImageUrl'],
      message: 'A primary image HTTPS URL or archived Asset is required.',
    });
  }
});

export type SkuReadinessInput = z.infer<typeof skuReadinessInputSchema>;

export const readinessErrorCodeSchema = z.enum([
  'missing_external_sku',
  'missing_product_name',
  'missing_category',
  'invalid_primary_image_url',
  'primary_image_not_authorized',
  'missing_approved_claim',
  'missing_claim_source',
  'missing_prohibited_claim',
  'missing_must_show_element',
  'missing_immutable_element',
  'missing_target_audience',
  'missing_campaign_goal',
  'invalid_platform',
  'invalid_duration',
  'missing_brand_kit',
  'missing_cta',
  'invalid_reference_rights',
]);

export type ReadinessErrorCode = z.infer<typeof readinessErrorCodeSchema>;
export type ReadinessIssue = {
  code: ReadinessErrorCode;
  field: string;
  message: string;
};

export type SkuReadinessResult = {
  status: 'ready' | 'needs_input';
  issues: ReadinessIssue[];
};

function issue(code: ReadinessErrorCode, field: string, message: string): ReadinessIssue {
  return { code, field, message };
}

function readinessCodeForField(field: string): ReadinessErrorCode {
  if (field.includes('externalSku')) return 'missing_external_sku';
  if (field.includes('productName')) return 'missing_product_name';
  if (field.includes('category')) return 'missing_category';
  if (field.includes('primaryImageUrl')) return 'invalid_primary_image_url';
  if (field.includes('primaryImageAuthorized')) return 'primary_image_not_authorized';
  if (field.includes('approvedClaims') && field.endsWith('.source')) return 'missing_claim_source';
  if (field.includes('approvedClaims')) return 'missing_approved_claim';
  if (field.includes('prohibitedClaims')) return 'missing_prohibited_claim';
  if (field.includes('mustShowElements')) return 'missing_must_show_element';
  if (field.includes('immutableElements')) return 'missing_immutable_element';
  if (field.includes('targetAudience')) return 'missing_target_audience';
  if (field.includes('campaignGoal')) return 'missing_campaign_goal';
  if (field.includes('platform')) return 'invalid_platform';
  if (field.includes('durationSeconds')) return 'invalid_duration';
  if (field.includes('brandKitId')) return 'missing_brand_kit';
  if (field.includes('cta')) return 'missing_cta';
  return 'invalid_reference_rights';
}

export function validateSkuReadiness(input: unknown): SkuReadinessResult {
  const parsed = skuReadinessInputSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((entry): ReadinessIssue => {
      const field = entry.path.join('.') || 'row';
      const code = readinessCodeForField(field);
      return issue(code, field, entry.message);
    });
    return { status: 'needs_input', issues };
  }

  const value = parsed.data;
  const issues: ReadinessIssue[] = [];
  if (!value.primaryImageAuthorized) {
    issues.push(issue('primary_image_not_authorized', 'primaryImageAuthorized', 'Primary image authorization is required.'));
  }
  if (value.referenceVideoUrl && (!value.referenceRights || !value.referenceMode || value.referenceMode === 'none')) {
    issues.push(issue('invalid_reference_rights', 'referenceRights', 'A reference video requires a rights declaration and a non-none mode.'));
  }
  if (value.referenceMode === 'owned_template' && !['owned', 'licensed'].includes(value.referenceRights ?? '')) {
    issues.push(issue('invalid_reference_rights', 'referenceRights', 'Owned template mode requires owned or licensed rights.'));
  }
  if (value.referenceRights === 'inspiration_only' && value.referenceMode !== 'structure') {
    issues.push(issue('invalid_reference_rights', 'referenceMode', 'Inspiration-only references may use structure mode only.'));
  }

  return { status: issues.length === 0 ? 'ready' : 'needs_input', issues };
}

export const creativeReferenceSchema = z.object({
  sourceId: nonEmptyString,
  rights: referenceRightsSchema,
  mode: referenceModeSchema.exclude(['none']),
}).strict().superRefine((value, context) => {
  if (value.mode === 'owned_template' && !['owned', 'licensed'].includes(value.rights)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rights'],
      message: 'Owned template mode requires owned or licensed rights.',
    });
  }
  if (value.rights === 'inspiration_only' && value.mode !== 'structure') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mode'],
      message: 'Inspiration-only references may use structure mode only.',
    });
  }
});

export const referenceAnalysisSchema = z.object({
  sourceId: nonEmptyString,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  durationSeconds: z.number().positive().max(900),
  ratio: z.enum(['9:16', '1:1', '4:5', '16:9']),
  shots: z.array(z.object({
    fromSeconds: z.number().min(0),
    toSeconds: z.number().positive(),
    role: z.enum(['hook', 'body', 'proof', 'hero', 'transition', 'cta']),
    pace: z.enum(['slow', 'medium', 'fast']),
    cameraMovement: nonEmptyString,
    composition: nonEmptyString.default('unknown'),
    captionSafeArea: nonEmptyString.default('unknown'),
    ctaPosition: nonEmptyString.default('unknown'),
    transition: nonEmptyString.default('unknown'),
  }).strict()).min(1),
  borrowedStructure: z.array(z.enum([
    'shot_boundaries',
    'pace',
    'composition',
    'camera_movement',
    'caption_safe_area',
    'cta_position',
  ])),
  excludedContent: z.array(z.enum([
    'original_script',
    'original_audio',
    'third_party_logo',
    'identifiable_person',
    'watermark',
    'signature_set_or_character',
  ])).min(1),
}).strict().superRefine((value, context) => {
  let previousTo = 0;
  for (const [index, shot] of value.shots.entries()) {
    if (shot.toSeconds <= shot.fromSeconds || shot.toSeconds > value.durationSeconds) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['shots', index], message: 'Shot range is outside the reference duration.' });
    }
    if (shot.fromSeconds < previousTo) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['shots', index], message: 'Shot ranges must be ordered and non-overlapping.' });
    }
    previousTo = shot.toSeconds;
  }
});

export const creativeSpecStatusSchema = z.enum(['draft', 'awaiting_approval', 'approved', 'rejected', 'superseded']);

export const creativeSpecSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: creativeSpecStatusSchema,
  selectedAngle: z.object({
    id: nonEmptyString,
    label: nonEmptyString,
    rationale: nonEmptyString,
    evidenceIds: z.array(nonEmptyString),
    riskNotes: z.array(nonEmptyString),
  }).strict(),
  hookVariants: z.array(z.object({
    id: z.enum(['A', 'B', 'C']),
    openingHook: nonEmptyString,
    firstShotDescription: nonEmptyString,
    approvedClaimIds: z.array(nonEmptyString).min(1),
  }).strict()).length(3),
  sharedBodyShotList: z.array(z.object({
    id: nonEmptyString,
    description: nonEmptyString,
    approvedClaimIds: z.array(nonEmptyString),
  }).strict()).min(1),
  visualTreatment: nonEmptyString,
  pacing: nonEmptyString,
  captionPlan: nonEmptyString,
  mustShowElements: z.array(nonEmptyString).min(1),
  immutableElements: z.array(nonEmptyString).min(1),
  forbiddenElements: z.array(nonEmptyString).min(1),
  referenceBorrowedStructure: z.array(nonEmptyString),
  referenceExcludedContent: z.array(nonEmptyString).min(1),
  estimated: z.object({
    shotCount: z.number().int().positive(),
    durationSeconds: z.number().int().min(4).max(15),
    maxEstimatedCostCny: z.number().nonnegative(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const ids = value.hookVariants.map((variant) => variant.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['hookVariants'], message: 'Hook variant IDs must be unique.' });
  }
  if (value.status === 'approved' && value.estimated.maxEstimatedCostCny <= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['estimated', 'maxEstimatedCostCny'], message: 'Approved specs require a positive cost estimate.' });
  }
});

export const importBatchStatusSchema = z.enum(['uploaded', 'validating', 'needs_fix', 'ready', 'committed', 'failed']);
export const catalogItemStatusSchema = z.enum(['needs_input', 'ready', 'archived']);
export const productionBatchStatusSchema = z.enum([
  'draft',
  'ready_for_spec',
  'ready_to_generate',
  'generating',
  'review',
  'calibrating',
  'pilot_review',
  'ready',
  'producing',
  'paused',
  'reviewing',
  'completed',
  'cancelled',
]);

const transitionMaps: Record<string, Record<string, readonly string[]>> = {
  import_batch: {
    uploaded: ['validating', 'failed'],
    validating: ['needs_fix', 'ready', 'failed'],
    needs_fix: ['validating', 'failed'],
    ready: ['committed', 'failed'],
    committed: [],
    failed: [],
  },
  production_batch: {
    draft: ['ready_for_spec', 'calibrating', 'cancelled'],
    ready_for_spec: ['ready_to_generate', 'paused', 'cancelled'],
    ready_to_generate: ['generating', 'paused', 'cancelled'],
    generating: ['ready_to_generate', 'review', 'paused', 'cancelled'],
    review: ['ready_to_generate', 'completed', 'paused', 'cancelled'],
    calibrating: ['pilot_review', 'paused', 'cancelled'],
    pilot_review: ['ready', 'paused', 'cancelled'],
    ready: ['producing', 'paused', 'cancelled'],
    producing: ['paused', 'reviewing', 'cancelled'],
    paused: ['ready_for_spec', 'ready_to_generate', 'generating', 'review', 'calibrating', 'pilot_review', 'ready', 'producing', 'reviewing', 'cancelled'],
    reviewing: ['completed', 'paused', 'cancelled'],
    completed: [],
    cancelled: [],
  },
  creative_spec: {
    draft: ['awaiting_approval', 'superseded'],
    awaiting_approval: ['approved', 'rejected', 'superseded'],
    approved: ['superseded'],
    rejected: ['draft', 'superseded'],
    superseded: [],
  },
};

export type ContractEntity = keyof typeof transitionMaps;

export function canTransition(entity: ContractEntity, from: string, to: string): boolean {
  return transitionMaps[entity][from]?.includes(to) ?? false;
}

export function assertContractTransition(entity: ContractEntity, from: string, to: string): void {
  if (!canTransition(entity, from, to)) {
    throw new DomainError('invalid_transition', {
      message: `The ${entity.replaceAll('_', ' ')} is currently ${from.replaceAll('_', ' ')} and cannot move directly to ${to.replaceAll('_', ' ')}. Refresh it and use the highlighted Next action.`,
      details: { entity, currentStatus: from, requestedStatus: to, nextAction: 'Use the highlighted Next action' },
    });
  }
}

export const pilotGateInputSchema = z.object({
  batchSkuCount: z.number().int().positive(),
  pilotSkuCount: z.number().int().min(1).max(3),
  adoptedPilotSkuCount: z.number().int().nonnegative(),
  unresolvedProductFidelityFailures: z.number().int().nonnegative(),
}).strict();

export const WAVE_STOP_THRESHOLDS = {
  defaultWaveSize: 10,
  maxProductFidelityFailureSkuCount: 2,
  minReviewedResultsForSameCause: 5,
  sameCauseRejectRate: 0.4,
  maxSupplierErrorRate: 0.2,
  maxSameSkillVersionBlockingFailures: 2,
} as const;

export function evaluatePilotGate(input: unknown): { passed: boolean; reasons: string[] } {
  const value = pilotGateInputSchema.parse(input);
  const reasons: string[] = [];
  if (value.batchSkuCount < 3) reasons.push('batches under three SKU use the single-SKU flow');
  if (value.pilotSkuCount > value.batchSkuCount) reasons.push('pilot cannot contain more SKU than the batch');
  if (value.adoptedPilotSkuCount < 2) reasons.push('at least two Pilot SKU must have an adopted AdVersion');
  if (value.unresolvedProductFidelityFailures > 0) reasons.push('unresolved product-fidelity failures block release');
  return { passed: reasons.length === 0, reasons };
}

export const waveObservationSchema = z.object({
  waveSize: z.number().int().positive().default(WAVE_STOP_THRESHOLDS.defaultWaveSize),
  productFidelityFailures: z.array(z.object({ sku: nonEmptyString, count: z.number().int().positive() }).strict()),
  skillBlockingFailures: z.array(z.object({
    shotSkillVersionId: z.number().int().positive(),
    failureCodes: z.array(nonEmptyString).min(1),
  }).strict()).default([]),
  reviewedResults: z.array(z.object({
    sku: nonEmptyString,
    rejectionCause: nonEmptyString.optional(),
  }).strict()),
  supplierErrorRate: z.number().min(0).max(1),
  averageCostCny: z.number().nonnegative(),
  confirmedAverageCostCny: z.number().nonnegative(),
}).strict();

export type WaveObservation = z.infer<typeof waveObservationSchema>;

export function getWaveStopReasons(input: unknown): string[] {
  const value = waveObservationSchema.parse(input);
  const reasons: string[] = [];
  const fidelitySkuCount = new Set(
    value.productFidelityFailures
      .filter((item) => item.count > 0)
      .map((item) => item.sku),
  ).size;
  if (fidelitySkuCount >= WAVE_STOP_THRESHOLDS.maxProductFidelityFailureSkuCount) {
    reasons.push('two different SKU have product-fidelity failures');
  }

  const blockingFailureCountBySkillVersion = new Map<number, number>();
  for (const failure of value.skillBlockingFailures) {
    blockingFailureCountBySkillVersion.set(
      failure.shotSkillVersionId,
      (blockingFailureCountBySkillVersion.get(failure.shotSkillVersionId) ?? 0) + 1,
    );
  }
  for (const [shotSkillVersionId, failureCount] of blockingFailureCountBySkillVersion) {
    if (failureCount >= WAVE_STOP_THRESHOLDS.maxSameSkillVersionBlockingFailures) {
      reasons.push(`Shot Skill Version ${shotSkillVersionId} has repeated blocking QA failures`);
    }
  }

  const reviewed = value.reviewedResults.filter((result) => result.rejectionCause);
  if (reviewed.length >= WAVE_STOP_THRESHOLDS.minReviewedResultsForSameCause) {
    const counts = new Map<string, number>();
    for (const result of reviewed) {
      const cause = result.rejectionCause!;
      counts.set(cause, (counts.get(cause) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count / reviewed.length >= WAVE_STOP_THRESHOLDS.sameCauseRejectRate)) {
      reasons.push('at least 40% of reviewed results share one rejection cause');
    }
  }
  if (value.supplierErrorRate > WAVE_STOP_THRESHOLDS.maxSupplierErrorRate) {
    reasons.push('supplier error rate exceeds 20%');
  }
  if (value.averageCostCny > value.confirmedAverageCostCny) {
    reasons.push('average cost exceeds the confirmed batch limit');
  }
  return reasons;
}

export const remediationCauseSchema = z.enum(['technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change']);
export const remediationRequestSchema = z.object({
  cause: remediationCauseSchema,
  changedInputField: nonEmptyString,
  affectedShotPlanId: nonEmptyString.optional(),
  parentSpecVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  note: nonEmptyString.optional(),
}).strict();

export const remediationPolicies = {
  technical: { action: 'retry_shot', customerChange: false, requiresNewSpec: false },
  fidelity: { action: 'block_delivery_and_retry_shot', customerChange: false, requiresNewSpec: false },
  spec_mismatch: { action: 'create_corrective_spec_version', customerChange: false, requiresNewSpec: true },
  preference_change: { action: 'create_new_version_as_scope_change', customerChange: true, requiresNewSpec: true },
  brief_change: { action: 'create_new_brief_and_spec_version', customerChange: true, requiresNewSpec: true },
} as const;

export type RemediationCause = z.infer<typeof remediationCauseSchema>;

export const batchCostEstimateSchema = z.object({
  specHash: z.string().length(64),
  currency: z.literal('CNY'),
  itemCount: z.number().int().positive(),
  shotCount: z.number().int().positive(),
  generatedSeconds: z.number().nonnegative(),
  retryReserveSeconds: z.number().nonnegative(),
  modelCostCny: z.number().nonnegative(),
  retryReserveCostCny: z.number().nonnegative(),
  storageAndServiceReserveCny: z.number().nonnegative(),
  maxEstimatedCostCny: z.number().nonnegative(),
}).strict();

export const batchCostConfirmationSchema = z.object({
  specHash: z.string().length(64),
  maxEstimatedCostCny: z.number().nonnegative(),
  confirmed: z.literal(true),
  confirmedBy: z.number().int().positive(),
  confirmedAt: z.string().datetime(),
}).strict();

export function isCostConfirmationValid(
  estimateInput: unknown,
  confirmationInput: unknown,
): boolean {
  const estimate = batchCostEstimateSchema.parse(estimateInput);
  const confirmation = batchCostConfirmationSchema.parse(confirmationInput);
  return confirmation.specHash === estimate.specHash
    && confirmation.maxEstimatedCostCny === estimate.maxEstimatedCostCny;
}
