import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { bindRemediationCanary, createBatchRemediation, evaluateRemediationCanary, releaseRemainingRemediation } from '@/lib/quality/remediation';

const requestSchema = z.object({
  itemIds: z.array(z.number().int().positive()).min(2).max(3),
  request: z.object({ cause: z.enum(['technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change']), changedInputField: z.string().trim().min(1), affectedShotPlanId: z.string().trim().min(1).optional(), parentSpecVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(), note: z.string().trim().min(1).optional() }).strict(),
  fields: z.object({ visualTreatment: z.string().trim().min(1).optional(), pacing: z.string().trim().min(1).optional(), captionPlan: z.string().trim().min(1).optional(), mustShowElements: z.array(z.string().trim().min(1)).optional(), immutableElements: z.array(z.string().trim().min(1)).optional(), forbiddenElements: z.array(z.string().trim().min(1)).optional() }).strict(),
}).strict();
const pairSchema = z.object({ itemId: z.number().int().positive(), specVersionId: z.number().int().positive() }).strict();
const bindSchema = z.object({ pairs: z.array(pairSchema).min(2).max(3) }).strict();
const evaluateSchema = z.object({ itemIds: z.array(z.number().int().positive()).min(2).max(3) }).strict();
const releaseSchema = z.object({ canaryItemIds: z.array(z.number().int().positive()).min(2).max(3), pairs: z.array(pairSchema).min(1) }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string; action: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const params = await context.params;
  const batchId = Number(params.batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);
  try {
    if (params.action === 'create') {
      const parsed = requestSchema.parse(body);
      return NextResponse.json(await createBatchRemediation({ teamId: workspace.team.id, userId: workspace.user.id, batchId, ...parsed }), { status: 201 });
    }
    if (params.action === 'bind') {
      const parsed = bindSchema.parse(body);
      return NextResponse.json(await bindRemediationCanary({ teamId: workspace.team.id, batchId, ...parsed }));
    }
    if (params.action === 'evaluate') {
      const parsed = evaluateSchema.parse(body);
      return NextResponse.json(await evaluateRemediationCanary({ teamId: workspace.team.id, batchId, ...parsed }));
    }
    if (params.action === 'release') {
      const parsed = releaseSchema.parse(body);
      return NextResponse.json(await releaseRemainingRemediation({ teamId: workspace.team.id, batchId, ...parsed }));
    }
    return NextResponse.json({ error: 'Unknown remediation action.' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Remediation action failed.' }, { status: 400 });
  }
}
