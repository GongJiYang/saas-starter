import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { catalogItems, productionBatchItems, reviews, videoJobs } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

import { saveBatchBrandPreference } from '@/lib/brand-kits/preference-actions';
const recommendations: Record<string, string> = { technical: 'retry technical failures with the same Spec', fidelity: 'review must-show and immutable product constraints', spec_mismatch: 'update the selected Creative Spec fields', preference_change: 'create an explicit Brand Preference only after confirmation', brief_change: 'create a new brief and Creative Spec version' };

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  const rows = await db.select({ item: productionBatchItems, catalogItem: catalogItems, review: reviews }).from(productionBatchItems).innerJoin(catalogItems, eq(productionBatchItems.catalogItemId, catalogItems.id)).leftJoin(videoJobs, eq(videoJobs.campaignId, productionBatchItems.campaignId)).leftJoin(reviews, eq(reviews.videoJobId, videoJobs.id)).where(and(eq(productionBatchItems.teamId, workspace.team.id), eq(productionBatchItems.productionBatchId, batchId)));
  const summaryRows = [...rows.reduce((byItem, row) => {
    const current = byItem.get(row.item.id);
    if (!current || (row.review && (!current.review || row.review.createdAt > current.review.createdAt))) byItem.set(row.item.id, row);
    return byItem;
  }, new Map<number, (typeof rows)[number]>()).values()];
  const rejected = summaryRows.filter((row) => row.review?.decision === 'not_adopted');
  const causeCounts: Record<string, number> = {};
  for (const row of rejected) { const cause = row.review?.qualityFailureCause ?? 'unspecified'; causeCounts[cause] = (causeCounts[cause] ?? 0) + 1; }
  const commonProblems = Object.entries(causeCounts).sort(([, left], [, right]) => right - left).map(([cause, count]) => ({ cause, count, affectedSkus: rejected.filter((row) => (row.review?.qualityFailureCause ?? 'unspecified') === cause).map((row) => row.catalogItem.externalSku), suggestedAction: recommendations[cause] ?? 'review the structured rejection record' }));
  return NextResponse.json({ total: summaryRows.length, readySkuCount: summaryRows.filter((row) => row.item.status === 'ready' || row.item.status === 'completed').length, adoptedCount: summaryRows.filter((row) => row.review?.decision === 'adopted').length, rejectedCount: rejected.length, adoptionRate: summaryRows.length === 0 ? 0 : summaryRows.filter((row) => row.review?.decision === 'adopted').length / summaryRows.length, causeCounts, commonProblems });
}

export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  const parsed = z.object({ confirmed: z.literal(true), preference: z.string().trim().min(1).max(2_000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Explicit confirmation and a Brand Preference are required.' }, { status: 400 });
  try {
    return NextResponse.json(await saveBatchBrandPreference({ teamId: workspace.team.id, userId: workspace.user.id, batchId, preference: parsed.data.preference }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save Brand Preference.' }, { status: 400 });
  }
}
