import { NextResponse } from 'next/server';
import { getCreativeReferenceForTeam } from '@/lib/db/bulk-queries';
import { enqueueReferenceAnalysis } from '@/lib/queue/reference-analysis';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ referenceId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { referenceId: referenceIdParam } = await params;
  const referenceId = Number(referenceIdParam);
  if (!Number.isSafeInteger(referenceId) || referenceId <= 0) return NextResponse.json({ error: 'Invalid reference.' }, { status: 400 });
  const reference = await getCreativeReferenceForTeam(workspace.team.id, referenceId);
  if (!reference) return NextResponse.json({ error: 'Reference video not found.' }, { status: 404 });
  try {
    await enqueueReferenceAnalysis({ teamId: workspace.team.id, creativeReferenceId: referenceId });
    return NextResponse.json({ queued: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not queue analysis.' }, { status: 503 });
  }
}
