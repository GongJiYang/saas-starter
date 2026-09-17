import { NextResponse } from 'next/server';
import { enqueueCsvImport } from '@/lib/queue/csv-import';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { getImportBatchForTeam } from '@/lib/db/bulk-queries';

export async function POST(
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
  const batch = await getImportBatchForTeam(workspace.team.id, batchId);
  if (!batch) return NextResponse.json({ error: 'Import batch not found.' }, { status: 404 });
  if (batch.status === 'committed') return NextResponse.json({ batch, idempotent: true });

  try {
    await enqueueCsvImport({ importBatchId: batchId, teamId: workspace.team.id });
    return NextResponse.json({ queued: true });
  } catch (error) {
    console.error('Could not requeue CSV import:', error);
    return NextResponse.json({ error: 'CSV import queue is unavailable.' }, { status: 503 });
  }
}
