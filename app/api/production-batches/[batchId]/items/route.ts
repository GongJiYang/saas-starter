import { and, asc, count, eq, ilike, inArray, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { campaigns, catalogItems, creativeSpecVersions, productionBatchItems } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const querySchema = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(50).default(50), status: z.enum(['pending', 'pilot', 'ready', 'queued', 'producing', 'quality_review', 'review', 'completed', 'failed', 'excluded']).optional(), waveNumber: z.coerce.number().int().nonnegative().optional(), query: z.string().trim().max(160).optional() });

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid Batch filters.' }, { status: 400 });
  const filters = [eq(productionBatchItems.teamId, workspace.team.id), eq(productionBatchItems.productionBatchId, batchId)];
  if (parsed.data.status) filters.push(eq(productionBatchItems.status, parsed.data.status));
  if (parsed.data.waveNumber !== undefined) filters.push(eq(productionBatchItems.waveNumber, parsed.data.waveNumber));
  if (parsed.data.query) filters.push(ilike(catalogItems.externalSku, `%${parsed.data.query}%`));
  const where = and(...filters);
  const rows = await db.select({
    item: productionBatchItems,
    externalSku: catalogItems.externalSku,
    productName: catalogItems.productName,
    campaignName: campaigns.name,
    specVersion: creativeSpecVersions.version,
    specStatus: creativeSpecVersions.status,
  })
    .from(productionBatchItems)
    .innerJoin(catalogItems, eq(productionBatchItems.catalogItemId, catalogItems.id))
    .leftJoin(campaigns, eq(productionBatchItems.campaignId, campaigns.id))
    .leftJoin(creativeSpecVersions, eq(productionBatchItems.creativeSpecVersionId, creativeSpecVersions.id))
    .where(where)
    .orderBy(asc(productionBatchItems.waveNumber), asc(productionBatchItems.id))
    .limit(parsed.data.pageSize)
    .offset((parsed.data.page - 1) * parsed.data.pageSize);
  const campaignIds = rows
    .map((row) => row.item.campaignId)
    .filter((campaignId): campaignId is number => campaignId !== null);
  const latestSpecs = campaignIds.length
    ? await db.select({
      id: creativeSpecVersions.id,
      campaignId: creativeSpecVersions.campaignId,
      version: creativeSpecVersions.version,
      status: creativeSpecVersions.status,
      createdAt: creativeSpecVersions.createdAt,
    }).from(creativeSpecVersions).where(and(
      eq(creativeSpecVersions.teamId, workspace.team.id),
      inArray(creativeSpecVersions.campaignId, campaignIds),
    )).orderBy(asc(creativeSpecVersions.campaignId), asc(creativeSpecVersions.createdAt))
    : [];
  const latestByCampaign = new Map(latestSpecs.map((spec) => [spec.campaignId, spec]));
  const responseRows = rows.map((row) => {
    const latest = row.item.campaignId ? latestByCampaign.get(row.item.campaignId) : undefined;
    return {
      ...row,
      pendingSpecVersionId: !row.item.creativeSpecVersionId && latest ? latest.id : null,
      pendingSpecVersion: !row.item.creativeSpecVersionId && latest ? latest.version : null,
      pendingSpecStatus: !row.item.creativeSpecVersionId && latest ? latest.status : null,
    };
  });
  const total = await db.select({ value: count() }).from(productionBatchItems).innerJoin(catalogItems, eq(productionBatchItems.catalogItemId, catalogItems.id)).where(where);
  return NextResponse.json({ rows: responseRows, page: parsed.data.page, pageSize: parsed.data.pageSize, total: Number(total[0]?.value ?? 0), pageCount: Math.max(1, Math.ceil(Number(total[0]?.value ?? 0) / parsed.data.pageSize)) });
}
