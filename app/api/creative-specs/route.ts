import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createCreativeSpecDraft, listCreativeSpecsForTeam } from '@/lib/creative-spec/actions';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const createSchema = z.object({
  campaignId: z.number().int().positive(),
  catalogItemId: z.number().int().positive(),
  referenceAnalysisId: z.number().int().positive().optional(),
  selectedAngleId: z.string().trim().min(1).optional(),
});

export async function GET() {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const specs = await listCreativeSpecsForTeam(workspace.team.id);
  return NextResponse.json({ specs });
}

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid Creative Spec request.' }, { status: 400 });
  try {
    const spec = await createCreativeSpecDraft({ teamId: workspace.team.id, userId: workspace.user.id, ...parsed.data });
    return NextResponse.json({ spec }, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error, 'internal_error', {
      teamId: workspace.team.id,
      userId: workspace.user.id,
      operation: 'creative_spec.create',
    });
  }
}
