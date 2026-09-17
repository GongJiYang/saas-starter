import type { ShotSkillCard } from '../schema';

export const productUseCaseSkill: ShotSkillCard = {
  spec: 'shot_skill_card', specVersion: '1.0', id: 'product-use-case', version: '1.0.0',
  name: 'Product use case',
  description: 'Show a supplied product in an approved, rights-safe use context before returning focus to the product.',
  tags: ['use-case', 'scene', 'physical-product'],
  goal: 'Show the product in an approved use context while returning attention to the product.',
  eligibility: {
    all: [
      { field: 'shotRole', in: ['hook', 'shared_body', 'proof'] },
      { field: 'primaryImageAvailable', equals: true },
      { field: 'hasSceneBrief', equals: true },
    ], any: [], none: [],
  },
  requiredInputs: [
    { type: 'primary_product_image', minimumCount: 1, maximumCount: 1, authorization: 'licensed', mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], blocking: true },
    { type: 'scene_brief', minimumCount: 1, maximumCount: 1, authorization: 'approved', mimeTypes: ['application/json', 'text/plain'], blocking: true },
  ],
  camera: {
    shotSize: 'Establishing context to product close-up.',
    composition: 'Keep the product readable in one approved context.',
    movement: 'Use restrained movement that returns attention to the product.',
    focus: 'End with focus on the supplied product identity.',
    lighting: 'Match the approved scene while preserving product appearance.',
  },
  timeline: [
    { fromRatio: 0, toRatio: 0.3, action: 'Establish the approved use context without introducing unauthorized people or claims.' },
    { fromRatio: 0.3, toRatio: 0.8, action: 'Show the product in the context while preserving its supplied identity.' },
    { fromRatio: 0.8, toRatio: 1, action: 'Return focus to one recognizable product frame.' },
  ],
  invariants: [
    { code: 'single_product', description: 'Show exactly one supplied product.' },
    { code: 'approved_scene_only', description: 'Use only the approved scene brief and approved product facts.' },
    { code: 'approved_facts_only', description: 'Do not imply an efficacy claim that is not present in the approved facts.' },
  ],
  forbidden: [
    { code: 'unauthorized_people', description: 'Unlicensed identifiable people, hands, voices, or characters.' },
    { code: 'invented_claims', description: 'Invented demonstrations, endorsements, or performance results.' },
    { code: 'altered_product_identity', description: 'Additional products or altered product packaging.' },
  ],
  qualityChecks: [
    { code: 'single_product', severity: 'blocking' },
    { code: 'product_shape_preserved', severity: 'blocking' },
    { code: 'scene_authorized', severity: 'blocking' },
    { code: 'skill_timeline_followed', severity: 'warning' },
  ],
  fallbackSkillId: 'product-hero',
  provider: { id: 'minimax-h3', ratio: '9:16', resolution: '768P', durationSeconds: [4, 5], promptTemplateVersion: '1' },
  provenance: { creator: 'internal', source: 'validated_workflow' }, extensions: {},
};
