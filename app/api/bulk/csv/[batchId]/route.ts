import { and, desc, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { importBatches, importRows } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { listBrandKitsForTeam } from '@/lib/db/video-queries';

const statusSchema = z.enum(['pending', 'ready', 'needs_fix', 'excluded', 'committed']);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { batchId: batchIdParam } = await params;
  const batchId = Number(batchIdParam);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) {
    return NextResponse.json({ error: 'Invalid import batch.' }, { status: 400 });
  }

  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') ?? '1'));
  const pageSize = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get('pageSize') ?? '50')));
  const status = request.nextUrl.searchParams.get('status');
  const parsedStatus = status ? statusSchema.safeParse(status) : null;
  if (status && !parsedStatus?.success) return NextResponse.json({ error: 'Invalid row status.' }, { status: 400 });

  const batch = await db.select().from(importBatches).where(and(
    eq(importBatches.teamId, workspace.team.id),
    eq(importBatches.id, batchId),
  )).limit(1);
  if (!batch[0]) return NextResponse.json({ error: 'Import batch not found.' }, { status: 404 });

  const conditions = [eq(importRows.teamId, workspace.team.id), eq(importRows.importBatchId, batchId)];
  if (parsedStatus?.success) conditions.push(eq(importRows.status, parsedStatus.data));
  const rows = await db.select().from(importRows)
    .where(and(...conditions))
    .orderBy(importRows.rowNumber)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const count = await db.select({ count: sql<number>`count(*)` }).from(importRows).where(and(...conditions));
  const workspaceBrandKits = await listBrandKitsForTeam(workspace.team.id);

  return NextResponse.json({
    batch: batch[0],
    workspace: { name: workspace.team.name },
    brandKits: workspaceBrandKits.map((kit) => ({ id: kit.id, name: kit.name })),
    rows: rows.map((row) => ({
      ...row,
      rawValues: safeJson(row.rawValues, {}),
      normalizedValues: safeJson(row.normalizedValues, null),
      errors: safeJson(row.errors, []),
    })),
    page,
    pageSize,
    totalRows: Number(count[0]?.count ?? 0),
  });
}

function safeJson(value: string | null, fallback: unknown) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
