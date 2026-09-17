import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { activityLogs, assetUploads, assets, catalogItems } from '../lib/db/schema';
import {
  PRODUCT_IMAGE_MAX_BYTES,
  assertProductImageObjectKey,
  classifyUploadError,
  matchesProductImageMagicBytes,
  productImageUploadRequestSchema,
} from '../lib/assets/contracts';
import {
  ProductImageUploadError,
  cleanupExpiredProductImageUploads,
  completeProductImageUpload,
  deleteUnreferencedProductImageUpload,
  fallbackProductImageUpload,
  signProductImageUploadForTeam,
} from '../lib/assets/service';
import { previewCatalogReadiness } from '../lib/catalog/contracts';
import { createProductImageValidationStream } from '../lib/storage/cos';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

async function consumeValidationStream(body: Buffer, expectedSize = body.length): Promise<Buffer> {
  const output: Buffer[] = [];
  const stream = Readable.from([body.subarray(0, 5), body.subarray(5)])
    .pipe(createProductImageValidationStream({ contentType: 'image/png', byteSize: expectedSize }));
  for await (const chunk of stream) output.push(Buffer.from(chunk));
  return Buffer.concat(output);
}

async function main() {
  assert.equal(productImageUploadRequestSchema.safeParse({ fileName: 'product.png', contentType: 'image/png', byteSize: png.length }).success, true);
  assert.equal(productImageUploadRequestSchema.safeParse({ fileName: 'product.gif', contentType: 'image/gif', byteSize: png.length }).success, false);
  assert.equal(productImageUploadRequestSchema.safeParse({ fileName: 'large.png', contentType: 'image/png', byteSize: PRODUCT_IMAGE_MAX_BYTES + 1 }).success, false);
  assert.equal(matchesProductImageMagicBytes('image/png', png), true);
  assert.equal(matchesProductImageMagicBytes('image/jpeg', png), false);
  assert.equal(matchesProductImageMagicBytes('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])), true);
  assert.equal(matchesProductImageMagicBytes('image/webp', Buffer.from('RIFF0000WEBP')), true);
  assert.deepEqual(await consumeValidationStream(png), png);
  await assert.rejects(() => consumeValidationStream(Buffer.from('not-an-image-123'), 16), /magic bytes/);
  await assert.rejects(() => consumeValidationStream(png, png.length + 1), /length/);

  assert.doesNotThrow(() => assertProductImageObjectKey(7, 'teams/7/product-images/image.png'));
  assert.throws(() => assertProductImageObjectKey(7, 'teams/8/product-images/image.png'), /does not belong/);
  assert.equal(classifyUploadError(Object.assign(new Error('denied'), { statusCode: 403 }), 'preflight').code, 'cors_preflight_denied');
  assert.equal(classifyUploadError(Object.assign(new Error('signature'), { code: 'SignatureDoesNotMatch', statusCode: 403 }), 'transfer').code, 'signature_expired');
  assert.equal(classifyUploadError(Object.assign(new Error('denied'), { code: 'AccessDenied', statusCode: 403 }), 'verification').code, 'credential_permission_denied');
  assert.equal(classifyUploadError(Object.assign(new Error('wrong object key'), { code: 'object_key_mismatch' }), 'transfer').code, 'object_key_mismatch');
  assert.equal(classifyUploadError(new Error('Due to your account is arrears, recharge required.'), 'archive').code, 'storage_account_arrears');
  assert.equal(classifyUploadError(new TypeError('Failed to fetch'), 'transfer').code, 'network_failure');

  const fixture = (await db.select().from(catalogItems).limit(1))[0];
  assert.ok(fixture, 'Expected a Catalog fixture.');
  const otherTeam = (await db.select({ teamId: catalogItems.teamId }).from(catalogItems).where(ne(catalogItems.teamId, fixture.teamId)).limit(1))[0];
  assert.ok(otherTeam, 'Expected another Workspace fixture.');
  assert.equal(previewCatalogReadiness({
    externalSku: 'LOCAL-ASSET-CHECK',
    productName: 'Local image product',
    category: 'test',
    primaryImageUrl: '',
    primaryImageAuthorized: true,
    primaryAssetId: 123,
    detailImageUrls: [],
    detailAssetIds: [],
    approvedClaims: [{ text: 'Claim', source: 'Approved source' }],
    prohibitedClaims: ['Medical guarantee'],
    mustShowElements: ['Product'],
    immutableElements: ['Shape'],
    targetAudience: 'Customers',
    campaignGoal: 'Awareness',
    platform: 'tiktok',
    durationSeconds: 5,
    brandKitId: fixture.brandKitId,
    cta: 'Learn more',
  }).status, 'ready');

  const uploadIds: number[] = [];
  const assetIds: number[] = [];
  const activityIds: number[] = [];
  const baselineActivity = (await db.select({ id: activityLogs.id }).from(activityLogs).orderBy(desc(activityLogs.id)).limit(1))[0]?.id ?? 0;
  const inspectObject = async () => undefined;
  const deleteObject = async () => undefined;

  try {
    const directSigned = await signProductImageUploadForTeam({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      data: { fileName: 'direct.png', contentType: 'image/png', byteSize: png.length },
    });
    uploadIds.push(directSigned.uploadId);
    assert.match(directSigned.objectKey, new RegExp(`^teams/${fixture.teamId}/product-images/`));
    assert.equal(directSigned.headers['Content-Type'], 'image/png');
    const signedRow = (await db.select().from(assetUploads).where(eq(assetUploads.id, directSigned.uploadId)).limit(1))[0];
    assert.equal(signedRow?.status, 'signed');
    assert.equal(signedRow?.stage, 'signing');
    assert.equal(signedRow?.source, 'local_upload');
    await assert.rejects(
      () => completeProductImageUpload({ teamId: otherTeam.teamId, userId: fixture.createdBy, uploadId: directSigned.uploadId, inspectObject }),
      /not found/,
    );

    const completed = await completeProductImageUpload({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      uploadId: directSigned.uploadId,
      inspectObject,
    });
    assetIds.push(completed.asset.id);
    assert.equal(completed.upload.status, 'completed');
    assert.equal(completed.upload.stage, 'complete');
    assert.equal(completed.asset.uploadSource, 'local_upload');
    const idempotent = await completeProductImageUpload({ teamId: fixture.teamId, userId: fixture.createdBy, uploadId: directSigned.uploadId, inspectObject });
    assert.equal(idempotent.asset.id, completed.asset.id);

    const failedSigned = await signProductImageUploadForTeam({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      data: { fileName: 'invalid.png', contentType: 'image/png', byteSize: png.length },
    });
    uploadIds.push(failedSigned.uploadId);
    await assert.rejects(
      () => completeProductImageUpload({
        teamId: fixture.teamId,
        userId: fixture.createdBy,
        uploadId: failedSigned.uploadId,
        inspectObject: async () => { throw Object.assign(new Error('Product image magic bytes mismatch.'), { code: 'magic_bytes_mismatch' }); },
      }),
      (error: unknown) => error instanceof ProductImageUploadError && error.diagnostic.code === 'magic_bytes_mismatch',
    );
    const failedRow = (await db.select().from(assetUploads).where(eq(assetUploads.id, failedSigned.uploadId)).limit(1))[0];
    assert.equal(failedRow?.status, 'failed');
    assert.equal(failedRow?.stage, 'verification');
    assert.equal(failedRow?.errorCode, 'magic_bytes_mismatch');

    const fallbackSigned = await signProductImageUploadForTeam({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      data: { fileName: 'fallback.png', contentType: 'image/png', byteSize: png.length },
    });
    uploadIds.push(fallbackSigned.uploadId);
    let streamedBytes = 0;
    const fallback = await fallbackProductImageUpload({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      uploadId: fallbackSigned.uploadId,
      contentType: 'image/png',
      byteSize: png.length,
      body: Readable.from([png.subarray(0, 4), png.subarray(4)]),
      uploadStream: async ({ body }) => { for await (const chunk of body) streamedBytes += Buffer.byteLength(chunk); },
      inspectObject,
    });
    assetIds.push(fallback.asset.id);
    assert.equal(streamedBytes, png.length);
    assert.equal(fallback.upload.status, 'completed');

    const expiredSigned = await signProductImageUploadForTeam({
      teamId: fixture.teamId,
      userId: fixture.createdBy,
      data: { fileName: 'expired.png', contentType: 'image/png', byteSize: png.length },
    });
    uploadIds.push(expiredSigned.uploadId);
    await db.update(assetUploads).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(assetUploads.id, expiredSigned.uploadId));
    const cleanup = await cleanupExpiredProductImageUploads({ teamId: fixture.teamId, deleteObject });
    assert.equal(cleanup.cleaned >= 1, true);
    const expiredRow = (await db.select().from(assetUploads).where(eq(assetUploads.id, expiredSigned.uploadId)).limit(1))[0];
    assert.equal(expiredRow?.status, 'expired');
    const repeatedCleanup = await cleanupExpiredProductImageUploads({ teamId: fixture.teamId, deleteObject });
    assert.equal(repeatedCleanup.candidates, 0);

    await deleteUnreferencedProductImageUpload({ teamId: fixture.teamId, uploadId: directSigned.uploadId, deleteObject });
    assert.equal((await db.select().from(assetUploads).where(eq(assetUploads.id, directSigned.uploadId))).length, 0);
    assert.equal((await db.select().from(assets).where(eq(assets.id, completed.asset.id))).length, 0);
    uploadIds.splice(uploadIds.indexOf(directSigned.uploadId), 1);
    assetIds.splice(assetIds.indexOf(completed.asset.id), 1);

    const newActivities = await db.select({ id: activityLogs.id }).from(activityLogs).where(and(
      eq(activityLogs.teamId, fixture.teamId),
      eq(activityLogs.userId, fixture.createdBy),
      inArray(activityLogs.action, ['UPLOAD_PRODUCT_ASSET']),
    ));
    activityIds.push(...newActivities.filter((row) => row.id > baselineActivity).map((row) => row.id));
    assert.equal(activityIds.length, 2);
  } finally {
    await db.transaction(async (transaction) => {
      if (uploadIds.length > 0) await transaction.delete(assetUploads).where(inArray(assetUploads.id, uploadIds));
      if (assetIds.length > 0) await transaction.delete(assets).where(inArray(assets.id, assetIds));
      if (activityIds.length > 0) await transaction.delete(activityLogs).where(inArray(activityLogs.id, activityIds));
    });
  }

  console.info('Product image upload checks passed.');
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
