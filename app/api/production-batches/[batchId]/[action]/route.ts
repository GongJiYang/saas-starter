import { NextRequest, NextResponse } from 'next/server';
import {
  assignProductionBatchWaves,
  changeProductionBatchStatus,
  confirmProductionBatchCost,
  createPilotCampaigns,
  estimateProductionBatchCost,
  evaluateProductionBatchPilot,
  getProductionBatchProgress,
  getImageBatchEligibility,
  observeProductionBatchWave,
  prepareSingleProductionBatch,
  retryImageBatchJobs,
  scheduleImageBatchJobs,
  scheduleNextProductionWave,
  schedulePilotJobs,
  scheduleSingleJob,
  selectImageBatchPilots,
  selectProductionBatchPilots,
} from '@/lib/production-batches/actions';
import {
  createPilotSpecDrafts,
  createProductionBatchItemSpecDraft,
} from '@/lib/production-batches/spec-automation';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string; action: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const params = await context.params;
  const batchId = Number(params.batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: 'Invalid Production Batch.' }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);
  try {
    switch (params.action) {
      case 'image-eligibility': return NextResponse.json(await getImageBatchEligibility({ teamId: workspace.team.id, batchId }));
      case 'estimate-cost': return NextResponse.json({ estimate: await estimateProductionBatchCost({ teamId: workspace.team.id, userId: workspace.user.id, batchId }) });
      case 'confirm-cost': {
        const expected = body && typeof body === 'object' && 'expectedMaxEstimatedCostCny' in body ? body.expectedMaxEstimatedCostCny : undefined;
        if (typeof expected !== 'number') return NextResponse.json({ error: 'expectedMaxEstimatedCostCny is required.' }, { status: 400 });
        return NextResponse.json({ confirmation: await confirmProductionBatchCost({ teamId: workspace.team.id, userId: workspace.user.id, batchId, expectedMaxEstimatedCostCny: expected }) });
      }
      case 'select-image-pilots': {
        const itemIds = body && typeof body === 'object' && Array.isArray((body as { itemIds?: unknown }).itemIds)
          ? (body as { itemIds: unknown[] }).itemIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
          : undefined;
        return NextResponse.json(await selectImageBatchPilots({ teamId: workspace.team.id, userId: workspace.user.id, batchId, itemIds }));
      }
      case 'select-pilots': return NextResponse.json(await selectProductionBatchPilots({ teamId: workspace.team.id, userId: workspace.user.id, batchId }));
      case 'create-pilot-campaigns': return NextResponse.json(await createPilotCampaigns({ teamId: workspace.team.id, userId: workspace.user.id, batchId }));
      case 'prepare-single': return NextResponse.json(await prepareSingleProductionBatch({ teamId: workspace.team.id, userId: workspace.user.id, batchId }));
      case 'create-item-spec': {
        const itemId = body && typeof body === 'object' && 'itemId' in body ? Number(body.itemId) : NaN;
        if (!Number.isSafeInteger(itemId) || itemId <= 0) {
          return NextResponse.json({ error: 'Choose a valid Production Batch SKU.' }, { status: 400 });
        }
        return NextResponse.json({ result: await createProductionBatchItemSpecDraft({
          teamId: workspace.team.id,
          userId: workspace.user.id,
          batchId,
          itemId,
        }) });
      }
      case 'create-pilot-specs': return NextResponse.json(await createPilotSpecDrafts({
        teamId: workspace.team.id,
        userId: workspace.user.id,
        batchId,
      }));
      case 'schedule-pilot': return NextResponse.json(await schedulePilotJobs({ teamId: workspace.team.id, userId: workspace.user.id, batchId }), { status: 202 });
      case 'schedule-single': return NextResponse.json(await scheduleSingleJob({ teamId: workspace.team.id, userId: workspace.user.id, batchId }), { status: 202 });
      case 'schedule-image-pilot': return NextResponse.json(await scheduleImageBatchJobs({ teamId: workspace.team.id, userId: workspace.user.id, batchId, pilotOnly: true }), { status: 202 });
      case 'schedule-image-batch': return NextResponse.json(await scheduleImageBatchJobs({ teamId: workspace.team.id, userId: workspace.user.id, batchId, pilotOnly: false }), { status: 202 });
      case 'retry-image-failed':
      case 'regenerate-image-items': {
        const itemIds = body && typeof body === 'object' && Array.isArray((body as { itemIds?: unknown }).itemIds)
          ? (body as { itemIds: unknown[] }).itemIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
          : [];
        return NextResponse.json(await retryImageBatchJobs({
          teamId: workspace.team.id,
          userId: workspace.user.id,
          batchId,
          itemIds,
          useCurrentPrompt: params.action === 'regenerate-image-items',
        }), { status: 202 });
      }
      case 'evaluate-pilot': return NextResponse.json(await evaluateProductionBatchPilot({ teamId: workspace.team.id, userId: workspace.user.id, batchId }));
      case 'assign-waves': return NextResponse.json(await assignProductionBatchWaves({ teamId: workspace.team.id, batchId }));
      case 'schedule-wave': return NextResponse.json(await scheduleNextProductionWave({ teamId: workspace.team.id, userId: workspace.user.id, batchId }), { status: 202 });
      case 'observe-wave': return NextResponse.json(await observeProductionBatchWave({ teamId: workspace.team.id, userId: workspace.user.id, batchId, data: body }));
      case 'progress': return NextResponse.json(await getProductionBatchProgress(workspace.team.id, batchId));
      case 'pause':
      case 'resume':
      case 'cancel': return NextResponse.json({ batch: await changeProductionBatchStatus({ teamId: workspace.team.id, userId: workspace.user.id, batchId, status: params.action }) });
      default: return NextResponse.json({ error: 'Unknown Production Batch action.' }, { status: 404 });
    }
  } catch (error) {
    return domainErrorResponse(error, 'invalid_transition', {
      teamId: workspace.team.id,
      workspaceName: workspace.team.name,
      userId: workspace.user.id,
      batchId,
      action: params.action,
    });
  }
}
