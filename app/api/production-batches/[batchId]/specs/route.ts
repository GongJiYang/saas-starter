import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updateBatchSpecCommonFields } from '@/lib/creative-spec/actions';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({
  visualTreatment: z.string().trim().min(1).max(2000).optional(),
  pacing: z.string().trim().min(1).max(2000).optional(),
  captionPlan: z.string().trim().min(1).max(2000).optional(),
  mustShowElements: z.array(z.string().trim().min(1)).min(1).optional(),
  immutableElements: z.array(z.string().trim().min(1)).min(1).optional(),
  forbiddenElements: z.array(z.string().trim().min(1)).min(1).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one common field is required.' });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid common fields.' }, { status: 400 });
  try {
    const specs = await updateBatchSpecCommonFields({ teamId: workspace.team.id, userId: workspace.user.id, productionBatchId: batchId, fields: parsed.data });
    return NextResponse.json({ specs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update batch Specs.' }, { status: 400 });
  }
}
