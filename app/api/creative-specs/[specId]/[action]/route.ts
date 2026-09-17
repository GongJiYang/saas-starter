import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { approveCreativeSpec, rejectCreativeSpec, submitCreativeSpecForApproval } from '@/lib/creative-spec/actions';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const rejectSchema = z.object({ rejectionCode: z.string().trim().min(1).max(50), rejectionNote: z.string().trim().max(2000).optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ specId: string; action: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { specId: specIdParam, action } = await params;
  const specVersionId = Number(specIdParam);
  if (!Number.isSafeInteger(specVersionId) || specVersionId <= 0 || !['submit', 'approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid Creative Spec action.' }, { status: 400 });
  }
  try {
    if (action === 'submit') {
      return NextResponse.json({ spec: await submitCreativeSpecForApproval({ teamId: workspace.team.id, specVersionId }) });
    }
    if (action === 'approve') {
      const approved = await approveCreativeSpec({
        teamId: workspace.team.id,
        userId: workspace.user.id,
        specVersionId,
      });
      return NextResponse.json(approved);
    }
    const parsed = rejectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Structured rejection reason is required.' }, { status: 400 });
    return NextResponse.json({ spec: await rejectCreativeSpec({ teamId: workspace.team.id, userId: workspace.user.id, specVersionId, ...parsed.data }) });
  } catch (error) {
    return domainErrorResponse(error, 'invalid_transition', {
      teamId: workspace.team.id,
      userId: workspace.user.id,
      specVersionId,
      action,
    });
  }
}
