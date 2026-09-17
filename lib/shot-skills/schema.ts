import { z } from 'zod';

export const shotRoleSchema = z.enum(['hook', 'shared_body', 'proof', 'hero', 'transition']);
export const personRightsSchema = z.enum(['none', 'owned', 'licensed']);
export const shotSkillStatusSchema = z.enum(['draft', 'testing', 'active', 'deprecated', 'retired']);
export const shotSkillScopeSchema = z.enum(['official', 'workspace_private']);

export const SHOT_SKILL_QUALITY_CHECK_CODES = [
  'single_product',
  'product_shape_preserved',
  'product_visible_at_end',
  'product_detail_supported',
  'scene_authorized',
  'skill_timeline_followed',
] as const;

export const SHOT_SKILL_RULE_CODES = [
  'single_product',
  'preserve_product_identity',
  'product_recognizable',
  'supplied_details_only',
  'approved_scene_only',
  'approved_facts_only',
  'additional_products',
  'altered_product_identity',
  'generated_readable_text',
  'product_deformation',
  'unsupported_product_details',
  'unauthorized_people',
  'invented_claims',
] as const;

export const SHOT_SKILL_INPUT_TYPES = ['primary_product_image', 'product_detail_image', 'scene_brief'] as const;
export const SHOT_SKILL_INPUT_AUTHORIZATIONS = ['workspace_owned', 'licensed', 'approved'] as const;
export const SHOT_SKILL_DURATION_SECONDS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

const skillTextSchema = z.string().trim().min(1).max(4_000);
const stableIdSchema = z.string().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const mimeTypeSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/);

const skillProvenanceSchema = z.object({
  creator: skillTextSchema.max(255),
  source: skillTextSchema.max(255),
}).strict();

const skillRequiredInputSchema = z.object({
  type: z.enum(SHOT_SKILL_INPUT_TYPES),
  minimumCount: z.number().int().min(0).max(10),
  maximumCount: z.number().int().min(1).max(10),
  authorization: z.enum(SHOT_SKILL_INPUT_AUTHORIZATIONS),
  mimeTypes: z.array(mimeTypeSchema).min(1).max(10),
  blocking: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.minimumCount > value.maximumCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['minimumCount'], message: 'minimumCount cannot exceed maximumCount.' });
  }
  if (new Set(value.mimeTypes).size !== value.mimeTypes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mimeTypes'], message: 'MIME types must be unique.' });
  }
});

const skillExtensionKeySchema = z.string().regex(
  /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
  'Extension keys must use a namespaced identifier.',
);

export const shotSkillContextSchema = z.object({
  shotRole: shotRoleSchema,
  productCategory: z.string().trim().min(1),
  durationSeconds: z.number().int().min(4).max(15),
  targetPlatform: z.string().trim().min(1),
  primaryImageAvailable: z.boolean(),
  detailImageCount: z.number().int().min(0),
  hasSceneBrief: z.boolean(),
  personRights: personRightsSchema,
  brandVoice: z.string().trim().min(1),
  sellingPoints: z.string().trim().min(1),
  mustShowElements: z.array(z.string().trim().min(1)),
  immutableElements: z.array(z.string().trim().min(1)),
  forbiddenElements: z.array(z.string().trim().min(1)),
  shotDirection: z.string().trim().min(1),
});

const eligibilityPredicateSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('shotRole'), in: z.array(shotRoleSchema).min(1) }).strict(),
  z.object({ field: z.literal('productCategory'), in: z.array(z.string().trim().min(1)).min(1) }).strict(),
  z.object({ field: z.literal('durationSeconds'), in: z.array(z.number().int().min(4).max(15)).min(1) }).strict(),
  z.object({ field: z.literal('targetPlatform'), in: z.array(z.string().trim().min(1)).min(1) }).strict(),
  z.object({ field: z.literal('primaryImageAvailable'), equals: z.boolean() }).strict(),
  z.object({ field: z.literal('detailImageCount'), gte: z.number().int().min(0).max(10) }).strict(),
  z.object({ field: z.literal('hasSceneBrief'), equals: z.boolean() }).strict(),
  z.object({ field: z.literal('personRights'), in: z.array(personRightsSchema).min(1) }).strict(),
]);

const eligibilitySchema = z.object({
  all: z.array(eligibilityPredicateSchema).max(30),
  any: z.array(eligibilityPredicateSchema).max(30),
  none: z.array(eligibilityPredicateSchema).max(30),
}).strict().superRefine((value, context) => {
  const rolePredicates = [...value.all, ...value.any].filter(
    (predicate) => predicate.field === 'shotRole',
  );
  if (rolePredicates.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['all'], message: 'At least one positive structured shotRole predicate is required.' });
  }
});

const cameraGrammarSchema = z.object({
  shotSize: skillTextSchema.max(500),
  composition: skillTextSchema.max(500),
  movement: skillTextSchema.max(500),
  focus: skillTextSchema.max(500),
  lighting: skillTextSchema.max(500),
}).strict();

const timelineBeatSchema = z.object({
  fromRatio: z.number().min(0).max(1),
  toRatio: z.number().min(0).max(1),
  action: skillTextSchema,
}).strict().superRefine((value, context) => {
  if (value.fromRatio >= value.toRatio) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['toRatio'], message: 'Timeline beat end must be greater than its start.' });
  }
});

const legacyRuleCodeSchema = z.string().regex(/^legacy_(?:invariant|forbidden)_\d{2}$/);
const skillRuleCodeSchema = z.union([z.enum(SHOT_SKILL_RULE_CODES), legacyRuleCodeSchema]);
const skillRuleSchema = z.object({ code: skillRuleCodeSchema, description: skillTextSchema.max(1_000) }).strict();
const qualityCheckSchema = z.object({
  code: z.enum(SHOT_SKILL_QUALITY_CHECK_CODES),
  severity: z.enum(['blocking', 'warning']),
}).strict();

const providerOutputSchema = z.object({
  id: z.literal('minimax-h3'),
  ratio: z.literal('9:16'),
  resolution: z.literal('768P'),
  durationSeconds: z.array(z.number().int().min(4).max(15)).min(1).max(12),
  promptTemplateVersion: z.literal('1'),
}).strict().superRefine((value, context) => {
  if (new Set(value.durationSeconds).size !== value.durationSeconds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['durationSeconds'], message: 'Provider durations must be unique.' });
  }
  if (value.durationSeconds.some((duration, index) => index > 0 && duration <= value.durationSeconds[index - 1]!)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['durationSeconds'], message: 'Provider durations must be sorted in ascending order.' });
  }
});

const richShotSkillCardSchema = z.object({
  spec: z.literal('shot_skill_card'),
  specVersion: z.literal('1.0'),
  id: stableIdSchema,
  version: z.string().max(30).regex(/^\d+\.\d+\.\d+$/),
  name: skillTextSchema.max(160),
  description: skillTextSchema,
  tags: z.array(z.string().trim().min(1).max(80)).max(20),
  goal: skillTextSchema,
  eligibility: eligibilitySchema,
  requiredInputs: z.array(skillRequiredInputSchema).max(10),
  camera: cameraGrammarSchema,
  timeline: z.array(timelineBeatSchema).min(1).max(30),
  invariants: z.array(skillRuleSchema).min(1).max(50),
  forbidden: z.array(skillRuleSchema).min(1).max(50),
  qualityChecks: z.array(qualityCheckSchema).min(1).max(30),
  fallbackSkillId: stableIdSchema.optional(),
  provider: providerOutputSchema,
  provenance: skillProvenanceSchema,
  extensions: z.record(skillExtensionKeySchema, z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  const inputTypes = value.requiredInputs.map((input) => input.type);
  if (new Set(inputTypes).size !== inputTypes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['requiredInputs'], message: 'Required input types must be unique.' });
  }
  if (value.timeline[0]?.fromRatio !== 0 || value.timeline.at(-1)?.toRatio !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['timeline'], message: 'Timeline must begin at 0 and end at 1.' });
  }
  for (let index = 1; index < value.timeline.length; index += 1) {
    const previous = value.timeline[index - 1]!;
    const current = value.timeline[index]!;
    if (previous.toRatio !== current.fromRatio) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['timeline', index, 'fromRatio'], message: 'Timeline beats must be contiguous, ordered, and non-overlapping.' });
    }
  }
  const invariantCodes = value.invariants.map((rule) => rule.code);
  const forbiddenCodes = value.forbidden.map((rule) => rule.code);
  if (new Set(invariantCodes).size !== invariantCodes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['invariants'], message: 'Invariant codes must be unique.' });
  }
  if (new Set(forbiddenCodes).size !== forbiddenCodes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['forbidden'], message: 'Forbidden codes must be unique.' });
  }
  for (const code of invariantCodes.filter((candidate) => forbiddenCodes.includes(candidate))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['forbidden'], message: `Rule code ${code} cannot be both invariant and forbidden.` });
  }
  const qualityCodes = value.qualityChecks.map((check) => check.code);
  if (new Set(qualityCodes).size !== qualityCodes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['qualityChecks'], message: 'Quality check codes must be unique.' });
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLegacyRule(value: unknown, kind: 'invariant' | 'forbidden', index: number) {
  if (isRecord(value)) return value;
  return { code: `legacy_${kind}_${String(index + 1).padStart(2, '0')}`, description: value };
}

function normalizeLegacyShotSkillCard(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized = { ...value };
  if (isRecord(normalized.eligibility) && Array.isArray(normalized.eligibility.allowedRoles)) {
    const legacy = normalized.eligibility;
    normalized.eligibility = {
      all: [
        { field: 'shotRole', in: legacy.allowedRoles },
        { field: 'detailImageCount', gte: legacy.minimumDetailImages ?? 0 },
        ...(legacy.requiresPrimaryImage ? [{ field: 'primaryImageAvailable', equals: true }] : []),
        ...(legacy.requiresSceneBrief ? [{ field: 'hasSceneBrief', equals: true }] : []),
      ],
      any: [],
      none: [],
    };
  }
  if (Array.isArray(normalized.requiredInputs)) {
    normalized.requiredInputs = normalized.requiredInputs.map((input) => {
      if (!isRecord(input) || ('authorization' in input && 'mimeTypes' in input)) return input;
      const isSceneBrief = input.type === 'scene_brief';
      return {
        ...input,
        authorization: isSceneBrief ? 'approved' : 'licensed',
        mimeTypes: isSceneBrief ? ['application/json', 'text/plain'] : ['image/jpeg', 'image/png', 'image/webp'],
      };
    });
  }
  if (typeof normalized.camera === 'string') {
    normalized.camera = {
      shotSize: normalized.camera,
      composition: normalized.camera,
      movement: normalized.camera,
      focus: normalized.camera,
      lighting: normalized.camera,
    };
  }
  if (Array.isArray(normalized.invariants)) {
    normalized.invariants = normalized.invariants.map((rule, index) => normalizeLegacyRule(rule, 'invariant', index));
  }
  if (Array.isArray(normalized.forbidden)) {
    normalized.forbidden = normalized.forbidden.map((rule, index) => normalizeLegacyRule(rule, 'forbidden', index));
  }
  if (isRecord(normalized.provider) && !Array.isArray(normalized.provider.durationSeconds)) {
    normalized.provider = { ...normalized.provider, durationSeconds: [...SHOT_SKILL_DURATION_SECONDS] };
  }
  return normalized;
}

/** Strict contract emitted by the editor and accepted for every new save. */
export const shotSkillEditorFormSchema = richShotSkillCardSchema.superRefine((value, context) => {
  for (const [field, rules] of [['invariants', value.invariants], ['forbidden', value.forbidden]] as const) {
    rules.forEach((rule, index) => {
      if (rule.code.startsWith('legacy_')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field, index, 'code'],
          message: 'Select a controlled rule code before saving this legacy definition.',
        });
      }
    });
  }
});
/** Persistent-card reader with explicit normalization for pre-editor definitions. */
export const shotSkillCardSchema = z.preprocess(normalizeLegacyShotSkillCard, richShotSkillCardSchema);

export type ShotRole = z.infer<typeof shotRoleSchema>;
export type PersonRights = z.infer<typeof personRightsSchema>;
export type ShotSkillContext = z.infer<typeof shotSkillContextSchema>;
export type ShotSkillCard = z.infer<typeof richShotSkillCardSchema>;
export type ShotSkillEditorForm = z.infer<typeof shotSkillEditorFormSchema>;
export type EligibilityPredicate = z.infer<typeof eligibilityPredicateSchema>;
export type TimelineBeat = z.infer<typeof timelineBeatSchema>;
export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export type ShotSkillStatus = z.infer<typeof shotSkillStatusSchema>;
export type ShotSkillScope = z.infer<typeof shotSkillScopeSchema>;

export function shotSkillCardToEditorForm(input: unknown): ShotSkillEditorForm {
  return shotSkillCardSchema.parse(input);
}

export function shotSkillEditorFormToCard(input: unknown): ShotSkillCard {
  return shotSkillEditorFormSchema.parse(input);
}

export const compiledShotRecipeSchema = z.object({
  skill: z.object({ id: z.string().min(1), version: z.string().min(1), hash: z.string().length(64) }),
  selectionReason: z.string().min(1).optional(),
  providerNeutralRecipe: z.object({
    goal: z.string().min(1),
    shotDirection: z.string().min(1),
    timeline: z.array(z.string().min(1)).min(1),
    camera: z.string().min(1),
    targetPlatform: z.string().min(1),
    brandVoice: z.string().min(1),
    approvedProductFacts: z.string().min(1),
    mustShowElements: z.array(z.string().min(1)),
    preserveExactly: z.array(z.string().min(1)).min(1),
    neverShow: z.array(z.string().min(1)).min(1),
    output: z.object({
      durationSeconds: z.number().int().min(4).max(15),
      ratio: z.literal('9:16'),
      resolution: z.literal('768P'),
    }),
  }),
  prompt: z.string().min(1),
  qualityChecks: z.array(qualityCheckSchema).min(1),
  compilationTrace: z.array(z.object({ field: z.string().min(1), source: z.string().min(1), value: z.string().min(1) })).min(1),
  recipeHash: z.string().length(64),
});

export type CompiledShotRecipe = z.infer<typeof compiledShotRecipeSchema>;
