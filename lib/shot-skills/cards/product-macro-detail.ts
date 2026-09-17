import type { ShotSkillCard } from '../schema';

export const productMacroDetailSkill: ShotSkillCard = {
  spec: 'shot_skill_card', specVersion: '1.0', id: 'product-macro-detail', version: '1.0.0',
  name: 'Product macro detail',
  description: 'Reveal a product detail supported by supplied imagery, then resolve to the complete product.',
  tags: ['macro', 'detail', 'physical-product'],
  goal: 'Reveal one authentic product detail before resolving to a recognizable product frame.',
  eligibility: {
    all: [
      { field: 'shotRole', in: ['hook', 'shared_body', 'proof', 'hero'] },
      { field: 'primaryImageAvailable', equals: true },
      { field: 'detailImageCount', gte: 1 },
    ], any: [], none: [],
  },
  requiredInputs: [
    { type: 'primary_product_image', minimumCount: 1, maximumCount: 1, authorization: 'licensed', mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], blocking: true },
    { type: 'product_detail_image', minimumCount: 1, maximumCount: 3, authorization: 'licensed', mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], blocking: true },
  ],
  camera: {
    shotSize: 'Macro detail to medium close-up.',
    composition: 'Frame one authentic supplied detail, then the complete product.',
    movement: 'Use a slow pull-back or restrained focus transition.',
    focus: 'Move focus from the approved detail to the unchanged product.',
    lighting: 'Use controlled studio light that preserves material and color.',
  },
  timeline: [
    { fromRatio: 0, toRatio: 0.4, action: 'Reveal one authentic detail from the supplied product imagery.' },
    { fromRatio: 0.4, toRatio: 0.8, action: 'Slowly pull back or shift focus without changing the product geometry.' },
    { fromRatio: 0.8, toRatio: 1, action: 'Finish on one complete, recognizable product frame.' },
  ],
  invariants: [
    { code: 'single_product', description: 'Show exactly one product.' },
    { code: 'supplied_details_only', description: 'Use only details present in the supplied product imagery.' },
    { code: 'preserve_product_identity', description: 'Preserve product shape, material, color, and label placement.' },
  ],
  forbidden: [
    { code: 'additional_products', description: 'Additional products or invented product parts.' },
    { code: 'generated_readable_text', description: 'Generated readable packaging text or logo deformation.' },
    { code: 'unsupported_product_details', description: 'A detail that cannot be supported by the supplied images.' },
  ],
  qualityChecks: [
    { code: 'single_product', severity: 'blocking' },
    { code: 'product_shape_preserved', severity: 'blocking' },
    { code: 'product_detail_supported', severity: 'blocking' },
    { code: 'skill_timeline_followed', severity: 'warning' },
  ],
  fallbackSkillId: 'product-hero',
  provider: { id: 'minimax-h3', ratio: '9:16', resolution: '768P', durationSeconds: [4, 5], promptTemplateVersion: '1' },
  provenance: { creator: 'internal', source: 'validated_workflow' }, extensions: {},
};
