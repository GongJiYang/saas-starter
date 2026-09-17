import assert from 'node:assert/strict';
import {
  assertQualityGate,
  createReviewDecisionEvidencePlan,
  evaluateQualityGate,
  isQualityReportEligibleForAdoptedExport,
  isQualityReportEligibleForAdoption,
  qualityFailureRegistry,
  qualityRemediationSuggestions,
  qualityReportSchema,
  skillQualityReportSchema,
  type RecordedQualityReport,
} from '../lib/quality/gates';
import { getWaveStopReasons, remediationPolicies, remediationRequestSchema } from '../lib/bulk/contracts';
import { evaluateShotSkillQuality, shotSkillQualityCheckRegistry } from '../lib/shot-skills';

const base = {
  technical: { playable: true, codec: 'h264', ratio: '9:16', durationSeconds: 5, expectedDurationSeconds: 5, audioPresent: true },
  fidelity: {
    productCount: 1,
    productShapePreserved: true,
    packagingPreserved: true,
    colorsPreserved: true,
    logoPreserved: true,
    immutableElements: [{ element: 'label placement', preserved: true }],
    endFrame: { productVisible: true, evidence: ['end_frame.product_visible=true'] },
    productDetail: { supported: true, evidence: ['detail.source_asset=detail-1'] },
  },
  spec: {
    angleMatched: true,
    hookMatched: true,
    approvedClaimIdsPresent: ['claim-1'],
    forbiddenElementsFound: [],
    captionsMatchApprovedClaims: true,
    ctaMatched: true,
    scene: { authorized: true, evidence: ['scene.authorization=spec-1'] },
    timeline: { followed: true, evidence: ['timeline.comparison=matched'] },
  },
  expectedApprovedClaimIds: ['claim-1'],
  actualCostCny: 10,
};
const passed = evaluateQualityGate(base);
assert.equal(passed.passed, true);
assert.doesNotThrow(() => assertQualityGate(passed));
assert.equal(qualityReportSchema.parse(passed).technicalPassed, true);
const providerVertical = evaluateQualityGate({ ...base, technical: { ...base.technical, ratio: '768:1344', expectedRatio: '9:16' } });
assert.equal(providerVertical.technicalPassed, true);
assert.deepEqual(Object.keys(shotSkillQualityCheckRegistry).sort(), [
  'product_detail_supported',
  'product_shape_preserved',
  'product_visible_at_end',
  'scene_authorized',
  'single_product',
  'skill_timeline_followed',
]);
const skillReport = evaluateShotSkillQuality([
  { code: 'single_product', severity: 'blocking' },
  { code: 'skill_timeline_followed', severity: 'warning' },
], {
  productCount: { value: 1, evidence: ['product_count=1'] },
  productShapePreserved: { value: true, evidence: ['shape_comparison=matched'] },
  productVisibleAtEnd: { value: true, evidence: ['end_frame.product_visible=true'] },
  productDetailSupported: { value: true, evidence: ['detail.source_asset=detail-1'] },
  sceneAuthorized: { value: true, evidence: ['scene.authorization=spec-1'] },
  skillTimelineFollowed: { value: false, evidence: ['timeline.comparison=mismatch'] },
});
assert.equal(skillReport.passed, true);
assert.deepEqual(skillReport.checks[1]?.evidence, ['skillTimelineFollowed=false', 'timeline.comparison=mismatch']);
assert.equal(skillQualityReportSchema.safeParse({
  skillId: 'product-hero',
  skillVersion: '1.0.0',
  skillHash: 'a'.repeat(64),
  recipeHash: 'b'.repeat(64),
  ...skillReport,
}).success, true);

const fidelityFailure = evaluateQualityGate({ ...base, fidelity: { ...base.fidelity, productShapePreserved: false } });
assert.equal(fidelityFailure.passed, false);
assert.equal(fidelityFailure.primaryCause, 'fidelity');
assert.throws(() => assertQualityGate(fidelityFailure));

const technicalFailure = evaluateQualityGate({ ...base, technical: { ...base.technical, codec: 'vp9' } });
assert.equal(technicalFailure.primaryCause, 'technical');
const specFailure = evaluateQualityGate({ ...base, spec: { ...base.spec, forbiddenElementsFound: ['unsupported logo'] } });
assert.equal(specFailure.primaryCause, 'spec_mismatch');

const remediation = remediationRequestSchema.parse({ cause: 'spec_mismatch', changedInputField: 'captionPlan', note: 'Use approved claims only.' });
assert.equal(remediationPolicies[remediation.cause].requiresNewSpec, true);
assert.equal(remediationPolicies.technical.requiresNewSpec, false);

for (const contract of [
  ...Object.values(qualityFailureRegistry),
  ...Object.values(shotSkillQualityCheckRegistry),
]) {
  assert.ok(qualityRemediationSuggestions[contract.remediationCategory]);
}

const waveObservation = {
  waveSize: 10,
  productFidelityFailures: [],
  reviewedResults: [],
  supplierErrorRate: 0,
  averageCostCny: 5,
  confirmedAverageCostCny: 10,
};
assert.deepEqual(getWaveStopReasons({
  ...waveObservation,
  skillBlockingFailures: [{ shotSkillVersionId: 7, failureCodes: ['single_product'] }],
}), []);
assert.match(getWaveStopReasons({
  ...waveObservation,
  skillBlockingFailures: [
    { shotSkillVersionId: 7, failureCodes: ['single_product'] },
    { shotSkillVersionId: 7, failureCodes: ['product_visible_at_end'] },
  ],
}).join('; '), /Shot Skill Version 7/);

const adoptableQuality = {
  passed: true,
  skill: { passed: true },
} as RecordedQualityReport;
const blockingQuality = {
  passed: false,
  skill: { passed: false },
} as RecordedQualityReport;
assert.equal(isQualityReportEligibleForAdoption(null), false);
assert.equal(isQualityReportEligibleForAdoption(blockingQuality), false);
assert.equal(isQualityReportEligibleForAdoption(adoptableQuality), true);
assert.equal(isQualityReportEligibleForAdoptedExport(adoptableQuality, adoptableQuality), true);
assert.equal(isQualityReportEligibleForAdoptedExport(adoptableQuality, {
  ...adoptableQuality,
  checkedAt: 'changed',
}), false);
assert.equal(isQualityReportEligibleForAdoptedExport(adoptableQuality, blockingQuality), false);

const rejectedQualityBefore = JSON.stringify(blockingQuality);
const rejectionPlan = createReviewDecisionEvidencePlan({
  decision: 'not_adopted',
  reason: 'Product shape does not match the supplied source.',
  rejectionCause: 'fidelity',
}, blockingQuality);
assert.deepEqual(Object.keys(rejectionPlan).sort(), ['batchItemStatus', 'evidence', 'review']);
assert.equal(rejectionPlan.review.qualityFailureCause, 'fidelity');
assert.equal(rejectionPlan.evidence.detail.rejectionCause, 'fidelity');
assert.equal(JSON.stringify(blockingQuality), rejectedQualityBefore);
assert.throws(() => createReviewDecisionEvidencePlan({
  decision: 'not_adopted',
  reason: 'Missing structured cause.',
  rejectionCause: null,
}, blockingQuality), /structured cause/);

console.log('Quality gate checks passed.');
