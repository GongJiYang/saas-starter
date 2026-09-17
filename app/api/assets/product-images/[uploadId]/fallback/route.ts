import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { NextRequest, NextResponse } from 'next/server';
import { ProductImageUploadError, fallbackProductImageUpload } from '@/lib/assets/service';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const uploadId = Number((await params).uploadId);
  const byteSize = Number(request.headers.get('content-length'));
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? '';
  if (!Number.isSafeInteger(uploadId) || uploadId <= 0 || !Number.isSafeInteger(byteSize) || byteSize <= 0 || !request.body) {
    return NextResponse.json({ error: 'Invalid product image fallback request.' }, { status: 400 });
  }
  try {
    const body = Readable.fromWeb(request.body as unknown as NodeReadableStream);
    return NextResponse.json(await fallbackProductImageUpload({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      uploadId,
      contentType,
      byteSize,
      body,
    }));
  } catch (error) {
    if (error instanceof ProductImageUploadError) {
      return NextResponse.json({ error: error.message, diagnostic: error.diagnostic }, { status: 422 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server upload fallback failed.' }, { status: 400 });
  }
}
