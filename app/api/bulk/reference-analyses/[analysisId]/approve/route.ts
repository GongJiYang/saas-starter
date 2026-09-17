import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { approveReferenceAnalysis } from '@/lib/references/actions';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({ approved: z.literal(true) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ analysisId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { analysisId: analysisIdParam } = await params;
  const analysisId = Number(analysisIdParam);
  if (!Number.isSafeInteger(analysisId) || analysisId <= 0) return NextResponse.json({ error: 'Invalid analysis.' }, { status: 400 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Explicit approval is required.' }, { status: 400 });
  try {
    const analysis = await approveReferenceAnalysis({ teamId: workspace.team.id, userId: workspace.user.id, analysisId });
    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not approve analysis.' }, { status: 400 });
  }
}
