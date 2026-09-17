import { NextResponse } from 'next/server';
import { deleteImageToVideoBatch } from '@/lib/production-batches/delete';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function DELETE(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  try {
    await deleteImageToVideoBatch({ teamId: workspace.team.id, batchId });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return domainErrorResponse(error, 'request_invalid', { teamId: workspace.team.id, userId: workspace.user.id, batchId, operation: 'production_batch.delete' });
  }
}
