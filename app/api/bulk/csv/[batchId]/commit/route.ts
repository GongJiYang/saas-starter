import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { commitImportBatch, type ImportRowDecision } from '@/lib/bulk/import-actions';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({
  decisions: z.record(z.enum(['create', 'update', 'exclude'])).default({}),
});

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
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid import decisions.' }, { status: 400 });

  try {
    const result = await commitImportBatch({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      importBatchId: batchId,
      decisions: parsed.data.decisions as Record<string, ImportRowDecision>,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not commit import batch.' },
      { status: 400 },
    );
  }
}
