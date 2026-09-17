import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { getQualitySubmissionIssue, recordVideoQualityReport, retryTechnicalQualityFailure } from '@/lib/quality/actions';
import { DomainError } from '@/lib/errors/domain';
import { domainErrorResponse } from '@/lib/errors/http';

function qualityApiError(code: string, path: string, message: string) {
  return { error: { code, path, message } };
}

export async function POST(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const jobId = Number((await context.params).jobId);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) return NextResponse.json(qualityApiError('VIDEO_JOB_ID_INVALID', 'jobId', 'Invalid VideoJob.'), { status: 400 });
  try {
    const result = await recordVideoQualityReport({ teamId: workspace.team.id, userId: workspace.user.id, videoJobId: jobId, observation: await request.json().catch(() => null) });
    return NextResponse.json(result);
  } catch (error) {
    const issue = getQualitySubmissionIssue(error);
    return domainErrorResponse(new DomainError('quality_gate_failed', {
      message: issue?.message,
      field: issue?.path ?? 'observation',
      cause: error,
    }), 'quality_gate_failed', {
      teamId: workspace.team.id,
      workspaceName: workspace.team.name,
      userId: workspace.user.id,
      videoJobId: jobId,
      operation: 'quality.record',
    }, issue ? { issue } : {});
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const jobId = Number((await context.params).jobId);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) return NextResponse.json(qualityApiError('VIDEO_JOB_ID_INVALID', 'jobId', 'Invalid VideoJob.'), { status: 400 });
  try {
    return NextResponse.json(await retryTechnicalQualityFailure({ teamId: workspace.team.id, userId: workspace.user.id, videoJobId: jobId }), { status: 202 });
  } catch (error) {
    return domainErrorResponse(error, 'quality_gate_failed', {
      teamId: workspace.team.id,
      workspaceName: workspace.team.name,
      userId: workspace.user.id,
      videoJobId: jobId,
      operation: 'quality.retry',
    });
  }
}
