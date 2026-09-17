import assert from 'node:assert/strict';
import { renderImageVideoManifest } from '@/lib/production-batches/image-manifest';

const manifest = renderImageVideoManifest([{ sequence: 7, inputFile: '=unsafe.png', promptMode: 'override', recipeHash: 'a'.repeat(64), jobId: 42, jobStatus: 'succeeded', outputFile: 'video.mp4', reviewDecision: 'adopted', reviewReason: '', reviewedAt: '2026-08-13T00:00:00.000Z' }]);
assert.match(manifest, /^sequence,input_file,prompt_mode,recipe_hash,job_id,job_status,output_file,review_decision,review_reason,reviewed_at\n/);
assert.ok(manifest.includes("7,'=unsafe.png,override"));
assert.ok(manifest.includes(',42,succeeded,video.mp4,adopted,,2026-08-13T00:00:00.000Z'));
console.info('Image delivery manifest acceptance check passed.');
