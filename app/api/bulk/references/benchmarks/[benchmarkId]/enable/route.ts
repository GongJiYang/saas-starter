import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enableReferenceBenchmark } from '@/lib/references/actions';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({ confirm: z.literal(true) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ benchmarkId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { benchmarkId: benchmarkIdParam } = await params;
  const benchmarkId = Number(benchmarkIdParam);
  if (!Number.isSafeInteger(benchmarkId) || benchmarkId <= 0) return NextResponse.json({ error: 'Invalid benchmark.' }, { status: 400 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Explicit production gate confirmation is required.' }, { status: 400 });
  try {
    const benchmark = await enableReferenceBenchmark({ teamId: workspace.team.id, benchmarkId, confirm: parsed.data.confirm });
    return NextResponse.json({ benchmark });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not enable reference production.' }, { status: 400 });
  }
}
