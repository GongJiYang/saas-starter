import { specEnvelopeSchema } from '@/lib/creative-spec/compiler';
import { compileShotRecipe } from './compiler';
import { evaluateShotSkillEligibility } from './eligibility';
import type { CompiledShotRecipe, ShotSkillCard, ShotSkillContext } from './schema';

export function getPreferredApprovedSpecSkillId(specSnapshot: string): string {
  const envelope = specEnvelopeSchema.parse(JSON.parse(specSnapshot));
  const angleId = envelope.creativeSpec.selectedAngle.id;
  return angleId === 'product-detail'
    ? 'product-macro-detail'
    : angleId === 'product-use-case'
      ? 'product-use-case'
      : 'product-hero';
}

export function getApprovedSpecSkillContext(specSnapshot: string): ShotSkillContext {
  const envelope = specEnvelopeSchema.parse(JSON.parse(specSnapshot));
  const { brief, brandKitSnapshot, creativeSpec } = envelope;
  return {
    shotRole: 'hook',
    productCategory: brief.category,
    durationSeconds: brief.durationSeconds,
    targetPlatform: brief.targetPlatform,
    primaryImageAvailable: true,
    detailImageCount: brief.detailImageUrls.length,
    hasSceneBrief: creativeSpec.selectedAngle.id === 'product-use-case',
    personRights: 'none',
    brandVoice: brandKitSnapshot.brandVoice,
    sellingPoints: brief.approvedClaims.map((claim) => `${claim.text} (${claim.source})`).join('; '),
    mustShowElements: creativeSpec.mustShowElements,
    immutableElements: creativeSpec.immutableElements,
    forbiddenElements: creativeSpec.forbiddenElements,
    shotDirection: [
      `${creativeSpec.selectedAngle.label}: ${creativeSpec.selectedAngle.rationale}`,
      creativeSpec.hookVariants[0].openingHook,
      ...creativeSpec.sharedBodyShotList.map((shot) => shot.description),
    ].join(' '),
  };
}

export function compileApprovedSpecRecipe(input: {
  specSnapshot: string;
  shotSkillVersionId: number;
  skill: ShotSkillCard;
  selectionReason: string;
}): CompiledShotRecipe {
  if (!Number.isSafeInteger(input.shotSkillVersionId) || input.shotSkillVersionId <= 0) {
    throw new Error('Approved Spec compilation requires an explicit Shot Skill version ID.');
  }
  const context = getApprovedSpecSkillContext(input.specSnapshot);
  const eligibility = evaluateShotSkillEligibility(context, [input.skill])[0];
  if (!eligibility?.eligible) {
    throw new Error(`Bound Shot Skill version is not eligible: ${eligibility?.reasons.join(', ') ?? 'unknown reason'}.`);
  }
  return {
    ...compileShotRecipe(context, input.skill),
    selectionReason: input.selectionReason,
  };
}
