import { z } from 'zod';
import { compiledShotRecipeSchema, SHOT_SKILL_QUALITY_CHECK_CODES, type CompiledShotRecipe, type QualityCheck } from '@/lib/shot-skills/schema';
import { hashStable, stableStringify } from '@/lib/shot-skills/compiler';
import { evaluateShotSkillQuality, getShotSkillQualityCheckContract } from '@/lib/shot-skills/quality';

export const qualityFailureCauseSchema = z.enum(['technical', 'fidelity', 'spec_mismatch']);
export type QualityFailureCause = z.infer<typeof qualityFailureCauseSchema>;

export const qualityRemediationCategorySchema = z.enum(['supply_assets', 'change_spec', 'change_skill', 'technical_retry']);
export type QualityRemediationCategory = z.infer<typeof qualityRemediationCategorySchema>;

export const qualityRemediationSuggestions: Readonly<Record<QualityRemediationCategory, string>> = {
  supply_assets: 'Supply additional verified product material and run QA again.',
  change_spec: 'Correct the Creative Spec before generating another output.',
  change_skill: 'Revise or choose a different Shot Skill before generating another output.',
  technical_retry: 'Retry generation after resolving the technical failure.',
};

export function getQualityRemediationSuggestion(category: QualityRemediationCategory): string {
  return qualityRemediationSuggestions[category];
}

const evidenceStringsSchema = z.array(z.string().trim().min(1).max(2_000)).min(1).max(50);

const technicalObservationSchema = z.object({
  playable: z.boolean(),
  codec: z.string().trim().min(1),
  expectedCodec: z.string().trim().min(1).default('h264'),
  ratio: z.string().regex(/^\d+:\d+$/),
  expectedRatio: z.string().regex(/^\d+:\d+$/).default('9:16'),
  durationSeconds: z.number().positive(),
  expectedDurationSeconds: z.number().positive(),
  audioPresent: z.boolean(),
}).strict();

const fidelityObservationSchema = z.object({
  productCount: z.number().int().nonnegative(),
  productShapePreserved: z.boolean(),
  packagingPreserved: z.boolean(),
  colorsPreserved: z.boolean(),
  logoPreserved: z.boolean(),
  immutableElements: z.array(z.object({ element: z.string().trim().min(1), preserved: z.boolean() }).strict()),
  endFrame: z.object({
    productVisible: z.boolean(),
    evidence: evidenceStringsSchema,
  }).strict(),
  productDetail: z.object({
    supported: z.boolean(),
    evidence: evidenceStringsSchema,
  }).strict(),
}).strict();

const specObservationSchema = z.object({
  angleMatched: z.boolean(),
  hookMatched: z.boolean(),
  approvedClaimIdsPresent: z.array(z.string().trim().min(1)),
  forbiddenElementsFound: z.array(z.string().trim().min(1)),
  captionsMatchApprovedClaims: z.boolean(),
  ctaMatched: z.boolean(),
  scene: z.object({
    authorized: z.boolean(),
    evidence: evidenceStringsSchema,
  }).strict(),
  timeline: z.object({
    followed: z.boolean(),
    evidence: evidenceStringsSchema,
  }).strict(),
}).strict();

export const qualityGateInputSchema = z.object({
  technical: technicalObservationSchema,
  fidelity: fidelityObservationSchema,
  spec: specObservationSchema,
  expectedApprovedClaimIds: z.array(z.string().trim().min(1)),
  actualCostCny: z.number().nonnegative().default(0),
}).strict();

export const qualityFailureSchema = z.object({
  code: z.string().trim().min(1),
  cause: qualityFailureCauseSchema,
  detail: z.string().trim().min(1),
  remediationCategory: qualityRemediationCategorySchema.optional(),
}).strict();

const recordedQualityFailureSchema = qualityFailureSchema.extend({
  remediationCategory: qualityRemediationCategorySchema,
});

const skillQualityCheckSchema = z.object({
  code: z.enum(SHOT_SKILL_QUALITY_CHECK_CODES),
  severity: z.enum(['blocking', 'warning']),
  passed: z.boolean(),
  evidence: z.array(z.string().min(1)),
  failureCause: z.enum(['fidelity', 'spec_mismatch']).optional(),
  remediationCategory: qualityRemediationCategorySchema.optional(),
}).strict();

const recordedSkillQualityCheckSchema = skillQualityCheckSchema.extend({
  failureCause: z.enum(['fidelity', 'spec_mismatch']),
  remediationCategory: qualityRemediationCategorySchema,
});

export const skillQualityReportSchema = z.object({
  skillId: z.string().min(1),
  skillVersion: z.string().min(1),
  skillHash: z.string().length(64),
  recipeHash: z.string().length(64),
  passed: z.boolean(),
  checks: z.array(skillQualityCheckSchema),
  blockingFailures: z.array(z.string().min(1)),
}).strict();

const recordedSkillQualityReportSchema = skillQualityReportSchema.extend({
  checks: z.array(recordedSkillQualityCheckSchema),
});

export const qualityReportSchema = z.object({
  passed: z.boolean(),
  technicalPassed: z.boolean(),
  fidelityPassed: z.boolean(),
  specPassed: z.boolean(),
  failures: z.array(qualityFailureSchema),
  primaryCause: qualityFailureCauseSchema.nullable(),
  actualCostCny: z.number().nonnegative(),
  checkedAt: z.string().datetime(),
  observations: qualityGateInputSchema.optional(),
  observationHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  skill: z.unknown().optional(),
}).strict();

export const recordedQualityReportSchema = qualityReportSchema.extend({
  failures: z.array(recordedQualityFailureSchema),
  observations: qualityGateInputSchema,
  observationHash: z.string().regex(/^[a-f0-9]{64}$/),
  skill: recordedSkillQualityReportSchema,
});

export type QualityGateInput = z.infer<typeof qualityGateInputSchema>;
export type QualityReport = z.infer<typeof qualityReportSchema>;
export type RecordedQualityReport = z.infer<typeof recordedQualityReportSchema>;

export type QualityFailureCode =
  | 'not_playable'
  | 'codec_mismatch'
  | 'ratio_mismatch'
  | 'duration_mismatch'
  | 'audio_missing'
  | 'product_count'
  | 'product_shape'
  | 'packaging'
  | 'colors'
  | 'logo'
  | 'immutable_element'
  | 'angle_mismatch'
  | 'hook_mismatch'
  | 'claim_missing'
  | 'forbidden_element'
  | 'caption_mismatch'
  | 'cta_mismatch';

export type QualityFailureContract = {
  cause: QualityFailureCause;
  remediationCategory: QualityRemediationCategory;
  detail: string;
};

export const qualityFailureRegistry: Readonly<Record<QualityFailureCode, QualityFailureContract>> = {
  not_playable: { cause: 'technical', remediationCategory: 'technical_retry', detail: 'Video is not playable.' },
  codec_mismatch: { cause: 'technical', remediationCategory: 'technical_retry', detail: 'Video codec does not match the delivery contract.' },
  ratio_mismatch: { cause: 'technical', remediationCategory: 'technical_retry', detail: 'Video ratio does not match the delivery contract.' },
  duration_mismatch: { cause: 'technical', remediationCategory: 'technical_retry', detail: 'Video duration is outside the allowed tolerance.' },
  audio_missing: { cause: 'technical', remediationCategory: 'technical_retry', detail: 'Audio track is missing.' },
  product_count: { cause: 'fidelity', remediationCategory: 'change_skill', detail: 'The output must contain exactly one product.' },
  product_shape: { cause: 'fidelity', remediationCategory: 'supply_assets', detail: 'Product shape is not preserved.' },
  packaging: { cause: 'fidelity', remediationCategory: 'supply_assets', detail: 'Packaging is not preserved.' },
  colors: { cause: 'fidelity', remediationCategory: 'supply_assets', detail: 'Product colors are not preserved.' },
  logo: { cause: 'fidelity', remediationCategory: 'supply_assets', detail: 'Logo or label identity is not preserved.' },
  immutable_element: { cause: 'fidelity', remediationCategory: 'supply_assets', detail: 'An immutable product element is not preserved.' },
  angle_mismatch: { cause: 'spec_mismatch', remediationCategory: 'change_spec', detail: 'Output does not follow the approved Angle.' },
  hook_mismatch: { cause: 'spec_mismatch', remediationCategory: 'change_spec', detail: 'Output does not follow the approved Hook.' },
  claim_missing: { cause: 'spec_mismatch', remediationCategory: 'change_spec', detail: 'Approved claims are not all represented.' },
  forbidden_element: { cause: 'spec_mismatch', remediationCategory: 'change_spec', detail: 'Forbidden elements were found.' },
  caption_mismatch: { cause: 'spec_mismatch', remediationCategory: 'change_spec', detail: 'Captions do not match approved claims.' },
  cta_mismatch: { cause: 'spec_mismatch', remediationCategory: 'change_spec', detail: 'CTA does not match the approved Creative Spec.' },
};

function ratioMatches(actual: string, expected: string): boolean {
  const [actualWidth, actualHeight] = actual.split(':').map(Number);
  const [expectedWidth, expectedHeight] = expected.split(':').map(Number);
  const actualValue = actualWidth / actualHeight;
  const expectedValue = expectedWidth / expectedHeight;
  return Math.abs(actualValue - expectedValue) / expectedValue <= 0.02;
}

export function evaluateQualityGate(input: unknown): QualityReport {
  const value = qualityGateInputSchema.parse(input);
  const failures: Array<z.infer<typeof recordedQualityFailureSchema>> = [];
  const fail = (code: QualityFailureCode, detail?: string) => {
    const contract = qualityFailureRegistry[code];
    failures.push({ code, ...contract, detail: detail ?? contract.detail });
  };

  if (!value.technical.playable) fail('not_playable');
  if (value.technical.codec.toLowerCase() !== value.technical.expectedCodec.toLowerCase()) fail('codec_mismatch');
  if (!ratioMatches(value.technical.ratio, value.technical.expectedRatio)) fail('ratio_mismatch');
  if (Math.abs(value.technical.durationSeconds - value.technical.expectedDurationSeconds) > 0.25) fail('duration_mismatch');
  if (!value.technical.audioPresent) fail('audio_missing');
  if (value.fidelity.productCount !== 1) fail('product_count');
  if (!value.fidelity.productShapePreserved) fail('product_shape');
  if (!value.fidelity.packagingPreserved) fail('packaging');
  if (!value.fidelity.colorsPreserved) fail('colors');
  if (!value.fidelity.logoPreserved) fail('logo');
  for (const element of value.fidelity.immutableElements) {
    if (!element.preserved) fail('immutable_element', `Immutable element is not preserved: ${element.element}.`);
  }
  if (!value.spec.angleMatched) fail('angle_mismatch');
  if (!value.spec.hookMatched) fail('hook_mismatch');
  if (!value.expectedApprovedClaimIds.every((id) => value.spec.approvedClaimIdsPresent.includes(id))) fail('claim_missing');
  if (value.spec.forbiddenElementsFound.length > 0) fail('forbidden_element', `Forbidden elements found: ${value.spec.forbiddenElementsFound.join(', ')}.`);
  if (!value.spec.captionsMatchApprovedClaims) fail('caption_mismatch');
  if (!value.spec.ctaMatched) fail('cta_mismatch');

  const primaryCause = failures[0]?.cause ?? null;
  return qualityReportSchema.parse({
    passed: failures.length === 0,
    technicalPassed: failures.every((failure) => failure.cause !== 'technical'),
    fidelityPassed: failures.every((failure) => failure.cause !== 'fidelity'),
    specPassed: failures.every((failure) => failure.cause !== 'spec_mismatch'),
    failures,
    primaryCause,
    actualCostCny: value.actualCostCny,
    checkedAt: new Date().toISOString(),
  });
}

export function parseFrozenRecipeSnapshot(
  snapshot: string | null,
  expected: {
    skillId: string | null;
    skillVersion: string | null;
    skillHash: string | null;
  },
): CompiledShotRecipe | null {
  if (!snapshot) return null;
  let input: unknown;
  try {
    input = JSON.parse(snapshot);
  } catch {
    return null;
  }
  const parsed = compiledShotRecipeSchema.safeParse(input);
  if (!parsed.success) return null;
  const recipe = parsed.data;
  const computedRecipeHash = hashStable({
    skillHash: recipe.skill.hash,
    providerNeutralRecipe: recipe.providerNeutralRecipe,
    prompt: recipe.prompt,
    compilationTrace: recipe.compilationTrace,
  });
  if (
    computedRecipeHash !== recipe.recipeHash
    || recipe.skill.id !== expected.skillId
    || recipe.skill.version !== expected.skillVersion
    || recipe.skill.hash !== expected.skillHash
  ) return null;
  const checkCodes = recipe.qualityChecks.map((check) => check.code);
  if (
    new Set(checkCodes).size !== checkCodes.length
    || recipe.qualityChecks.some((check) => !getShotSkillQualityCheckContract(check.code))
  ) return null;
  return recipe;
}

export function parseRecordedQualityReport(
  input: unknown,
  expected?: {
    observationHash?: string | null;
    skillId?: string | null;
    skillVersion?: string | null;
    skillHash?: string | null;
    recipeHash?: string | null;
    qualityChecks?: readonly QualityCheck[];
  },
): RecordedQualityReport | null {
  const parsed = recordedQualityReportSchema.safeParse(input);
  if (!parsed.success) return null;
  const report = parsed.data;
  if (hashStable(report.observations) !== report.observationHash) return null;
  if (report.actualCostCny !== report.observations.actualCostCny) return null;
  if (expected?.observationHash !== undefined && report.observationHash !== expected.observationHash) return null;
  if (expected?.skillId !== undefined && report.skill.skillId !== expected.skillId) return null;
  if (expected?.skillVersion !== undefined && report.skill.skillVersion !== expected.skillVersion) return null;
  if (expected?.skillHash !== undefined && report.skill.skillHash !== expected.skillHash) return null;
  if (expected?.recipeHash !== undefined && report.skill.recipeHash !== expected.recipeHash) return null;


  const reevaluatedBase = evaluateQualityGate(report.observations);
  const reportedBaseFailures = report.failures.filter((failure) => !failure.code.startsWith('skill:'));
  if (stableStringify(reevaluatedBase.failures) !== stableStringify(reportedBaseFailures)) return null;

  const checks = expected?.qualityChecks ?? report.skill.checks.map((check) => ({
    code: check.code,
    severity: check.severity,
  }));
  const reevaluatedSkill = evaluateShotSkillQuality(checks, {
    productCount: {
      value: report.observations.fidelity.productCount,
      evidence: [`fidelity.productCount=${report.observations.fidelity.productCount}`],
    },
    productShapePreserved: {
      value: report.observations.fidelity.productShapePreserved,
      evidence: [`fidelity.productShapePreserved=${report.observations.fidelity.productShapePreserved}`],
    },
    productVisibleAtEnd: {
      value: report.observations.fidelity.endFrame.productVisible,
      evidence: report.observations.fidelity.endFrame.evidence,
    },
    productDetailSupported: {
      value: report.observations.fidelity.productDetail.supported,
      evidence: report.observations.fidelity.productDetail.evidence,
    },
    sceneAuthorized: {
      value: report.observations.spec.scene.authorized,
      evidence: report.observations.spec.scene.evidence,
    },
    skillTimelineFollowed: {
      value: report.observations.spec.timeline.followed,
      evidence: report.observations.spec.timeline.evidence,
    },
  });
  if (stableStringify(reevaluatedSkill.checks) !== stableStringify(report.skill.checks)) return null;
  const expectedSkillFailures = reevaluatedSkill.checks
    .filter((check) => check.severity === 'blocking' && !check.passed)
    .map((check) => ({
      code: `skill:${check.code}`,
      cause: check.failureCause,
      remediationCategory: check.remediationCategory,
      detail: getShotSkillQualityCheckContract(check.code)!.userMessage,
    }));
  const reportedSkillFailures = report.failures.filter((failure) => failure.code.startsWith('skill:'));
  if (stableStringify(expectedSkillFailures) !== stableStringify(reportedSkillFailures)) return null;
  const technicalPassed = report.failures.every((failure) => failure.cause !== 'technical');
  const fidelityPassed = report.failures.every((failure) => failure.cause !== 'fidelity');
  const specPassed = report.failures.every((failure) => failure.cause !== 'spec_mismatch');
  const blockingFailures = report.skill.checks
    .filter((check) => check.severity === 'blocking' && !check.passed)
    .map((check) => check.code);
  if (
    report.technicalPassed !== technicalPassed
    || report.fidelityPassed !== fidelityPassed
    || report.specPassed !== specPassed
    || report.skill.passed !== (blockingFailures.length === 0)
    || report.skill.blockingFailures.length !== blockingFailures.length
    || report.skill.blockingFailures.some((code, index) => code !== blockingFailures[index])
    || report.passed !== (technicalPassed && fidelityPassed && specPassed && report.skill.passed)
    || report.primaryCause !== (report.failures[0]?.cause ?? null)
  ) return null;
  return report;
}

export function isQualityReportEligibleForAdoption(
  report: RecordedQualityReport | null,
): report is RecordedQualityReport {
  return report !== null && report.passed && report.skill.passed;
}

export function isQualityReportEligibleForAdoptedExport(
  jobReport: RecordedQualityReport | null,
  reviewReport: RecordedQualityReport | null,
): boolean {
  return isQualityReportEligibleForAdoption(jobReport)
    && isQualityReportEligibleForAdoption(reviewReport)
    && stableStringify(jobReport) === stableStringify(reviewReport);
}

export type ReviewRejectionCause =
  | 'technical'
  | 'fidelity'
  | 'spec_mismatch'
  | 'preference_change'
  | 'brief_change';

export type ReviewDecisionEvidencePlan = {
  review: {
    decision: 'adopted' | 'not_adopted';
    reason: string | null;
    qualityFailureCause: ReviewRejectionCause | null;
    qualityReport: string;
  };
  evidence: {
    evidenceType: 'adopted' | 'rejected';
    passed: boolean;
    reason: string | null;
    detail: Record<string, unknown>;
    observationHash: string;
    observationSnapshot: string;
    evidenceSnapshot: string;
  };
  batchItemStatus: 'completed' | 'review';
};

export function createReviewDecisionEvidencePlan(
  input: {
    decision: 'adopted' | 'not_adopted';
    reason: string | null;
    rejectionCause: ReviewRejectionCause | null;
  },
  quality: RecordedQualityReport,
): ReviewDecisionEvidencePlan {
  if (input.decision === 'adopted') {
    if (
      input.reason !== null
      || input.rejectionCause !== null
      || !isQualityReportEligibleForAdoption(quality)
    ) {
      throw new Error('Adoption requires an unchanged unified and Shot Skill QA pass.');
    }
  } else if (!input.reason?.trim() || !input.rejectionCause) {
    throw new Error('Rejection requires a structured cause and reason.');
  }

  return {
    review: {
      decision: input.decision,
      reason: input.reason,
      qualityFailureCause: input.rejectionCause,
      qualityReport: JSON.stringify(quality),
    },
    evidence: {
      evidenceType: input.decision === 'adopted' ? 'adopted' as const : 'rejected' as const,
      passed: input.decision === 'adopted',
      reason: input.reason,
      detail: input.decision === 'adopted'
        ? { reasonCode: 'qa_passed_and_adopted', rejectionCause: null, actualCostCny: quality.actualCostCny }
        : { reasonCode: input.rejectionCause, rejectionCause: input.rejectionCause },
      observationHash: quality.observationHash,
      observationSnapshot: stableStringify(quality.observations),
      evidenceSnapshot: stableStringify({
        failures: quality.failures,
        skillChecks: quality.skill.checks,
      }),
    },
    batchItemStatus: input.decision === 'adopted' ? 'completed' as const : 'review' as const,
  };
}

export function assertQualityGate(report: QualityReport): void {
  if (!report.passed) throw new Error(`Quality gate failed: ${report.failures.map((failure) => failure.code).join(', ')}`);
}
