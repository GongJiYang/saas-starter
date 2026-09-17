import { and, asc, count, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from './drizzle';
import { assetUploads, assets, brandKits, catalogItemAssets, catalogItems, productionBatchItems, users } from './schema';

export async function listCatalogTableForTeam(input: {
  teamId: number;
  page: number;
  pageSize: number;
  status?: 'needs_input' | 'ready' | 'archived';
  brandKitId?: number;
  category?: string;
  query?: string;
  batchId?: number;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(50, Math.max(1, input.pageSize));
  const filters = [eq(catalogItems.teamId, input.teamId)];
  if (input.status) filters.push(eq(catalogItems.readinessStatus, input.status));
  if (input.brandKitId) filters.push(eq(catalogItems.brandKitId, input.brandKitId));
  if (input.category) filters.push(eq(catalogItems.category, input.category));
  if (input.query) filters.push(or(ilike(catalogItems.externalSku, `%${input.query}%`), ilike(catalogItems.productName, `%${input.query}%`))!);
  if (input.batchId) {
    const batchItemIds = db.select({ catalogItemId: productionBatchItems.catalogItemId }).from(productionBatchItems).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId)));
    filters.push(inArray(catalogItems.id, batchItemIds));
  }
  const where = and(...filters);
  const rows = await db.select({ catalogItem: catalogItems, brandKitName: brandKits.name })
    .from(catalogItems)
    .innerJoin(brandKits, eq(catalogItems.brandKitId, brandKits.id))
    .where(where)
    .orderBy(desc(catalogItems.updatedAt), asc(catalogItems.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const total = await db.select({ value: count() }).from(catalogItems).where(where);
  return { rows: rows.map((row) => ({ ...row.catalogItem, brandKitName: row.brandKitName })), page, pageSize, total: Number(total[0]?.value ?? 0), pageCount: Math.max(1, Math.ceil(Number(total[0]?.value ?? 0) / pageSize)) };
}

export async function listCatalogCategoriesForTeam(teamId: number) {
  const rows = await db.selectDistinct({ category: catalogItems.category }).from(catalogItems).where(eq(catalogItems.teamId, teamId)).orderBy(asc(catalogItems.category));
  return rows.map((row) => row.category);
}

export async function getCatalogItemDetailForTeam(teamId: number, catalogItemId: number) {
  const rows = await db
    .select({
      item: catalogItems,
      brandKitName: brandKits.name,
      createdByName: users.name,
      createdByEmail: users.email,
    })
    .from(catalogItems)
    .innerJoin(brandKits, eq(catalogItems.brandKitId, brandKits.id))
    .innerJoin(users, eq(catalogItems.createdBy, users.id))
    .where(and(eq(catalogItems.teamId, teamId), eq(catalogItems.id, catalogItemId)))
    .limit(1);
  if (!rows[0]) return null;
  const assetBindings = await db
    .select({
      purpose: catalogItemAssets.purpose,
      position: catalogItemAssets.position,
      assetId: assets.id,
      uploadId: assetUploads.id,
      fileName: assets.fileName,
      contentType: assets.contentType,
      byteSize: assets.byteSize,
      uploadSource: assets.uploadSource,
      createdAt: assets.createdAt,
    })
    .from(catalogItemAssets)
    .innerJoin(assets, eq(catalogItemAssets.assetId, assets.id))
    .leftJoin(assetUploads, and(eq(assetUploads.assetId, assets.id), eq(assetUploads.teamId, teamId)))
    .where(and(
      eq(catalogItemAssets.teamId, teamId),
      eq(catalogItemAssets.catalogItemId, catalogItemId),
      eq(assets.teamId, teamId),
    ))
    .orderBy(asc(catalogItemAssets.position));
  return { ...rows[0].item, brandKitName: rows[0].brandKitName, createdByName: rows[0].createdByName, createdByEmail: rows[0].createdByEmail, assetBindings };
}
