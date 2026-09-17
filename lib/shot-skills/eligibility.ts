import { getShotSkill, shotSkillRegistry } from './registry';
import {
  shotSkillContextSchema,
  type EligibilityPredicate,
  type ShotSkillCard,
  type ShotSkillContext,
} from './schema';

export type EligibilityBlockerCode =
  | 'unsupported_duration'
  | 'missing_primary_image'
  | 'missing_detail_image'
  | 'missing_scene_brief'
  | 'missing_person_rights'
  | 'unsupported_shot_role'
  | 'unsupported_product_category'
  | 'unsupported_platform'
  | 'unsupported_context';

export type EligibilityRemediation =
  | 'change_duration'
  | 'upload_primary_image'
  | 'upload_detail_image'
  | 'add_scene_brief'
  | 'confirm_person_rights'
  | 'change_shot_role'
  | 'edit_product'
  | 'create_private_skill';

export type EligibilityBlocker = {
  code: EligibilityBlockerCode;
  field: string;
  message: string;
  remediations: EligibilityRemediation[];
};

export type SkillEligibilityResult = {
  skill: ShotSkillCard;
  eligible: boolean;
  blockers: EligibilityBlocker[];
  reasons: string[];
};

export function matchesEligibilityPredicate(
  predicate: EligibilityPredicate,
  context: ShotSkillContext,
): boolean {
  switch (predicate.field) {
    case 'shotRole':
      return predicate.in.includes(context.shotRole);
    case 'productCategory':
      return predicate.in.includes(context.productCategory);
    case 'durationSeconds':
      return predicate.in.includes(context.durationSeconds);
    case 'targetPlatform':
      return predicate.in.includes(context.targetPlatform);
    case 'primaryImageAvailable':
      return context.primaryImageAvailable === predicate.equals;
    case 'detailImageCount':
      return context.detailImageCount >= predicate.gte;
    case 'hasSceneBrief':
      return context.hasSceneBrief === predicate.equals;
    case 'personRights':
      return predicate.in.includes(context.personRights);
  }
}

function predicateBlocker(
  predicate: EligibilityPredicate,
  context: ShotSkillContext,
): EligibilityBlocker {
  switch (predicate.field) {
    case 'primaryImageAvailable':
      return {
        code: 'missing_primary_image',
        field: 'primaryImage',
        message: 'Add a verified primary product image before using this Shot Skill.',
        remediations: ['upload_primary_image'],
      };
    case 'detailImageCount':
      return {
        code: 'missing_detail_image',
        field: 'detailImages',
        message: `Add at least ${predicate.gte} verified product detail image${predicate.gte === 1 ? '' : 's'} before using this Shot Skill.`,
        remediations: ['upload_detail_image'],
      };
    case 'hasSceneBrief':
      return {
        code: 'missing_scene_brief',
        field: 'sceneBrief',
        message: 'Add an approved Scene Brief and confirm any person or character rights before using this Shot Skill.',
        remediations: ['add_scene_brief', 'confirm_person_rights'],
      };
    case 'personRights':
      return {
        code: 'missing_person_rights',
        field: 'personRights',
        message: `Confirm person rights as one of: ${predicate.in.join(', ')}.`,
        remediations: ['confirm_person_rights'],
      };
    case 'shotRole':
      return {
        code: 'unsupported_shot_role',
        field: 'shotRole',
        message: `This Shot Skill does not support the ${context.shotRole} role. Supported roles: ${predicate.in.join(', ')}.`,
        remediations: ['change_shot_role', 'create_private_skill'],
      };
    case 'durationSeconds':
      return {
        code: 'unsupported_duration',
        field: 'durationSeconds',
        message: `This Shot Skill supports ${predicate.in.join(', ')} seconds, not ${context.durationSeconds} seconds.`,
        remediations: ['change_duration', 'create_private_skill'],
      };
    case 'targetPlatform':
      return {
        code: 'unsupported_platform',
        field: 'targetPlatform',
        message: `This Shot Skill does not support ${context.targetPlatform}. Supported platforms: ${predicate.in.join(', ')}.`,
        remediations: ['edit_product', 'create_private_skill'],
      };
    case 'productCategory':
      return {
        code: 'unsupported_product_category',
        field: 'productCategory',
        message: `This Shot Skill does not support ${context.productCategory}. Supported categories: ${predicate.in.join(', ')}.`,
        remediations: ['edit_product', 'create_private_skill'],
      };
  }
}

function genericContextBlocker(message: string): EligibilityBlocker {
  return {
    code: 'unsupported_context',
    field: 'eligibility',
    message,
    remediations: ['edit_product', 'create_private_skill'],
  };
}

function evaluateSkill(skill: ShotSkillCard, context: ShotSkillContext): SkillEligibilityResult {
  const blockers: EligibilityBlocker[] = [];
  for (const predicate of skill.eligibility.all) {
    if (!matchesEligibilityPredicate(predicate, context)) blockers.push(predicateBlocker(predicate, context));
  }
  if (
    skill.eligibility.any.length > 0
    && !skill.eligibility.any.some((predicate) => matchesEligibilityPredicate(predicate, context))
  ) {
    blockers.push(genericContextBlocker('At least one required Shot Skill context condition is missing.'));
  }
  for (const predicate of skill.eligibility.none) {
    if (matchesEligibilityPredicate(predicate, context)) {
      blockers.push(genericContextBlocker('The current product context contains an element prohibited by this Shot Skill.'));
    }
  }
  if (!skill.provider.durationSeconds.includes(context.durationSeconds)) {
    blockers.push({
      code: 'unsupported_duration',
      field: 'durationSeconds',
      message: `This Shot Skill supports ${skill.provider.durationSeconds.join(', ')} seconds, not ${context.durationSeconds} seconds.`,
      remediations: ['change_duration', 'create_private_skill'],
    });
  }
  const uniqueBlockers = [...new Map(blockers.map((blocker) => [
    `${blocker.code}:${blocker.field}:${blocker.message}`,
    blocker,
  ])).values()];
  return {
    skill,
    eligible: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    reasons: uniqueBlockers.map((blocker) => blocker.message),
  };
}

export function evaluateShotSkillEligibility(
  input: unknown,
  skills: readonly ShotSkillCard[] = shotSkillRegistry,
): SkillEligibilityResult[] {
  const context = shotSkillContextSchema.parse(input);
  return skills.map((skill) => evaluateSkill(skill, context));
}

export function selectEligibleShotSkill(
  input: unknown,
  preferredSkillId?: string,
): { skill: ShotSkillCard; reason: string; evaluations: SkillEligibilityResult[] } {
  const context = shotSkillContextSchema.parse(input);
  const evaluations = evaluateShotSkillEligibility(context);
  const preferred = preferredSkillId ? getShotSkill(preferredSkillId) : undefined;

  if (preferred) {
    const preferredResult = evaluations.find((result) => result.skill.id === preferred.id);
    if (preferredResult?.eligible) {
      return { skill: preferred, reason: 'Preferred Shot Skill is eligible.', evaluations };
    }
    if (preferred.fallbackSkillId) {
      const fallback = evaluations.find(
        (result) => result.skill.id === preferred.fallbackSkillId && result.eligible,
      );
      if (fallback) {
        return {
          skill: fallback.skill,
          reason: `${preferred.name} is unavailable for this product; its eligible fallback was selected.`,
          evaluations,
        };
      }
    }
  }

  const firstEligible = evaluations.find((result) => result.eligible);
  if (firstEligible) {
    return { skill: firstEligible.skill, reason: 'Selected the first eligible Shot Skill.', evaluations };
  }

  const reason = evaluations
    .map((result) => `${result.skill.name}: ${result.reasons.join(' ')}`)
    .join(' ');
  throw new Error(`No Shot Skill is available for this product. ${reason}`);
}
