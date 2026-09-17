import { NextRequest, NextResponse } from 'next/server';
import { createImageToVideoBatch, createProductionBatch, getProductionBatchProgress } from '@/lib/production-batches/actions';
import { listProductionBatchesForTeam } from '@/lib/db/bulk-queries';
import { listProductionBatchSkillBindingsForTeam } from '@/lib/shot-skills/queries';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function GET() {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const [batches, skillBindings] = await Promise.all([
    listProductionBatchesForTeam(workspace.team.id),
    listProductionBatchSkillBindingsForTeam(workspace.team.id),
  ]);
  const progress = await Promise.all(batches.map(async (batch) => [
    batch.id,
    await getProductionBatchProgress(workspace.team.id, batch.id),
  ] as const));
  return NextResponse.json({ batches, skillBindings, progress: Object.fromEntries(progress) });
}

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const data = await request.json().catch(() => null);
    const batch = data && typeof data === 'object' && (data as { sourceMode?: unknown }).sourceMode === 'uploaded_images'
      ? await createImageToVideoBatch({ teamId: workspace.team.id, userId: workspace.user.id, data })
      : await createProductionBatch({ teamId: workspace.team.id, userId: workspace.user.id, data });
    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error, 'internal_error', {
      teamId: workspace.team.id,
      workspaceName: workspace.team.name,
      userId: workspace.user.id,
      operation: 'production_batch.create',
    });
  }
}
