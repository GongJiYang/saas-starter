import { SHOT_SKILL_QUALITY_CHECK_CODES, type QualityCheck } from './schema';

export type ShotSkillQualityObservationValue<T extends boolean | number> = {
  value: T;
  evidence: string[];
};

export type ShotSkillQualityObservation = {
  productCount: ShotSkillQualityObservationValue<number>;
  productShapePreserved: ShotSkillQualityObservationValue<boolean>;
  productVisibleAtEnd: ShotSkillQualityObservationValue<boolean>;
  productDetailSupported: ShotSkillQualityObservationValue<boolean>;
  sceneAuthorized: ShotSkillQualityObservationValue<boolean>;
  skillTimelineFollowed: ShotSkillQualityObservationValue<boolean>;
};

export type ShotSkillQualityCheckCode = (typeof SHOT_SKILL_QUALITY_CHECK_CODES)[number];

export type QualityFailureCause = 'fidelity' | 'spec_mismatch';
export type QualityRemediationCategory = 'supply_assets' | 'change_spec' | 'change_skill' | 'technical_retry';

export type ShotSkillQualityCheckResult = QualityCheck & {
  passed: boolean;
  evidence: string[];
  failureCause: QualityFailureCause;
  remediationCategory: QualityRemediationCategory;
};

export type ShotSkillQualityResult = {
  passed: boolean;
  checks: ShotSkillQualityCheckResult[];
  blockingFailures: string[];
};

export type QualityCheckContract = {
  observationField: keyof ShotSkillQualityObservation;
  failureCause: QualityFailureCause;
  remediationCategory: QualityRemediationCategory;
  userMessage: string;
  evaluate: (value: boolean | number) => boolean;
};

export const shotSkillQualityCheckRegistry: Readonly<Record<ShotSkillQualityCheckCode, QualityCheckContract>> = {
  single_product: {
    observationField: 'productCount',
    failureCause: 'fidelity',
    remediationCategory: 'change_skill',
    userMessage: 'The output must contain exactly one product.',
    evaluate: (value) => value === 1,
  },
  product_shape_preserved: {
    observationField: 'productShapePreserved',
    failureCause: 'fidelity',
    remediationCategory: 'supply_assets',
    userMessage: 'The supplied product shape must be preserved.',
    evaluate: (value) => value === true,
  },
  product_visible_at_end: {
    observationField: 'productVisibleAtEnd',
    failureCause: 'fidelity',
    remediationCategory: 'change_skill',
    userMessage: 'The product must remain visible at the end.',
    evaluate: (value) => value === true,
  },
  product_detail_supported: {
    observationField: 'productDetailSupported',
    failureCause: 'fidelity',
    remediationCategory: 'supply_assets',
    userMessage: 'Every generated product detail must be supported by supplied imagery.',
    evaluate: (value) => value === true,
  },
  scene_authorized: {
    observationField: 'sceneAuthorized',
    failureCause: 'spec_mismatch',
    remediationCategory: 'change_spec',
    userMessage: 'The generated scene must be authorized by the approved Creative Spec.',
    evaluate: (value) => value === true,
  },
  skill_timeline_followed: {
    observationField: 'skillTimelineFollowed',
    failureCause: 'spec_mismatch',
    remediationCategory: 'change_skill',
    userMessage: 'The generated video should follow the frozen Skill timeline.',
    evaluate: (value) => value === true,
  },
};

export function getShotSkillQualityCheckContract(code: string): QualityCheckContract | undefined {
  return shotSkillQualityCheckRegistry[code as ShotSkillQualityCheckCode];
}

export function evaluateShotSkillQuality(
  checks: readonly QualityCheck[],
  observation: ShotSkillQualityObservation,
): ShotSkillQualityResult {
  const checksWithResults = checks.map((check) => {
    const contract = getShotSkillQualityCheckContract(check.code);
    if (!contract) throw new Error(`Unsupported Shot Skill quality check code: ${check.code}.`);
    const observationValue = observation[contract.observationField];
    return {
      ...check,
      passed: contract.evaluate(observationValue.value),
      evidence: [
        `${contract.observationField}=${String(observationValue.value)}`,
        ...observationValue.evidence,
      ],
      failureCause: contract.failureCause,
      remediationCategory: contract.remediationCategory,
    };
  });
  const blockingFailures = checksWithResults
    .filter((check) => check.severity === 'blocking' && !check.passed)
    .map((check) => check.code);

  return {
    passed: blockingFailures.length === 0,
    checks: checksWithResults,
    blockingFailures,
  };
}
