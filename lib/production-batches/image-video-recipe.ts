import { createHash } from 'node:crypto';
import type { ProductionBatch, ProductionBatchItem } from '@/lib/db/schema';
import { hashProductionPrompt, resolveProductionItemPrompt } from './prompts';

export type ImageToVideoRecipe = {
  kind: 'image_to_video';
  inputAssetId: number;
  promptMode: ProductionBatchItem['promptMode'];
  sharedPromptVersion: number;
  prompt: string;
  promptHash: string;
  provider: 'minimax-h3';
  output: { durationSeconds: number; ratio: string; resolution: string };
  recipeHash: string;
};

export function compileImageToVideoRecipe(input: {
  batch: Pick<ProductionBatch, 'sharedPrompt' | 'sharedPromptVersion' | 'durationSeconds' | 'targetPlatform'>;
  item: Pick<ProductionBatchItem, 'inputAssetId' | 'promptMode' | 'promptOverride'>;
}): ImageToVideoRecipe {
  if (input.item.inputAssetId === null) throw new Error('Image-to-Video Recipe requires an input Asset.');
  const prompt = resolveProductionItemPrompt(input.batch, input.item);
  const promptHash = hashProductionPrompt(prompt);
  const output = { durationSeconds: input.batch.durationSeconds, ratio: '9:16', resolution: '768P' } as const;
  const recipeHash = createHash('sha256').update(JSON.stringify({
    kind: 'image_to_video',
    inputAssetId: input.item.inputAssetId,
    promptMode: input.item.promptMode,
    sharedPromptVersion: input.batch.sharedPromptVersion,
    promptHash,
    output,
    targetPlatform: input.batch.targetPlatform,
  })).digest('hex');
  return {
    kind: 'image_to_video',
    inputAssetId: input.item.inputAssetId,
    promptMode: input.item.promptMode,
    sharedPromptVersion: input.batch.sharedPromptVersion,
    prompt,
    promptHash,
    provider: 'minimax-h3',
    output,
    recipeHash,
  };
}
