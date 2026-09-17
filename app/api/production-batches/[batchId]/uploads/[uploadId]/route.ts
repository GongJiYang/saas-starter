import { NextResponse } from 'next/server';
import { deleteUnreferencedProductImageUpload } from '@/lib/assets/service';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function DELETE(_request: Request, context: { params: Promise<{ batchId: string; uploadId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const params = await context.params;
    const batchId = Number(params.batchId);
    const uploadId = Number(params.uploadId);
    if (!Number.isSafeInteger(batchId) || batchId <= 0 || !Number.isSafeInteger(uploadId) || uploadId <= 0) return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
    await deleteUnreferencedProductImageUpload({ teamId: workspace.team.id, uploadId, productionBatchId: batchId });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return domainErrorResponse(error, 'asset_upload_failed', { teamId: workspace.team.id, userId: workspace.user.id, operation: 'production_batch.upload.delete' });
  }
}
