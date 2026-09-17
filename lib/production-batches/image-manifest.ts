import type { ImageToVideoRecipe } from '@/lib/production-batches/image-video-recipe';

export type ImageVideoManifestRow = {
  sequence: number;
  inputFile: string;
  promptMode: 'inherit' | 'override';
  recipeHash: string;
  jobId: number;
  jobStatus: string;
  outputFile: string;
  reviewDecision: string;
  reviewReason: string;
  reviewedAt: string;
};

export function parseImageVideoRecipeHash(snapshot: string | null): string {
  if (!snapshot) return '';
  try {
    const recipe = JSON.parse(snapshot) as ImageToVideoRecipe;
    return recipe.kind === 'image_to_video' && /^[a-f0-9]{64}$/.test(recipe.recipeHash) ? recipe.recipeHash : '';
  } catch {
    return '';
  }
}

export function toSpreadsheetSafeCsvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderImageVideoManifest(rows: ImageVideoManifestRow[]): string {
  const lines = ['sequence,input_file,prompt_mode,recipe_hash,job_id,job_status,output_file,review_decision,review_reason,reviewed_at'];
  for (const row of rows) lines.push([row.sequence, row.inputFile, row.promptMode, row.recipeHash, row.jobId, row.jobStatus, row.outputFile, row.reviewDecision, row.reviewReason, row.reviewedAt].map((value) => toSpreadsheetSafeCsvCell(value)).join(','));
  return `${lines.join('\n')}\n`;
}
