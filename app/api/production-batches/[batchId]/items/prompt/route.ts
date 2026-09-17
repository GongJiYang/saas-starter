import { NextRequest, NextResponse } from 'next/server';
import { updateImageBatchItemsPrompt } from '@/lib/production-batches/actions';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid batch.' }, { status: 400 });
  try {
    const body = await request.json().catch(() => ({})) as { itemIds?: unknown };
    const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((id): id is number => typeof id === 'number') : [];
    return NextResponse.json(await updateImageBatchItemsPrompt({ teamId: workspace.team.id, userId: workspace.user.id, batchId, itemIds, mode: 'inherit' }));
  } catch (error) {
    return domainErrorResponse(error, 'request_invalid', { teamId: workspace.team.id, userId: workspace.user.id, batchId, operation: 'production_batch.items.prompt.bulk' });
  }
}
