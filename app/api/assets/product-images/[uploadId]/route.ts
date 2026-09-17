import { NextResponse } from 'next/server';
import { ProductImageUploadError, deleteUnreferencedProductImageUpload } from '@/lib/assets/service';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const uploadId = Number((await params).uploadId);
  if (!Number.isSafeInteger(uploadId) || uploadId <= 0) return NextResponse.json({ error: 'Invalid product image upload.' }, { status: 400 });
  try {
    await deleteUnreferencedProductImageUpload({ teamId: workspace.team.id, uploadId });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof ProductImageUploadError) {
      return NextResponse.json({ error: error.message, diagnostic: error.diagnostic }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not delete product image.' }, { status: 409 });
  }
}
