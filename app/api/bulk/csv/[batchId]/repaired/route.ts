import { and, asc, eq, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { CSV_MAX_ROWS, CSV_TEMPLATE_VERSION } from '@/lib/bulk/contracts';
import { createCsvDocument } from '@/lib/bulk/template';
import { db } from '@/lib/db/drizzle';
import { brandKits, importBatches, importRows } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

function parseJson<T>(value: string | null, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
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

  const [batchRows, rows, workspaceBrandKits] = await Promise.all([
    db.select({ id: importBatches.id }).from(importBatches).where(and(
      eq(importBatches.teamId, workspace.team.id),
      eq(importBatches.id, batchId),
    )).limit(1),
    db.select().from(importRows).where(and(
      eq(importRows.teamId, workspace.team.id),
      eq(importRows.importBatchId, batchId),
      ne(importRows.status, 'excluded'),
    )).orderBy(asc(importRows.rowNumber)),
    db.select({ id: brandKits.id, name: brandKits.name }).from(brandKits).where(eq(brandKits.teamId, workspace.team.id)),
  ]);
  if (!batchRows[0]) return NextResponse.json({ error: 'Import batch not found.' }, { status: 404 });

  const namesById = new Map(workspaceBrandKits.map((kit) => [kit.id, kit.name]));
  const repairedRows = rows.map((row) => {
    const raw = parseJson<Record<string, string>>(row.rawValues, {});
    const normalized = parseJson<{ brandKitId?: number; brandKitName?: string }>(row.normalizedValues, {});
    const brandKitName = raw.brand_kit_name
      || normalized.brandKitName
      || (normalized.brandKitId ? namesById.get(normalized.brandKitId) : undefined)
      || (raw.brand_kit_id ? namesById.get(Number(raw.brand_kit_id)) : undefined)
      || '';
    const { brand_kit_id: _legacyBrandKitId, ...v2 } = raw;
    return { ...v2, brand_kit_name: brandKitName };
  });
  const body = createCsvDocument(repairedRows, [
    `# csv_template_version=${CSV_TEMPLATE_VERSION}`,
    `# csv_max_rows=${CSV_MAX_ROWS}`,
    `# repaired_from_import_batch=${batchId}`,
    `# workspace=${workspace.team.name}`,
    `# available_brand_kits=${workspaceBrandKits.map((kit) => kit.name).join(' | ') || 'none'}`,
  ]);

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sku-import-${batchId}-repaired-${CSV_TEMPLATE_VERSION}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
