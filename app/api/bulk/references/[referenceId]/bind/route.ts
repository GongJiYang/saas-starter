import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { bindReferenceToCatalogItem } from '@/lib/references/actions';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({ catalogItemId: z.number().int().positive().nullable() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ referenceId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { referenceId: referenceIdParam } = await params;
  const referenceId = Number(referenceIdParam);
  if (!Number.isSafeInteger(referenceId) || referenceId <= 0) return NextResponse.json({ error: 'Invalid reference.' }, { status: 400 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid CatalogItem binding.' }, { status: 400 });
  try {
    const reference = await bindReferenceToCatalogItem({
      teamId: workspace.team.id,
      creativeReferenceId: referenceId,
      catalogItemId: parsed.data.catalogItemId,
    });
    return NextResponse.json({ reference });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not bind reference.' }, { status: 400 });
  }
}
