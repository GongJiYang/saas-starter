import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { client, db } from '../lib/db/drizzle';
import {
  assetUploads,
  assets,
  catalogItems,
  productionBatchItems,
  productionBatches,
  type NewAssetUpload,
  type ProductionBatch,
} from '../lib/db/schema';

type CatalogFixture = typeof catalogItems.$inferSelect;

async function expectRejected(operation: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(operation, pattern);
}

async function main() {
  const batches = await client<{
    id: number;
    generation_mode: 'single' | 'bulk';
    sku_count: string;
  }[]>`
    SELECT batch.id, batch.generation_mode, count(item.id)::text AS sku_count
    FROM production_batches AS batch
    LEFT JOIN production_batch_items AS item ON item.production_batch_id = batch.id
    GROUP BY batch.id
    ORDER BY batch.id
  `;
  assert.ok(batches.length > 0, 'Expected at least one historical Production Batch.');
  for (const batch of batches) {
    const skuCount = Number(batch.sku_count);
    assert.equal(batch.generation_mode, skuCount === 1 ? 'single' : 'bulk');
    if (batch.generation_mode === 'bulk') assert.ok(skuCount >= 3);
  }

  const indexes = await client<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE indexname IN (
      'production_batch_items_batch_catalog_unique',
      'assets_id_team_unique',
      'asset_uploads_team_object_key_unique'
    )
  `;
  assert.deepEqual(new Set(indexes.map((row) => row.indexname)), new Set([
    'production_batch_items_batch_catalog_unique',
    'assets_id_team_unique',
    'asset_uploads_team_object_key_unique',
  ]));

  const triggers = await client<{ tgname: string; tgdeferrable: boolean; tginitdeferred: boolean }[]>`
    SELECT tgname, tgdeferrable, tginitdeferred
    FROM pg_trigger
    WHERE tgname IN (
      'production_batches_generation_mode_sku_count',
      'production_batch_items_generation_mode_sku_count'
    )
  `;
  assert.equal(triggers.length, 2);
  assert.equal(triggers.every((row) => row.tgdeferrable && row.tginitdeferred), true);

  const catalog = await db.select().from(catalogItems).orderBy(catalogItems.teamId, catalogItems.id);
  const byTeam = new Map<number, CatalogFixture[]>();
  for (const item of catalog) byTeam.set(item.teamId, [...(byTeam.get(item.teamId) ?? []), item]);
  const fixtures = [...byTeam.values()].find((items) => items.length >= 3);
  assert.ok(fixtures, 'Expected one Workspace with at least three Catalog items.');
  const [first, second] = fixtures;
  assert.ok(first && second);
  const suffix = `${Date.now()}-${process.pid}`;

  await expectRejected(
    () => db.transaction(async (tx) => {
      await tx.insert(productionBatches).values({
        teamId: first.teamId,
        createdBy: first.createdBy,
        name: `CHECK-invalid-single-${suffix}`,
        status: 'draft',
        generationMode: 'single',
        targetPlatform: 'tiktok',
        durationSeconds: 5,
        campaignGoal: 'Constraint check',
        waveSize: 10,
        stopLossConfig: '{}',
      });
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
    }),
    /must contain exactly one SKU/,
  );

  await expectRejected(
    () => db.transaction(async (tx) => {
      const [batch] = await tx.insert(productionBatches).values({
        teamId: first.teamId,
        createdBy: first.createdBy,
        name: `CHECK-invalid-bulk-${suffix}`,
        status: 'draft',
        generationMode: 'bulk',
        targetPlatform: 'tiktok',
        durationSeconds: 5,
        campaignGoal: 'Constraint check',
        waveSize: 10,
        stopLossConfig: '{}',
      }).returning({ id: productionBatches.id });
      assert.ok(batch);
      await tx.insert(productionBatchItems).values([
        { teamId: first.teamId, productionBatchId: batch.id, catalogItemId: first.id },
        { teamId: first.teamId, productionBatchId: batch.id, catalogItemId: second.id },
      ]);
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
    }),
    /must contain at least three SKU/,
  );

  await expectRejected(
    () => db.transaction(async (tx) => {
      const [batch] = await tx.insert(productionBatches).values({
        teamId: first.teamId,
        createdBy: first.createdBy,
        name: `CHECK-valid-single-${suffix}`,
        status: 'draft',
        generationMode: 'single',
        targetPlatform: 'tiktok',
        durationSeconds: 5,
        campaignGoal: 'Constraint check',
        waveSize: 10,
        stopLossConfig: '{}',
      }).returning({ id: productionBatches.id });
      assert.ok(batch);
      await tx.insert(productionBatchItems).values({
        teamId: first.teamId,
        productionBatchId: batch.id,
        catalogItemId: first.id,
      });
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      throw new Error('ROLLBACK_VALID_SINGLE_CHECK');
    }),
    /ROLLBACK_VALID_SINGLE_CHECK/,
  );

  await expectRejected(
    () => db.insert(catalogItems).values({
      teamId: first.teamId,
      createdBy: first.createdBy,
      externalSku: `CHECK-ready-no-asset-${suffix}`,
      productName: 'Constraint check',
      category: first.category,
      primaryImageUrl: first.primaryImageUrl,
      primaryAssetId: null,
      readinessStatus: 'ready',
      readinessErrors: '[]',
      approvedClaims: first.approvedClaims,
      prohibitedClaims: first.prohibitedClaims,
      mustShowElements: first.mustShowElements,
      immutableElements: first.immutableElements,
      targetAudience: first.targetAudience,
      campaignGoal: first.campaignGoal,
      platform: first.platform,
      durationSeconds: first.durationSeconds,
      brandKitId: first.brandKitId,
      cta: first.cta,
    }),
    /catalog_items_ready_requires_primary_asset/,
  );

  const foreignAsset = (await db.select().from(assets).where(sql`${assets.teamId} <> ${first.teamId}`).limit(1))[0];
  assert.ok(foreignAsset, 'Expected an Asset owned by a different Workspace.');
  await expectRejected(
    () => db.insert(catalogItems).values({
      teamId: first.teamId,
      createdBy: first.createdBy,
      externalSku: `CHECK-cross-team-asset-${suffix}`,
      productName: 'Constraint check',
      category: first.category,
      primaryImageUrl: first.primaryImageUrl,
      primaryAssetId: foreignAsset.id,
      readinessStatus: 'needs_input',
      readinessErrors: '[]',
      approvedClaims: first.approvedClaims,
      prohibitedClaims: first.prohibitedClaims,
      mustShowElements: first.mustShowElements,
      immutableElements: first.immutableElements,
      targetAudience: first.targetAudience,
      campaignGoal: first.campaignGoal,
      platform: first.platform,
      durationSeconds: first.durationSeconds,
      brandKitId: first.brandKitId,
      cta: first.cta,
    }),
    /catalog_items_primary_asset_team_fk/,
  );

  const uploadBase = {
    teamId: first.teamId,
    createdBy: first.createdBy,
    source: 'local_upload' as const,
    objectKey: `teams/${first.teamId}/checks/${suffix}.jpg`,
    fileName: 'check.jpg',
    contentType: 'image/jpeg',
    byteSize: 1,
  };
  await expectRejected(
    () => db.insert(assetUploads).values({ ...uploadBase, status: 'failed', stage: 'transfer' }),
    /asset_uploads_failed_valid/,
  );
  await expectRejected(
    () => db.insert(assetUploads).values({ ...uploadBase, status: 'completed', stage: 'complete' }),
    /asset_uploads_completed_valid/,
  );

  const brokenRelations = await client<{
    campaign_orphans: string;
    spec_orphans: string;
    job_orphans: string;
    incomplete_frozen_jobs: string;
  }[]>`
    SELECT
      (SELECT count(*)::text FROM production_batch_items item LEFT JOIN campaigns campaign ON campaign.id = item.campaign_id WHERE item.campaign_id IS NOT NULL AND campaign.id IS NULL) AS campaign_orphans,
      (SELECT count(*)::text FROM production_batch_items item LEFT JOIN creative_spec_versions spec ON spec.id = item.creative_spec_version_id WHERE item.creative_spec_version_id IS NOT NULL AND spec.id IS NULL) AS spec_orphans,
      (SELECT count(*)::text FROM video_jobs job LEFT JOIN campaigns campaign ON campaign.id = job.campaign_id WHERE campaign.id IS NULL) AS job_orphans,
      (SELECT count(*)::text FROM video_jobs WHERE shot_skill_version_id IS NOT NULL AND (recipe_snapshot IS NULL OR shot_skill_hash IS NULL OR shot_skill_id IS NULL)) AS incomplete_frozen_jobs
  `;
  assert.deepEqual(brokenRelations[0], {
    campaign_orphans: '0',
    spec_orphans: '0',
    job_orphans: '0',
    incomplete_frozen_jobs: '0',
  });

  const generatedSourceMismatch = await db.select({ id: assets.id }).from(assets)
    .where(sql`${assets.type} = 'generated_video' AND ${assets.uploadSource} <> 'generated'`);
  assert.equal(generatedSourceMismatch.length, 0);

  const inferredMode: ProductionBatch['generationMode'] = 'single';
  const inferredUpload: Pick<NewAssetUpload, 'source' | 'status' | 'stage'> = {
    source: 'local_upload',
    status: 'signed',
    stage: 'signing',
  };
  assert.equal(inferredMode, 'single');
  assert.equal(inferredUpload.status, 'signed');

  const leakedChecks = await db.select({ id: productionBatches.id }).from(productionBatches)
    .where(eq(productionBatches.name, `CHECK-valid-single-${suffix}`));
  assert.equal(leakedChecks.length, 0);

  console.info('Customer workflow data model checks passed.');
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
