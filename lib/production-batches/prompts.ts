import { createHash } from 'node:crypto';
import type { ProductionBatch, ProductionBatchItem } from '@/lib/db/schema';

export function resolveProductionItemPrompt(batch: Pick<ProductionBatch, 'sharedPrompt'>, item: Pick<ProductionBatchItem, 'promptMode' | 'promptOverride'>): string {
  if (item.promptMode === 'override') {
    const prompt = item.promptOverride?.trim() ?? '';
    if (!prompt) throw new Error('Prompt override cannot be empty.');
    return prompt;
  }
  const prompt = batch.sharedPrompt.trim();
  if (!prompt) throw new Error('Shared Prompt cannot be empty.');
  return prompt;
}

export function hashProductionPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}
