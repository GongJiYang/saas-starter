import { NextResponse } from 'next/server';
import { ProductImageUploadError, completeProductImageUpload } from '@/lib/assets/service';
import { DomainError } from '@/lib/errors/domain';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const uploadId = Number((await params).uploadId);
  if (!Number.isSafeInteger(uploadId) || uploadId <= 0) return NextResponse.json({ error: 'Invalid product image upload.' }, { status: 400 });
  try {
    return NextResponse.json(await completeProductImageUpload({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      uploadId,
    }));
  } catch (error) {
    if (error instanceof ProductImageUploadError) {
      return domainErrorResponse(new DomainError('asset_upload_failed', {
        message: `${error.diagnostic.message} ${error.diagnostic.recommendation}`,
        details: { stage: error.diagnostic.stage, diagnosticCode: error.diagnostic.code, retryable: error.diagnostic.retryable },
        cause: error,
      }), 'asset_upload_failed', {
        teamId: workspace.team.id,
        userId: workspace.user.id,
        uploadId,
        operation: 'asset.complete_product_image',
      }, { diagnostic: error.diagnostic });
    }
    return domainErrorResponse(error, 'asset_upload_failed', {
      teamId: workspace.team.id,
      userId: workspace.user.id,
      uploadId,
      operation: 'asset.complete_product_image',
    });
  }
}
