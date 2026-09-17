import { compileShotRecipe, stableStringify } from './compiler';
import { evaluateShotSkillEligibility } from './eligibility';
import { shotSkillContextSchema, type CompiledShotRecipe, type ShotSkillCard, type ShotSkillContext } from './schema';

export const SHOT_SKILL_PREVIEW_FIXTURE: ShotSkillContext = {
  shotRole: 'hook',
  productCategory: 'physical-product',
  durationSeconds: 5,
  targetPlatform: 'tiktok',
  primaryImageAvailable: true,
  detailImageCount: 1,
  hasSceneBrief: true,
  personRights: 'owned',
  brandVoice: 'clear, restrained, brand-safe',
  sellingPoints: 'Approved fact: use only the supplied product and its documented details.',
  mustShowElements: ['the supplied product'],
  immutableElements: ['product shape', 'product color', 'label placement'],
  forbiddenElements: ['additional products', 'generated packaging text'],
  shotDirection: 'Open with the approved product, follow the Skill timeline, and finish on a recognizable product frame.',
};

export function compileShotSkillLibraryPreview(skill: ShotSkillCard): CompiledShotRecipe {
  return compileShotRecipe(SHOT_SKILL_PREVIEW_FIXTURE, skill);
}

export type ShotSkillFixturePreview = {
  fixture: ShotSkillContext;
  eligible: boolean;
  reasons: string[];
  fallback: {
    skillId: string;
    eligible: boolean;
    reasons: string[];
  } | null;
  selectedSkillId: string | null;
  selectionReason: string;
  compiled: CompiledShotRecipe | null;
};

export function previewShotSkillFixture(input: {
  fixture: unknown;
  skill: ShotSkillCard;
  fallback?: ShotSkillCard | null;
}): ShotSkillFixturePreview {
  const fixture = shotSkillContextSchema.parse(input.fixture);
  const primary = evaluateShotSkillEligibility(fixture, [input.skill])[0]!;
  const declaredFallback = input.fallback
    && input.fallback.id === input.skill.fallbackSkillId
    ? input.fallback
    : null;
  const fallback = declaredFallback
    ? evaluateShotSkillEligibility(fixture, [declaredFallback])[0]!
    : null;
  const selected = primary.eligible ? input.skill : fallback?.eligible ? declaredFallback : null;
  return {
    fixture,
    eligible: primary.eligible,
    reasons: primary.reasons,
    fallback: fallback ? {
      skillId: fallback.skill.id,
      eligible: fallback.eligible,
      reasons: fallback.reasons,
    } : null,
    selectedSkillId: selected?.id ?? null,
    selectionReason: primary.eligible
      ? 'Draft Skill is eligible for this controlled Fixture.'
      : fallback?.eligible
        ? `Draft Skill is ineligible; declared fallback ${fallback.skill.id} is eligible.`
        : declaredFallback
          ? 'Neither the Draft Skill nor its declared fallback is eligible.'
          : input.skill.fallbackSkillId
            ? `Draft Skill is ineligible and declared fallback ${input.skill.fallbackSkillId} is not an accessible Active Skill.`
            : 'Draft Skill is ineligible and has no declared fallback.',
    compiled: selected ? compileShotRecipe(fixture, selected) : null,
  };
}

export type ShotSkillDefinitionDiff = {
  field: string;
  before: string;
  after: string;
};

const comparableFields: ReadonlyArray<keyof ShotSkillCard> = [
  'name',
  'description',
  'tags',
  'goal',
  'eligibility',
  'requiredInputs',
  'camera',
  'timeline',
  'invariants',
  'forbidden',
  'qualityChecks',
  'fallbackSkillId',
  'provider',
  'provenance',
  'extensions',
];

export function diffShotSkillDefinitions(
  before: ShotSkillCard,
  after: ShotSkillCard,
): ShotSkillDefinitionDiff[] {
  return comparableFields.flatMap((field) => {
    const previous = stableStringify(before[field]);
    const next = stableStringify(after[field]);
    return previous === next ? [] : [{ field, before: previous, after: next }];
  });
}
