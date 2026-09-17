import { NextRequest, NextResponse } from 'next/server';
import { catalogProductUpdateSchema } from '@/lib/catalog/contracts';
import {
  CatalogWorkspaceReferenceError,
  updateCatalogItemForTeam,
} from '@/lib/catalog/service';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';


export async function PATCH(request: NextRequest, context: { params: Promise<{ catalogItemId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const catalogItemId = Number((await context.params).catalogItemId);
  if (!Number.isSafeInteger(catalogItemId) || catalogItemId <= 0) return NextResponse.json({ error: 'Invalid CatalogItem.' }, { status: 400 });
  const parsed = catalogProductUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? 'Invalid CatalogItem update.',
      issues: parsed.error.issues,
    }, { status: 400 });
  }
  try {
    const item = await updateCatalogItemForTeam({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      catalogItemId,
      data: parsed.data,
    });
    if (!item) return NextResponse.json({ error: 'CatalogItem not found.' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    return domainErrorResponse(error, error instanceof CatalogWorkspaceReferenceError
      ? 'workspace_entity_forbidden'
      : 'internal_error', {
      teamId: workspace.team.id,
      workspaceName: workspace.team.name,
      userId: workspace.user.id,
      catalogItemId,
      operation: 'catalog.update',
    });
  }
}
