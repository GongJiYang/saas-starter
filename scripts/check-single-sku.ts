import assert from 'node:assert/strict';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import {
  ActivityType,
  activityLogs,
  assets,
  brandKits,
  catalogItemAssets,
  catalogItems,
} from '../lib/db/schema';
import {
  catalogProductInputSchema,
  compactCatalogProductInput,
  previewCatalogReadiness,
} from '../lib/catalog/contracts';
import {
  CatalogSkuConflictError,
  CatalogWorkspaceReferenceError,
  copyCatalogItemForTeam,
  createCatalogItemForTeam,
  updateCatalogItemForTeam,
} from '../lib/catalog/service';

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const fixture = (await db.select().from(catalogItems).where(and(
    eq(catalogItems.readinessStatus, 'ready'),
    sql`${catalogItems.primaryAssetId} IS NOT NULL`,
  )).limit(1))[0];
  assert.ok(fixture?.primaryAssetId, 'Expected a ready Catalog fixture with a primary Asset.');
  const suffix = `${Date.now()}-${process.pid}`;
  const validData = catalogProductInputSchema.parse({
    externalSku: `CHECK-SINGLE-${suffix}`,
    productName: fixture.productName,
    category: fixture.category,
    primaryImageUrl: fixture.primaryImageUrl,
    productPageUrl: fixture.productPageUrl ?? undefined,
    primaryImageAuthorized: true,
    primaryAssetId: fixture.primaryAssetId,
    detailImageUrls: [],
    detailAssetIds: [],
    approvedClaims: parseJson(fixture.approvedClaims, []),
    prohibitedClaims: parseJson(fixture.prohibitedClaims, []),
    mustShowElements: parseJson(fixture.mustShowElements, []),
    immutableElements: parseJson(fixture.immutableElements, []),
    targetAudience: fixture.targetAudience,
    campaignGoal: fixture.campaignGoal,
    platform: fixture.platform,
    durationSeconds: fixture.durationSeconds,
    brandKitId: fixture.brandKitId,
    cta: fixture.cta,
  });

  assert.equal(previewCatalogReadiness(validData).status, 'ready');
  const missingImage = previewCatalogReadiness({
    ...validData,
    primaryImageUrl: '',
    primaryImageAuthorized: false,
    primaryAssetId: null,
  });
  assert.equal(missingImage.status, 'needs_input');
  assert.equal(missingImage.issues.some((issue) => issue.code === 'invalid_primary_image_url'), true);
  const missingClaims = previewCatalogReadiness({ ...validData, approvedClaims: [] });
  assert.equal(missingClaims.status, 'needs_input');
  assert.equal(missingClaims.issues.some((issue) => issue.code === 'missing_approved_claim'), true);
  const missingClaimSource = previewCatalogReadiness({ ...validData, approvedClaims: [{ text: 'Approved', source: '' }] });
  assert.equal(missingClaimSource.issues.some((issue) => issue.code === 'missing_claim_source'), true);
  const compacted = compactCatalogProductInput({
    ...validData,
    approvedClaims: [{ text: '', source: '' }, ...validData.approvedClaims],
    prohibitedClaims: ['', ...validData.prohibitedClaims],
  });
  assert.equal(compacted.approvedClaims.some((claim) => !claim.text && !claim.source), false);
  assert.equal(compacted.prohibitedClaims.includes(''), false);

  const createdIds: number[] = [];
  let activityLogId: number | undefined;
  try {
    const created = await createCatalogItemForTeam({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      data: validData,
    });
    createdIds.push(created.id);
    assert.equal(created.readinessStatus, 'ready');
    assert.equal(created.primaryAssetId, fixture.primaryAssetId);

    const activity = (await db.select({ id: activityLogs.id, action: activityLogs.action })
      .from(activityLogs)
      .where(and(
        eq(activityLogs.teamId, fixture.teamId),
        eq(activityLogs.userId, fixture.createdBy),
        eq(activityLogs.action, ActivityType.CREATE_CATALOG_ITEM),
      ))
      .orderBy(desc(activityLogs.id))
      .limit(1))[0];
    assert.equal(activity?.action, ActivityType.CREATE_CATALOG_ITEM);
    activityLogId = activity?.id;

    await assert.rejects(
      () => createCatalogItemForTeam({ teamId: fixture.teamId, userId: fixture.createdBy, data: validData, logActivity: false }),
      (error: unknown) => error instanceof CatalogSkuConflictError && error.code === 'catalog_conflict',
    );

    const incomplete = await createCatalogItemForTeam({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      data: {
        ...validData,
        externalSku: `CHECK-INCOMPLETE-${suffix}`,
        primaryImageUrl: '',
        primaryImageAuthorized: false,
        primaryAssetId: null,
        approvedClaims: [],
      },
      logActivity: false,
    });
    createdIds.push(incomplete.id);
    assert.equal(incomplete.readinessStatus, 'needs_input');
    const incompleteIssues = parseJson<Array<{ code: string }>>(incomplete.readinessErrors, []);
    assert.equal(incompleteIssues.some((issue) => issue.code === 'invalid_primary_image_url'), true);
    assert.equal(incompleteIssues.some((issue) => issue.code === 'missing_approved_claim'), true);

    const copied = await copyCatalogItemForTeam({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      catalogItemId: created.id,
      externalSku: `CHECK-COPY-${suffix}`,
      logActivity: false,
    });
    assert.ok(copied);
    createdIds.push(copied.id);
    assert.equal(copied.externalSku, `CHECK-COPY-${suffix}`);
    assert.equal(copied.readinessStatus, 'needs_input');
    assert.equal(copied.productPageUrl, null);

    const updated = await updateCatalogItemForTeam({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      catalogItemId: created.id,
      data: { approvedClaims: [] },
      logActivity: false,
    });
    assert.equal(updated?.readinessStatus, 'needs_input');
    assert.equal(parseJson<Array<{ code: string }>>(updated?.readinessErrors ?? '[]', []).some((issue) => issue.code === 'missing_approved_claim'), true);

    const foreignBrand = (await db.select({ id: brandKits.id }).from(brandKits)
      .where(ne(brandKits.teamId, fixture.teamId)).limit(1))[0];
    assert.ok(foreignBrand, 'Expected a Brand Kit in another Workspace.');
    await assert.rejects(
      () => createCatalogItemForTeam({
        teamId: fixture.teamId,
        userId: fixture.createdBy,
        data: { ...validData, externalSku: `CHECK-CROSS-BRAND-${suffix}`, brandKitId: foreignBrand.id },
        logActivity: false,
      }),
      (error: unknown) => error instanceof CatalogWorkspaceReferenceError,
    );

    const foreignAsset = (await db.select({ id: assets.id }).from(assets)
      .where(and(ne(assets.teamId, fixture.teamId), eq(assets.type, 'product_image'))).limit(1))[0];
    assert.ok(foreignAsset, 'Expected a product Asset in another Workspace.');
    await assert.rejects(
      () => createCatalogItemForTeam({
        teamId: fixture.teamId,
        userId: fixture.createdBy,
        data: { ...validData, externalSku: `CHECK-CROSS-ASSET-${suffix}`, primaryAssetId: foreignAsset.id },
        logActivity: false,
      }),
      (error: unknown) => error instanceof CatalogWorkspaceReferenceError,
    );
  } finally {
    if (createdIds.length > 0) {
      await db.transaction(async (transaction) => {
        await transaction.delete(catalogItemAssets).where(inArray(catalogItemAssets.catalogItemId, createdIds));
        await transaction.delete(catalogItems).where(inArray(catalogItems.id, createdIds));
        if (activityLogId) await transaction.delete(activityLogs).where(eq(activityLogs.id, activityLogId));
      });
    }
  }

  const leaked = await db.select({ id: catalogItems.id }).from(catalogItems)
    .where(sql`${catalogItems.externalSku} LIKE ${`CHECK-%-${process.pid}`}`);
  assert.equal(leaked.length, 0);
  console.info('Single SKU workflow checks passed.');
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
