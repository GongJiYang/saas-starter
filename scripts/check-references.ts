import assert from 'node:assert/strict';
import { creativeReferenceSchema, referenceAnalysisSchema } from '../lib/bulk';
import { createHeuristicReferenceAnalysis } from '../lib/references/analysis';
import { assertSafeRemoteUrl } from '../lib/bulk/url-safety';
import ffprobe from 'ffprobe-static';

async function main() {
  assert.equal(creativeReferenceSchema.safeParse({ sourceId: 'ref-1', rights: 'owned', mode: 'owned_template' }).success, true);
  assert.equal(creativeReferenceSchema.safeParse({ sourceId: 'ref-2', rights: 'inspiration_only', mode: 'owned_template' }).success, false);
  assert.equal(creativeReferenceSchema.safeParse({ sourceId: 'ref-3', rights: 'licensed', mode: 'structure' }).success, true);

  const result = createHeuristicReferenceAnalysis({ sourceId: 'ref-1', durationSeconds: 12, ratio: '9:16' });
  const parsed = referenceAnalysisSchema.parse(result.parsed);
  assert.equal(parsed.shots.length, 3);
  assert.equal(parsed.shots[0]?.fromSeconds, 0);
  assert.equal(parsed.shots.at(-1)?.toSeconds, 12);
  for (let index = 1; index < parsed.shots.length; index += 1) {
    assert.ok(parsed.shots[index]!.fromSeconds >= parsed.shots[index - 1]!.toSeconds);
  }
  assert.equal(typeof result.analysisHash, 'string');
  assert.ok(result.analysisHash.length === 64);

  await assert.rejects(() => assertSafeRemoteUrl('http://127.0.0.1/video.mp4'));
  await assert.rejects(() => assertSafeRemoteUrl('https://127.0.0.1/video.mp4'));
  await assert.rejects(() => assertSafeRemoteUrl('https://127.0.0.1:8443/video.mp4'));
  assert.ok(ffprobe.path.length > 0);

  console.log('Reference video checks passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
