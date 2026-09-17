import assert from 'node:assert/strict';
import { creativeSpecSchema } from '../lib/bulk';
import { compileProductBrief, compileSpecEnvelope, rankEligibleAngles, specEnvelopeSchema } from '../lib/creative-spec/compiler';
import { assertContractTransition, canTransition } from '../lib/bulk/contracts';
import { compileApprovedSpecRecipe } from '../lib/shot-skills';
import { productHeroSkill } from '../lib/shot-skills/cards/product-hero';
import type { BrandKit, Campaign, CatalogItem } from '../lib/db/schema';

const catalogItem = {
  id: 1,
  externalSku: 'SKU-SPEC-001',
  productName: 'Demo bottle',
  category: 'fragrance',
  primaryImageUrl: 'https://assets.example.com/product.jpg',
  approvedClaims: JSON.stringify([{ text: 'Compact glass bottle', source: 'approved sheet' }]),
  prohibitedClaims: JSON.stringify(['medical treatment']),
  mustShowElements: JSON.stringify(['bottle']),
  immutableElements: JSON.stringify(['label placement']),
  targetAudience: 'mobile shoppers',
  campaignGoal: 'product awareness',
  cta: 'Learn more',
  readinessStatus: 'ready',
} as unknown as CatalogItem;
const campaign = { id: 7, targetPlatform: 'tiktok', durationSeconds: 5 } as unknown as Campaign;
const brandKit = {
  name: 'Demo Brand',
  brandVoice: 'Clear and factual',
  requiredElements: 'bottle',
  forbiddenElements: 'medical claims',
  defaultShotPreference: 'controlled product macro',
} as unknown as BrandKit;

const brief = compileProductBrief({ catalogItem, campaign });
const proposals = rankEligibleAngles(brief);
assert.equal(proposals.length, 3);
assert.equal(proposals.some((proposal) => proposal.id === 'comparison'), false);
assert.equal(proposals.some((proposal) => proposal.id === 'social-proof'), false);
assert.equal(proposals.some((proposal) => proposal.id === 'offer'), false);

const envelope = compileSpecEnvelope({ brief, brandKit, proposals });
assert.equal(specEnvelopeSchema.parse(envelope).creativeSpec.hookVariants.length, 3);
assert.deepEqual(envelope.creativeSpec.hookVariants.map((hook) => hook.id), ['A', 'B', 'C']);
assert.equal(new Set(envelope.creativeSpec.hookVariants.map((hook) => hook.openingHook)).size, 3);
assert.equal(creativeSpecSchema.parse(envelope.creativeSpec).sharedBodyShotList.length, 4);
assert.deepEqual(proposals.map((proposal) => proposal.id), ['product-detail', 'product-use-case', 'claim-proof']);
assert.equal(proposals.some((proposal) => ['pain', 'benefit', 'scene'].includes(proposal.id)), false);
const productionRecipe = compileApprovedSpecRecipe({
  specSnapshot: JSON.stringify(envelope),
  shotSkillVersionId: 1,
  skill: productHeroSkill,
  selectionReason: 'product-macro-detail was not eligible; selected its persisted fallback',
});
assert.match(productionRecipe.prompt, /Compact glass bottle/);
assert.equal(productionRecipe.providerNeutralRecipe.mustShowElements.includes('bottle'), true);
assert.match(productionRecipe.selectionReason ?? '', /persisted fallback/);
assert.equal(canTransition('creative_spec', 'draft', 'awaiting_approval'), true);
assert.throws(() => assertContractTransition('creative_spec', 'draft', 'approved'));

console.log('Creative Spec checks passed.');
