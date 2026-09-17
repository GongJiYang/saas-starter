import type { ShotSkillCard } from '../schema';

export const productHeroSkill: ShotSkillCard = {
  spec: 'shot_skill_card', specVersion: '1.0', id: 'product-hero', version: '1.0.0',
  name: 'Product hero',
  description: 'Present a supplied product with stable identity and restrained hero movement.',
  tags: ['hero', 'physical-product', 'single-product'],
  goal: 'Present one recognizable product with a controlled, brand-safe hero movement.',
  eligibility: {
    all: [
      { field: 'shotRole', in: ['hook', 'shared_body', 'proof', 'hero', 'transition'] },
      { field: 'primaryImageAvailable', equals: true },
    ], any: [], none: [],
  },
  requiredInputs: [{
    type: 'primary_product_image', minimumCount: 1, maximumCount: 1,
    authorization: 'licensed', mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], blocking: true,
  }],
  camera: {
    shotSize: 'Medium close-up to hero framing.',
    composition: 'Keep one supplied product legible and centered.',
    movement: 'Use a slow push-in or restrained orbit.',
    focus: 'Keep the supplied product recognizable throughout.',
    lighting: 'Use controlled studio light while preserving product color.',
  },
  timeline: [
    { fromRatio: 0, toRatio: 0.2, action: 'Hold the supplied product identity clearly before movement.' },
    { fromRatio: 0.2, toRatio: 0.8, action: 'Use one slow, continuous camera movement without transforming the product.' },
    { fromRatio: 0.8, toRatio: 1, action: 'Resolve on one complete, recognizable product hero frame.' },
  ],
  invariants: [
    { code: 'single_product', description: 'Show exactly one product.' },
    { code: 'preserve_product_identity', description: 'Preserve the supplied product shape, color, materials, and label placement.' },
    { code: 'product_recognizable', description: 'Keep the product recognizable throughout the shot.' },
  ],
  forbidden: [
    { code: 'additional_products', description: 'Additional products or generic companion packaging.' },
    { code: 'generated_readable_text', description: 'Generated readable text or altered product labels.' },
    { code: 'product_deformation', description: 'Rapid movement, explosions, melting, or product deformation.' },
  ],
  qualityChecks: [
    { code: 'single_product', severity: 'blocking' },
    { code: 'product_shape_preserved', severity: 'blocking' },
    { code: 'product_visible_at_end', severity: 'blocking' },
    { code: 'skill_timeline_followed', severity: 'warning' },
  ],
  provider: {
    id: 'minimax-h3', ratio: '9:16', resolution: '768P', durationSeconds: [4, 5], promptTemplateVersion: '1',
  },
  provenance: { creator: 'internal', source: 'validated_workflow' }, extensions: {},
};
