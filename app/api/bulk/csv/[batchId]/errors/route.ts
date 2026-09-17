import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { importRows } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { csvColumns } from '@/lib/bulk/csv';

function escape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function json<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { batchId: batchIdParam } = await params;
  const batchId = Number(batchIdParam);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) {
    return NextResponse.json({ error: 'Invalid import batch.' }, { status: 400 });
  }

  const rows = await db.select().from(importRows).where(and(
    eq(importRows.teamId, workspace.team.id),
    eq(importRows.importBatchId, batchId),
  )).orderBy(asc(importRows.rowNumber));
  const rawRows = rows.map((row) => ({
    raw: json<Record<string, string>>(row.rawValues, {}),
    errors: json<Array<{ code?: string; field?: string; message?: string }>>(row.errors, []),
  }));
  const originalColumns = [...new Set([
    ...csvColumns,
    ...rawRows.flatMap(({ raw }) => Object.keys(raw)),
  ])];
  const headers = [...originalColumns, 'error_code', 'error_column', 'error_message'];
  const lines = [headers.join(',')];
  for (const { raw, errors } of rawRows) {
    const firstError = errors[0];
    lines.push([
      ...originalColumns.map((column) => escape(raw[column] ?? '')),
      escape(firstError?.code ?? ''),
      escape(firstError?.field ?? ''),
      escape(firstError?.message ?? ''),
    ].join(','));
  }

  return new NextResponse(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sku-import-${batchId}-errors.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
