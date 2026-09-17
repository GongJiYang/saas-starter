import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { recordReferenceBenchmark } from '@/lib/references/actions';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({
  creativeReferenceId: z.number().int().positive(),
  provider: z.string().trim().min(1).max(50).optional(),
  model: z.string().trim().min(1).max(80).optional(),
  costCny: z.number().nonnegative().optional(),
  continuityScore: z.number().min(0).max(1).optional(),
  productAccuracyScore: z.number().min(0).max(1).optional(),
  notes: z.string().trim().max(4000).optional(),
  outperformsStructure: z.boolean(),
});

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid benchmark record.' }, { status: 400 });
  try {
    const benchmark = await recordReferenceBenchmark({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      ...parsed.data,
    });
    return NextResponse.json({ benchmark }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not record benchmark.' }, { status: 400 });
  }
}
