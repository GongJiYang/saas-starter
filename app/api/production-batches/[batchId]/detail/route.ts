import { NextResponse } from 'next/server';
import { getGuidedProductionBatchDetailForTeam } from '@/lib/production-batches/detail';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) {
    return NextResponse.json({ error: 'Invalid Production task.' }, { status: 400 });
  }
  const detail = await getGuidedProductionBatchDetailForTeam(workspace.team.id, batchId);
  if (!detail) return NextResponse.json({ error: 'Production task not found.' }, { status: 404 });
  return NextResponse.json({ detail });
}
