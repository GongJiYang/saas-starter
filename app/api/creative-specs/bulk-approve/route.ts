import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { approveCreativeSpecs } from '@/lib/creative-spec/actions';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({ specVersionIds: z.array(z.number().int().positive()).min(1).max(100) });

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Select awaiting approval Specs.' }, { status: 400 });
  try {
    return NextResponse.json(await approveCreativeSpecs({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      specVersionIds: parsed.data.specVersionIds,
    }));
  } catch (error) {
    return domainErrorResponse(error, 'invalid_transition', {
      teamId: workspace.team.id,
      userId: workspace.user.id,
      operation: 'creative_spec.bulk_approve',
    });
  }
}
