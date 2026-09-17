import { NextRequest, NextResponse } from 'next/server';
import { updateImageBatchItemPrompt } from '@/lib/production-batches/actions';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string; itemId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const params = await context.params;
    const batchId = Number(params.batchId);
    const itemId = Number(params.itemId);
    const body = await request.json().catch(() => null) as { mode?: unknown; prompt?: unknown } | null;
    if (!Number.isSafeInteger(batchId) || batchId <= 0 || !Number.isSafeInteger(itemId) || itemId <= 0 || (body?.mode !== 'inherit' && body?.mode !== 'override')) return NextResponse.json({ error: 'A valid Prompt mode is required.' }, { status: 400 });
    const item = await updateImageBatchItemPrompt({ teamId: workspace.team.id, userId: workspace.user.id, batchId, itemId, mode: body.mode, prompt: typeof body.prompt === 'string' ? body.prompt : undefined });
    return NextResponse.json({ item });
  } catch (error) {
    return domainErrorResponse(error, 'internal_error', { teamId: workspace.team.id, userId: workspace.user.id, operation: 'production_batch.item_prompt.update' });
  }
}
