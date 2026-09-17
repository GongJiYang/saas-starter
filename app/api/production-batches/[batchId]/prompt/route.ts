import { NextRequest, NextResponse } from 'next/server';
import { updateImageBatchSharedPrompt } from '@/lib/production-batches/actions';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const batchId = Number((await context.params).batchId);
    const body = await request.json().catch(() => null) as { prompt?: unknown } | null;
    if (!Number.isSafeInteger(batchId) || batchId <= 0 || typeof body?.prompt !== 'string') return NextResponse.json({ error: 'A valid Shared Prompt is required.' }, { status: 400 });
    const batch = await updateImageBatchSharedPrompt({ teamId: workspace.team.id, userId: workspace.user.id, batchId, prompt: body.prompt });
    return NextResponse.json({ batch });
  } catch (error) {
    return domainErrorResponse(error, 'internal_error', { teamId: workspace.team.id, userId: workspace.user.id, operation: 'production_batch.prompt.update' });
  }
}
