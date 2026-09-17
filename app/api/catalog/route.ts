import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listCatalogCategoriesForTeam, listCatalogTableForTeam } from '@/lib/db/catalog-queries';
import { db } from '@/lib/db/drizzle';
import { brandKits } from '@/lib/db/schema';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { eq } from 'drizzle-orm';
import {
  catalogConflictSchema,
  catalogProductInputSchema,
} from '@/lib/catalog/contracts';
import {
  CatalogSkuConflictError,
  CatalogWorkspaceReferenceError,
  createCatalogItemForTeam,
} from '@/lib/catalog/service';

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(50),
  status: z.enum(['needs_input', 'ready', 'archived']).optional(),
  brandKitId: z.coerce.number().int().positive().optional(),
  category: z.string().trim().min(1).optional(),
  query: z.string().trim().max(160).optional(),
  batchId: z.coerce.number().int().positive().optional(),
});

export async function GET(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid Catalog filters.' }, { status: 400 });
  const [catalog, brands, categories] = await Promise.all([
    listCatalogTableForTeam({ teamId: workspace.team.id, ...parsed.data }),
    db.select({ id: brandKits.id, name: brandKits.name }).from(brandKits).where(eq(brandKits.teamId, workspace.team.id)),
    listCatalogCategoriesForTeam(workspace.team.id),
  ]);
  return NextResponse.json({ ...catalog, brandKits: brands, categories });
}

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = catalogProductInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? 'Invalid Catalog SKU.',
      issues: parsed.error.issues,
    }, { status: 400 });
  }
  try {
    const item = await createCatalogItemForTeam({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      data: parsed.data,
    });
    return NextResponse.json({
      item,
      nextAction: {
        label: item.readinessStatus === 'ready' ? 'Create video task' : 'Complete product information',
        href: item.readinessStatus === 'ready' ? `/dashboard/batches?sku=${encodeURIComponent(item.externalSku)}` : `/dashboard/catalog/${item.id}`,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof CatalogSkuConflictError) {
      return domainErrorResponse(error, 'catalog_conflict', {
        teamId: workspace.team.id,
        workspaceName: workspace.team.name,
        userId: workspace.user.id,
        operation: 'catalog.create',
      }, {
        conflict: catalogConflictSchema.parse({
          code: 'external_sku_conflict',
          externalSku: error.existing.externalSku,
          existingProductName: error.existing.productName,
          existingItemHref: `/dashboard/catalog/${error.existing.id}`,
          options: ['update', 'cancel'],
        }),
      });
    }
    return domainErrorResponse(error, error instanceof CatalogWorkspaceReferenceError
      ? 'workspace_entity_forbidden'
      : 'internal_error', {
      teamId: workspace.team.id,
      workspaceName: workspace.team.name,
      userId: workspace.user.id,
      operation: 'catalog.create',
    });
  }
}
