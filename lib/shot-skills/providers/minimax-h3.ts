import type { CompiledShotRecipe } from '../schema';

export type MiniMaxH3SkillRequest = {
  durationSeconds: number;
  referenceImageUrl: string;
  imageRole: 'reference_image';
  prompt: string;
};

export function toMiniMaxH3Request(
  recipe: CompiledShotRecipe,
  referenceImageUrl: string,
): MiniMaxH3SkillRequest {
  if (!referenceImageUrl.trim()) {
    throw new Error('A reference image URL is required for MiniMax H3 execution.');
  }

  return {
    durationSeconds: recipe.providerNeutralRecipe.output.durationSeconds,
    imageRole: 'reference_image',
    referenceImageUrl,
    prompt: recipe.prompt,
  };
}
