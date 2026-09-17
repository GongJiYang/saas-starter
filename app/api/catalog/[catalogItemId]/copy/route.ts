import { NextRequest, NextResponse } from 'next/server';
import { catalogConflictSchema, catalogCopyInputSchema } from '@/lib/catalog/contracts';
import { CatalogSkuConflictError, copyCatalogItemForTeam } from '@/lib/catalog/service';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ catalogItemId: string }> },
) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const catalogItemId = Number((await params).catalogItemId);
  if (!Number.isSafeInteger(catalogItemId) || catalogItemId <= 0) {
    return NextResponse.json({ error: 'Invalid CatalogItem.' }, { status: 400 });
  }
  const parsed = catalogCopyInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid copied SKU.' }, { status: 400 });
  try {
    const item = await copyCatalogItemForTeam({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      catalogItemId,
      externalSku: parsed.data.externalSku,
    });
    if (!item) return NextResponse.json({ error: 'CatalogItem not found.' }, { status: 404 });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof CatalogSkuConflictError) {
      return NextResponse.json({
        error: error.message,
        conflict: catalogConflictSchema.parse({
          code: error.code,
          externalSku: error.existing.externalSku,
          existingProductName: error.existing.productName,
          existingItemHref: `/dashboard/catalog/${error.existing.id}`,
          options: ['update', 'cancel'],
        }),
      }, { status: 409 });
    }
    console.error('Could not copy Catalog SKU:', error);
    return NextResponse.json({ error: 'Could not copy Catalog SKU.' }, { status: 422 });
  }
}
