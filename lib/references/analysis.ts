import { createHash } from 'node:crypto';
import { z } from 'zod';
import { referenceAnalysisSchema } from '@/lib/bulk/contracts';

export function createHeuristicReferenceAnalysis(input: {
  sourceId: string;
  durationSeconds: number;
  ratio: '9:16' | '1:1' | '4:5' | '16:9';
}) {
  const shotCount = Math.min(6, Math.max(2, Math.ceil(input.durationSeconds / 4)));
  const shotDuration = input.durationSeconds / shotCount;
  const shots = Array.from({ length: shotCount }, (_, index) => {
    const fromSeconds = Number((index * shotDuration).toFixed(3));
    const toSeconds = index === shotCount - 1
      ? input.durationSeconds
      : Number(((index + 1) * shotDuration).toFixed(3));
    const isLast = index === shotCount - 1;
    const role = index === 0 ? 'hook' : isLast ? 'cta' : index === 1 ? 'hero' : 'body';
    const pace = shotDuration <= 2 ? 'fast' : shotDuration <= 5 ? 'medium' : 'slow';
    return {
      fromSeconds,
      toSeconds,
      role,
      pace,
      cameraMovement: 'unknown',
      composition: 'unknown',
      captionSafeArea: 'unknown',
      ctaPosition: isLast ? 'end' : 'none',
      transition: index === 0 ? 'opening' : 'cut',
    };
  });

  const parsed = referenceAnalysisSchema.parse({
    sourceId: input.sourceId,
    version: '1.0.0',
    durationSeconds: input.durationSeconds,
    ratio: input.ratio,
    shots,
    borrowedStructure: [
      'shot_boundaries',
      'pace',
      'composition',
      'camera_movement',
      'caption_safe_area',
      'cta_position',
    ],
    excludedContent: [
      'original_script',
      'original_audio',
      'third_party_logo',
      'identifiable_person',
      'watermark',
      'signature_set_or_character',
    ],
  });
  const analysisHash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
  return { parsed, analysisHash };
}

export type ReferenceAnalysisResult = z.infer<typeof referenceAnalysisSchema>;
