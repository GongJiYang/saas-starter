import assert from 'node:assert/strict';
import { compileShotRecipe, evaluateShotSkillQuality, evaluateShotSkillEligibility, hashShotSkillDefinition, selectEligibleShotSkill, shotSkillRegistry, toMiniMaxH3Request } from '../lib/shot-skills';

const baseContext = {
  shotRole: 'hook' as const,
  productCategory: 'fragrance',
  durationSeconds: 5,
  targetPlatform: 'tiktok',
  primaryImageAvailable: true,
  detailImageCount: 1,
  hasSceneBrief: false,
  personRights: 'none' as const,
  brandVoice: 'quiet, premium, restrained',
  sellingPoints: 'Approved fact: a compact glass fragrance bottle.',
  mustShowElements: ['the bottle'],
  immutableElements: ['bottle shape', 'label placement'],
  forbiddenElements: ['additional product', 'generated packaging text'],
  shotDirection: 'Open with a tactile product detail.',
};

assert.equal(shotSkillRegistry.length, 3, 'A1 must register exactly three internal cards.');
assert.deepEqual(
  shotSkillRegistry.map((skill) => skill.id),
  ['product-hero', 'product-macro-detail', 'product-use-case'],
);

const evaluations = evaluateShotSkillEligibility(baseContext);
assert.equal(evaluations.find((result) => result.skill.id === 'product-hero')?.eligible, true);
assert.equal(evaluations.find((result) => result.skill.id === 'product-macro-detail')?.eligible, true);
assert.equal(evaluations.find((result) => result.skill.id === 'product-use-case')?.eligible, false);

const macroSelection = selectEligibleShotSkill(baseContext, 'product-macro-detail');
assert.equal(macroSelection.skill.id, 'product-macro-detail');

const fallbackSelection = selectEligibleShotSkill(
  { ...baseContext, detailImageCount: 0 },
  'product-macro-detail',
);
assert.equal(fallbackSelection.skill.id, 'product-hero');
assert.match(fallbackSelection.reason, /fallback/);

const sceneSelection = selectEligibleShotSkill(
  { ...baseContext, hasSceneBrief: true },
  'product-use-case',
);
assert.equal(sceneSelection.skill.id, 'product-use-case');

const skill = macroSelection.skill;
const firstRecipe = compileShotRecipe(baseContext, skill);
const secondRecipe = compileShotRecipe({ ...baseContext }, { ...skill });
assert.equal(firstRecipe.recipeHash, secondRecipe.recipeHash, 'Stable input must produce a stable recipe hash.');
assert.equal(firstRecipe.skill.hash, hashShotSkillDefinition(skill));
assert.match(firstRecipe.prompt, /Goal:\n/);
assert.match(firstRecipe.prompt, /Preserve exactly:/);
assert.match(firstRecipe.prompt, /Never show:/);
assert.ok(firstRecipe.prompt.indexOf('Approved product facts:') < firstRecipe.prompt.indexOf('Never show:'));
assert.ok(firstRecipe.compilationTrace.some((entry) => entry.source === 'product-brief.sellingPoints'));
const providerRequest = toMiniMaxH3Request(firstRecipe, 'https://assets.example.com/product.png');
assert.equal(providerRequest.imageRole, 'reference_image');
assert.equal(providerRequest.referenceImageUrl, 'https://assets.example.com/product.png');

const baselinePrompt = [
  `Brand voice: ${baseContext.brandVoice}`,
  `Required elements: ${baseContext.mustShowElements.join('; ')}`,
  `Forbidden elements: ${baseContext.forbiddenElements.join('; ')}`,
  `Campaign selling points: ${baseContext.sellingPoints}`,
  `Shot direction: ${baseContext.shotDirection}`,
].join('\n');
assert.notEqual(firstRecipe.prompt, baselinePrompt, 'Skill compiler must produce a distinct structured prompt.');

const passingQuality = evaluateShotSkillQuality(skill.qualityChecks, {
  productCount: { value: 1, evidence: ['product_count=1'] },
  productShapePreserved: { value: true, evidence: ['shape_comparison=matched'] },
  productVisibleAtEnd: { value: true, evidence: ['end_frame.product_visible=true'] },
  productDetailSupported: { value: true, evidence: ['detail.source_asset=detail-1'] },
  sceneAuthorized: { value: true, evidence: ['scene.authorization=spec-1'] },
  skillTimelineFollowed: { value: true, evidence: ['timeline.comparison=matched'] },
});
assert.equal(passingQuality.passed, true);

const failingQuality = evaluateShotSkillQuality(skill.qualityChecks, {
  productCount: { value: 2, evidence: ['product_count=2'] },
  productShapePreserved: { value: false, evidence: ['shape_comparison=mismatch'] },
  productVisibleAtEnd: { value: true, evidence: ['end_frame.product_visible=true'] },
  productDetailSupported: { value: false, evidence: ['detail.source_asset=missing'] },
  sceneAuthorized: { value: true, evidence: ['scene.authorization=spec-1'] },
  skillTimelineFollowed: { value: true, evidence: ['timeline.comparison=matched'] },
});
assert.equal(failingQuality.passed, false);
assert.deepEqual(failingQuality.blockingFailures, [
  'single_product',
  'product_shape_preserved',
  'product_detail_supported',
]);

console.info('Shot Skill Card A1 checks passed.');
