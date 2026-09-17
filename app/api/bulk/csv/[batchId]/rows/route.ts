import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { excludeImportRowsForTeam, mapImportRowsBrandKitForTeam, updateImportRowForTeam } from '@/lib/bulk/import-actions';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    rowNumber: z.number().int().positive(),
    rawValues: z.record(z.string(), z.string()),
  }),
  z.object({
    action: z.literal('exclude'),
    rowNumbers: z.array(z.number().int().positive()).min(1).max(1000),
  }),
  z.object({
    action: z.literal('map_brand_kit'),
    rowNumbers: z.array(z.number().int().positive()).min(1).max(1000),
    brandKitName: z.string().trim().min(1).max(160),
  }),
]);

export async function POST(
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
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid row operation.' }, { status: 400 });

  try {
    if (parsed.data.action === 'update') {
      const row = await updateImportRowForTeam({
        teamId: workspace.team.id,
        importBatchId: batchId,
        rowNumber: parsed.data.rowNumber,
        rawValues: parsed.data.rawValues,
      });
      return NextResponse.json({ row });
    }
    if (parsed.data.action === 'map_brand_kit') {
      const rows = await mapImportRowsBrandKitForTeam({
        teamId: workspace.team.id,
        importBatchId: batchId,
        rowNumbers: parsed.data.rowNumbers,
        brandKitName: parsed.data.brandKitName,
      });
      return NextResponse.json({ rows });
    }
    const rows = await excludeImportRowsForTeam({
      teamId: workspace.team.id,
      importBatchId: batchId,
      rowNumbers: parsed.data.rowNumbers,
    });
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update import rows.' },
      { status: 400 },
    );
  }
}
