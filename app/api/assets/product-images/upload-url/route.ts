import { NextRequest, NextResponse } from 'next/server';
import { classifyUploadError, productImageUploadRequestSchema } from '@/lib/assets/contracts';
import { signProductImageUploadForTeam } from '@/lib/assets/service';
import { DomainError } from '@/lib/errors/domain';
import { domainErrorResponse } from '@/lib/errors/http';
import { consumeRateLimit } from '@/lib/ops/rate-limit';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!consumeRateLimit(`product-image-sign:${workspace.team.id}:${workspace.user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Product image upload rate limit exceeded.' }, { status: 429 });
  }
  const parsed = productImageUploadRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose a JPEG, PNG, or WebP image no larger than 20 MB.', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    return NextResponse.json(await signProductImageUploadForTeam({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      data: parsed.data,
    }));
  } catch (error) {
    const diagnostic = classifyUploadError(error, 'signing');
    return domainErrorResponse(new DomainError('asset_upload_failed', {
      message: `${diagnostic.message} ${diagnostic.recommendation}`,
      details: { stage: diagnostic.stage, diagnosticCode: diagnostic.code, retryable: diagnostic.retryable },
      cause: error,
    }), 'asset_upload_failed', {
      teamId: workspace.team.id,
      userId: workspace.user.id,
      operation: 'asset.sign_product_image',
    }, { diagnostic });
  }
}
