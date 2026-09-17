import { NextResponse } from 'next/server';
import { listBrandKitsForTeam } from '@/lib/db/video-queries';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { createCsvTemplate } from '@/lib/bulk/template';

export async function GET() {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const brandKits = await listBrandKitsForTeam(workspace.team.id);
  const body = createCsvTemplate(brandKits);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sku-import-v2.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
