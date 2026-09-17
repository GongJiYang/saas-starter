import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { ActivityType, activityLogs, catalogItems, productionBatchItems } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

function escape(value: string): string { return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  const rows = await db.select({ item: productionBatchItems, externalSku: catalogItems.externalSku, productName: catalogItems.productName }).from(productionBatchItems).innerJoin(catalogItems, eq(productionBatchItems.catalogItemId, catalogItems.id)).where(and(eq(productionBatchItems.teamId, workspace.team.id), eq(productionBatchItems.productionBatchId, batchId))).orderBy(asc(productionBatchItems.waveNumber), asc(productionBatchItems.id));
  const lines = ['item_id,sku,product_name,status,is_pilot,wave_number,campaign_id,creative_spec_version_id,last_error,result_summary'];
  for (const row of rows) lines.push([row.item.id, row.externalSku, row.productName, row.item.status, String(row.item.isPilot), row.item.waveNumber, row.item.campaignId ?? '', row.item.creativeSpecVersionId ?? '', row.item.lastError ?? '', row.item.resultSummary].map((value) => escape(String(value))).join(','));
  await db.insert(activityLogs).values({ teamId: workspace.team.id, userId: workspace.user.id, action: ActivityType.EXPORT_PRODUCTION_BATCH });
  return new NextResponse(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="production-batch-${batchId}.csv"`, 'Cache-Control': 'private, no-store' } });
}
