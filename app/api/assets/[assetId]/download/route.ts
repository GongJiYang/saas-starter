import { NextRequest, NextResponse } from 'next/server';
import { getAssetForTeam } from '@/lib/db/video-queries';
import { createPresignedDownload } from '@/lib/storage/cos';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  const { assetId: assetIdParam } = await params;
  const assetId = Number(assetIdParam);

  if (!workspace) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  if (!Number.isSafeInteger(assetId) || assetId <= 0) {
    return NextResponse.json({ error: 'Invalid asset.' }, { status: 400 });
  }

  const asset = await getAssetForTeam(workspace.team.id, assetId);

  if (!asset || !['generated_video', 'product_image'].includes(asset.type)) {
    return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  }

  try {
    const download = createPresignedDownload({
      objectKey: asset.objectKey,
      teamId: workspace.team.id,
    });
    return NextResponse.redirect(download.url);
  } catch (error) {
    console.error('Could not sign Asset download:', error);
    return NextResponse.json(
      { error: 'Object storage is not configured.' },
      { status: 503 },
    );
  }
}
