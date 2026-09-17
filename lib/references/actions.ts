import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  catalogItems,
  creativeReferences,
  referenceAnalyses,
  referenceBenchmarks,
} from '@/lib/db/schema';
import { creativeReferenceSchema, referenceAnalysisSchema } from '@/lib/bulk/contracts';
import { REFERENCE_MAX_BYTES, type ReferenceContentType } from '@/lib/storage/cos';

export async function createCreativeReference(input: {
  teamId: number;
  userId: number;
  sourceId: string;
  rights: 'owned' | 'licensed' | 'inspiration_only';
  mode: 'structure' | 'owned_template';
  objectKey: string;
  sourceUrl?: string;
  contentType: ReferenceContentType;
  byteSize: number;
  catalogItemId?: number;
}) {
  creativeReferenceSchema.parse({ sourceId: input.sourceId, rights: input.rights, mode: input.mode });
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > REFERENCE_MAX_BYTES) {
    throw new Error('Reference video size is invalid.');
  }
  if (!input.objectKey.startsWith(`teams/${input.teamId}/references/`)) {
    throw new Error('Reference object must belong to the current workspace.');
  }
  if (input.catalogItemId) {
    const catalogItem = await db.select({ id: catalogItems.id }).from(catalogItems).where(and(
      eq(catalogItems.teamId, input.teamId),
      eq(catalogItems.id, input.catalogItemId),
    )).limit(1);
    if (!catalogItem[0]) throw new Error('CatalogItem does not belong to the current workspace.');
  }
  const inserted = await db.insert(creativeReferences).values({
    teamId: input.teamId,
    uploadedBy: input.userId,
    catalogItemId: input.catalogItemId,
    sourceId: input.sourceId,
    objectKey: input.objectKey,
    sourceUrl: input.sourceUrl,
    rights: input.rights,
    mode: input.mode,
    contentType: input.contentType,
    byteSize: input.byteSize,
  }).returning();
  return inserted[0];
}

export async function approveReferenceAnalysis(input: {
  teamId: number;
  userId: number;
  analysisId: number;
}) {
  const rows = await db.select({ analysis: referenceAnalyses, reference: creativeReferences })
    .from(referenceAnalyses)
    .innerJoin(creativeReferences, eq(referenceAnalyses.creativeReferenceId, creativeReferences.id))
    .where(and(eq(referenceAnalyses.teamId, input.teamId), eq(referenceAnalyses.id, input.analysisId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('Reference analysis not found.');
  if (row.analysis.status !== 'draft') throw new Error('Only draft reference analyses can be approved.');
  const parsed = referenceAnalysisSchema.safeParse(JSON.parse(row.analysis.analysisSnapshot));
  if (!parsed.success) throw new Error('Reference analysis is not valid for approval.');
  const updated = await db.update(referenceAnalyses).set({ status: 'approved', updatedAt: new Date() })
    .where(and(eq(referenceAnalyses.teamId, input.teamId), eq(referenceAnalyses.id, input.analysisId)))
    .returning();
  return updated[0];
}

export async function bindReferenceToCatalogItem(input: {
  teamId: number;
  creativeReferenceId: number;
  catalogItemId: number | null;
}) {
  if (input.catalogItemId !== null) {
    const catalogItem = await db.select({ id: catalogItems.id }).from(catalogItems).where(and(
      eq(catalogItems.teamId, input.teamId),
      eq(catalogItems.id, input.catalogItemId),
    )).limit(1);
    if (!catalogItem[0]) throw new Error('CatalogItem does not belong to the current workspace.');
  }
  const updated = await db.update(creativeReferences).set({
    catalogItemId: input.catalogItemId,
    updatedAt: new Date(),
  }).where(and(
    eq(creativeReferences.teamId, input.teamId),
    eq(creativeReferences.id, input.creativeReferenceId),
  )).returning();
  if (!updated[0]) throw new Error('Reference video not found.');
  return updated[0];
}

export async function recordReferenceBenchmark(input: {
  teamId: number;
  userId: number;
  creativeReferenceId: number;
  provider?: string;
  model?: string;
  costCny?: number;
  continuityScore?: number;
  productAccuracyScore?: number;
  notes?: string;
  outperformsStructure: boolean;
}) {
  const reference = await db.select({ id: creativeReferences.id }).from(creativeReferences).where(and(
    eq(creativeReferences.teamId, input.teamId),
    eq(creativeReferences.id, input.creativeReferenceId),
  )).limit(1);
  if (!reference[0]) throw new Error('Reference video not found.');
  for (const score of [input.continuityScore, input.productAccuracyScore]) {
    if (score !== undefined && (score < 0 || score > 1)) throw new Error('Benchmark scores must be between 0 and 1.');
  }
  if (input.costCny !== undefined && input.costCny < 0) throw new Error('Benchmark cost cannot be negative.');
  const inserted = await db.insert(referenceBenchmarks).values({
    teamId: input.teamId,
    creativeReferenceId: input.creativeReferenceId,
    createdBy: input.userId,
    provider: input.provider ?? 'minimax',
    model: input.model ?? 'h3',
    costCny: input.costCny === undefined ? undefined : String(input.costCny),
    continuityScore: input.continuityScore === undefined ? undefined : String(input.continuityScore),
    productAccuracyScore: input.productAccuracyScore === undefined ? undefined : String(input.productAccuracyScore),
    notes: input.notes,
    outperformsStructure: input.outperformsStructure,
  }).returning();
  return inserted[0];
}

export async function enableReferenceBenchmark(input: {
  teamId: number;
  benchmarkId: number;
  confirm: boolean;
}) {
  if (!input.confirm) throw new Error('Explicit confirmation is required to enable reference_video production.');
  const benchmark = await db.select().from(referenceBenchmarks).where(and(
    eq(referenceBenchmarks.teamId, input.teamId),
    eq(referenceBenchmarks.id, input.benchmarkId),
  )).limit(1);
  if (!benchmark[0]) throw new Error('Reference benchmark not found.');
  if (!benchmark[0].outperformsStructure) throw new Error('Reference benchmark must explicitly outperform structure extraction.');
  const updated = await db.update(referenceBenchmarks).set({ productionEnabled: true })
    .where(and(eq(referenceBenchmarks.teamId, input.teamId), eq(referenceBenchmarks.id, input.benchmarkId)))
    .returning();
  return updated[0];
}
