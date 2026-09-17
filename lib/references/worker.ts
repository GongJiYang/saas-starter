import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  creativeReferences,
  referenceAnalyses,
} from '@/lib/db/schema';
import { getCreativeReferenceForTeam } from '@/lib/db/bulk-queries';
import { downloadReferenceObject } from '@/lib/storage/cos';
import { probeReferenceVideo } from './probe';
import { createHeuristicReferenceAnalysis } from './analysis';

function extensionForContentType(contentType: string): string {
  if (contentType === 'video/quicktime') return 'mov';
  if (contentType === 'video/webm') return 'webm';
  return 'mp4';
}

export async function processReferenceAnalysis(input: {
  teamId: number;
  creativeReferenceId: number;
}): Promise<void> {
  const reference = await getCreativeReferenceForTeam(input.teamId, input.creativeReferenceId);
  if (!reference) return;

  const existing = await db
    .select({ id: referenceAnalyses.id })
    .from(referenceAnalyses)
    .where(and(
      eq(referenceAnalyses.teamId, input.teamId),
      eq(referenceAnalyses.creativeReferenceId, input.creativeReferenceId),
      eq(referenceAnalyses.version, '1.0.0'),
    ))
    .limit(1);
  if (existing[0]) return;

  try {
    const downloaded = await downloadReferenceObject({
      teamId: input.teamId,
      objectKey: reference.objectKey,
    });
    const probe = await probeReferenceVideo({
      body: downloaded.body,
      fileExtension: extensionForContentType(downloaded.contentType),
    });
    await db.update(creativeReferences).set({
      durationSeconds: String(probe.durationSeconds),
      ratio: probe.ratio,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      hasAudioTrack: probe.hasAudioTrack,
      readabilityStatus: 'readable',
      readabilityError: null,
      status: 'analyzing',
      updatedAt: new Date(),
    }).where(and(
      eq(creativeReferences.teamId, input.teamId),
      eq(creativeReferences.id, input.creativeReferenceId),
    ));

    const result = createHeuristicReferenceAnalysis({
      sourceId: reference.sourceId,
      durationSeconds: probe.durationSeconds,
      ratio: probe.ratio,
    });
    await db.insert(referenceAnalyses).values({
      teamId: input.teamId,
      creativeReferenceId: input.creativeReferenceId,
      version: result.parsed.version,
      status: 'draft',
      model: 'heuristic-v1',
      promptVersion: 'structure-v1',
      analysisHash: result.analysisHash,
      analysisSnapshot: JSON.stringify(result.parsed),
      borrowedStructure: JSON.stringify(result.parsed.borrowedStructure),
      excludedContent: JSON.stringify(result.parsed.excludedContent),
    });
    await db.update(creativeReferences).set({
      status: 'analysis_ready',
      updatedAt: new Date(),
    }).where(and(
      eq(creativeReferences.teamId, input.teamId),
      eq(creativeReferences.id, input.creativeReferenceId),
    ));
  } catch (error) {
    await db.update(creativeReferences).set({
      readabilityStatus: 'failed',
      readabilityError: error instanceof Error ? error.message : 'Reference video analysis failed.',
      status: 'failed',
      updatedAt: new Date(),
    }).where(and(
      eq(creativeReferences.teamId, input.teamId),
      eq(creativeReferences.id, input.creativeReferenceId),
    ));
    throw error;
  }
}
