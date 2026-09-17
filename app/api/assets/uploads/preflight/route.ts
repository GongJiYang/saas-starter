import { NextRequest, NextResponse } from 'next/server';
import { uploadPreflightRequestSchema } from '@/lib/assets/contracts';
import { inspectUploadPreflight } from '@/lib/assets/service';
import { domainErrorResponse } from '@/lib/errors/http';
import { consumeRateLimit } from '@/lib/ops/rate-limit';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!consumeRateLimit(`upload-preflight:${workspace.team.id}:${workspace.user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Upload preflight rate limit exceeded.' }, { status: 429 });
  }
  const parsed = uploadPreflightRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid upload preflight request.' }, { status: 400 });
  try {
    return NextResponse.json(await inspectUploadPreflight({ teamId: workspace.team.id, ...parsed.data }));
  } catch (error) {
    return domainErrorResponse(error, 'asset_upload_failed', {
      teamId: workspace.team.id,
      userId: workspace.user.id,
      operation: 'asset.upload_preflight',
    });
  }
}
