import { and, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { db } from '@/lib/db/drizzle';
import {
  ActivityType,
  activityLogs,
  assetUploads,
  assets,
  campaigns,
  catalogItemAssets,
  catalogItems,
  productionBatchItems,
  productionBatches,
  videoJobs,
  type Asset,
  type AssetUpload,
} from '@/lib/db/schema';
import {
  PRODUCT_IMAGE_FAILED_RETENTION_MS,
  classifyUploadError,
  productImageUploadRequestSchema,
  uploadPreflightResultSchema,
  type ProductImageContentType,
  type UploadDiagnostic,
  type UploadPreflightResult,
} from './contracts';
import {
  createPresignedProductImageUpload,
  deleteObjectForTeam,
  getObjectStoragePublicConfiguration,
  inspectProductImageObject,
  probeUploadCors,
  uploadProductImageStream,
} from '@/lib/storage/cos';

export class ProductImageUploadError extends Error {
  constructor(readonly diagnostic: UploadDiagnostic) {
    super(diagnostic.message);
  }
}

async function getUploadForTeam(teamId: number, uploadId: number): Promise<AssetUpload | null> {
  const rows = await db.select().from(assetUploads).where(and(
    eq(assetUploads.teamId, teamId),
    eq(assetUploads.id, uploadId),
  )).limit(1);
  return rows[0] ?? null;
}

async function getCompletedAsset(upload: AssetUpload): Promise<Asset | null> {
  if (!upload.assetId) return null;
  const rows = await db.select().from(assets).where(and(
    eq(assets.teamId, upload.teamId),
    eq(assets.id, upload.assetId),
  )).limit(1);
  return rows[0] ?? null;
}

async function recordUploadFailure(upload: AssetUpload, diagnostic: UploadDiagnostic): Promise<void> {
  await db.update(assetUploads).set({
    status: 'failed',
    stage: diagnostic.stage === 'preflight' ? 'transfer' : diagnostic.stage,
    failedAt: new Date(),
    errorCode: diagnostic.code,
    errorMessage: `${diagnostic.message} ${diagnostic.recommendation}`,
    updatedAt: new Date(),
  }).where(and(eq(assetUploads.teamId, upload.teamId), eq(assetUploads.id, upload.id)));
}

function assertActiveUpload(upload: AssetUpload): void {
  if (upload.status === 'completed') return;
  if (upload.status === 'failed' || upload.status === 'expired') {
    throw new ProductImageUploadError(classifyUploadError(
      Object.assign(new Error('Upload is no longer active.'), { code: upload.errorCode ?? 'upload_expired' }),
      'transfer',
    ));
  }
  if (upload.expiresAt && upload.expiresAt.getTime() <= Date.now()) {
    throw new ProductImageUploadError({
      code: 'upload_expired',
      stage: 'transfer',
      message: 'The product image upload has expired.',
      retryable: true,
      recommendation: 'Request a new signed upload URL.',
    });
  }
}

export async function signProductImageUploadForTeam(input: {
  teamId: number;
  userId: number;
  data: unknown;
}) {
  const request = productImageUploadRequestSchema.parse(input.data);
  const signed = createPresignedProductImageUpload({
    teamId: input.teamId,
    contentType: request.contentType,
    byteSize: request.byteSize,
  });
  const inserted = await db.insert(assetUploads).values({
    teamId: input.teamId,
    createdBy: input.userId,
    source: 'local_upload',
    status: 'signed',
    stage: 'signing',
    objectKey: signed.objectKey,
    fileName: request.fileName,
    contentType: request.contentType,
    byteSize: request.byteSize,
    expiresAt: new Date(signed.expiresAt),
  }).returning();
  if (!inserted[0]) throw new Error('Product image upload could not be recorded.');
  return {
    uploadId: inserted[0].id,
    objectKey: signed.objectKey,
    url: signed.url,
    headers: signed.headers,
    expiresAt: signed.expiresAt,
    completeUrl: `/api/assets/product-images/${inserted[0].id}/complete`,
    fallbackUrl: `/api/assets/product-images/${inserted[0].id}/fallback`,
  };
}

export async function signProductionImageUploadForTeam(input: {
  teamId: number;
  userId: number;
  batchId: number;
  clientFileId: string;
  sequence: number;
  data: unknown;
}) {
  const request = productImageUploadRequestSchema.parse(input.data);
  const batch = (await db.select({ id: productionBatches.id, sourceMode: productionBatches.sourceMode })
    .from(productionBatches)
    .where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId)))
    .limit(1))[0];
  if (!batch || batch.sourceMode !== 'uploaded_images') throw new Error('Image-to-Video Batch is not available in the current Workspace.');
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) throw new Error('Invalid image sequence.');
  if (!input.clientFileId.trim() || input.clientFileId.length > 100) throw new Error('Invalid client file identifier.');
  const previous = (await db.select().from(assetUploads).where(and(
    eq(assetUploads.teamId, input.teamId),
    eq(assetUploads.productionBatchId, input.batchId),
    eq(assetUploads.clientFileId, input.clientFileId),
  )).limit(1))[0];
  if (previous?.status === 'completed') throw new Error('This batch image is already archived.');
  if (previous) {
    try {
      await deleteObjectForTeam({ teamId: input.teamId, objectKey: previous.objectKey });
      await db.delete(assetUploads).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, previous.id)));
    } catch (error) {
      const diagnostic = classifyUploadError(error, 'archive');
      if (diagnostic.code === 'object_not_found') {
        await db.delete(assetUploads).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, previous.id)));
      } else {
        await db.update(assetUploads).set({ status: 'failed', errorCode: diagnostic.code, errorMessage: diagnostic.message, failedAt: new Date(), updatedAt: new Date() }).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, previous.id)));
        throw new ProductImageUploadError(diagnostic);
      }
    }
  }
  const signed = await signProductImageUploadForTeam({ teamId: input.teamId, userId: input.userId, data: request });
  await db.update(assetUploads).set({
    productionBatchId: input.batchId,
    clientFileId: input.clientFileId,
    sequence: input.sequence,
    updatedAt: new Date(),
  }).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, signed.uploadId)));
  return signed;
}

export async function completeProductImageUpload(input: {
  teamId: number;
  userId: number;
  uploadId: number;
  inspectObject?: typeof inspectProductImageObject;
}): Promise<{ upload: AssetUpload; asset: Asset }> {
  const upload = await getUploadForTeam(input.teamId, input.uploadId);
  if (!upload) throw new Error('Product image upload not found.');
  if (upload.status === 'completed') {
    const asset = await getCompletedAsset(upload);
    if (!asset) throw new Error('Completed product image Asset is unavailable.');
    return { upload, asset };
  }
  try {
    assertActiveUpload(upload);
  } catch (error) {
    if (error instanceof ProductImageUploadError && error.diagnostic.code === 'upload_expired') {
      await db.update(assetUploads).set({ status: 'expired', errorCode: 'upload_expired', errorMessage: error.message, updatedAt: new Date() })
        .where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, input.uploadId)));
    }
    throw error;
  }
  await db.update(assetUploads).set({
    status: 'uploaded',
    stage: 'verification',
    uploadedAt: upload.uploadedAt ?? new Date(),
    updatedAt: new Date(),
  }).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, input.uploadId)));
  try {
    await (input.inspectObject ?? inspectProductImageObject)({
      teamId: input.teamId,
      objectKey: upload.objectKey,
      expectedContentType: upload.contentType as ProductImageContentType,
      expectedByteSize: upload.byteSize,
    });
  } catch (error) {
    const diagnostic = classifyUploadError(error, 'verification');
    await recordUploadFailure(upload, diagnostic);
    throw new ProductImageUploadError(diagnostic);
  }

  return db.transaction(async (transaction) => {
    const inserted = await transaction.insert(assets).values({
      teamId: input.teamId,
      uploadedBy: input.userId,
      type: 'product_image',
      uploadSource: 'local_upload',
      objectKey: upload.objectKey,
      fileName: upload.fileName,
      contentType: upload.contentType,
      byteSize: upload.byteSize,
    }).onConflictDoNothing({ target: assets.objectKey }).returning();
    const asset = inserted[0] ?? (await transaction.select().from(assets).where(and(
      eq(assets.teamId, input.teamId),
      eq(assets.objectKey, upload.objectKey),
    )).limit(1))[0];
    if (!asset) throw new Error('Product image Asset could not be created.');
    const completed = await transaction.update(assetUploads).set({
      assetId: asset.id,
      status: 'completed',
      stage: 'complete',
      archivedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, input.uploadId))).returning();
    if (upload.productionBatchId !== null) {
      if (upload.sequence === null) throw new Error('Batch image upload is missing its sequence.');
      const batch = (await transaction.select({ id: productionBatches.id, sourceMode: productionBatches.sourceMode })
        .from(productionBatches)
        .where(and(eq(productionBatches.id, upload.productionBatchId), eq(productionBatches.teamId, input.teamId)))
        .limit(1))[0];
      if (!batch || batch.sourceMode !== 'uploaded_images') throw new Error('Image-to-Video Batch is not available in the current Workspace.');
      await transaction.insert(productionBatchItems).values({
        teamId: input.teamId,
        productionBatchId: batch.id,
        inputAssetId: asset.id,
        sequence: upload.sequence,
        status: 'ready',
        promptMode: 'inherit',
      }).onConflictDoNothing();
    }
    await transaction.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.UPLOAD_PRODUCT_ASSET,
    });
    return { upload: completed[0]!, asset };
  });
}

export async function fallbackProductImageUpload(input: {
  teamId: number;
  userId: number;
  uploadId: number;
  contentType: string;
  byteSize: number;
  body: Readable;
  uploadStream?: typeof uploadProductImageStream;
  inspectObject?: typeof inspectProductImageObject;
}): Promise<{ upload: AssetUpload; asset: Asset }> {
  const upload = await getUploadForTeam(input.teamId, input.uploadId);
  if (!upload) throw new Error('Product image upload not found.');
  assertActiveUpload(upload);
  if (upload.contentType !== input.contentType) {
    const diagnostic = classifyUploadError(Object.assign(new Error('Product image MIME does not match the signed request.'), { code: 'mime_mismatch' }), 'transfer');
    await recordUploadFailure(upload, diagnostic);
    throw new ProductImageUploadError(diagnostic);
  }
  if (upload.byteSize !== input.byteSize) {
    const diagnostic = classifyUploadError(Object.assign(new Error('Product image length does not match the signed request.'), { code: 'size_mismatch' }), 'transfer');
    await recordUploadFailure(upload, diagnostic);
    throw new ProductImageUploadError(diagnostic);
  }
  await db.update(assetUploads).set({ status: 'uploading', stage: 'transfer', updatedAt: new Date() })
    .where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, input.uploadId)));
  try {
    await (input.uploadStream ?? uploadProductImageStream)({
      teamId: input.teamId,
      objectKey: upload.objectKey,
      contentType: upload.contentType as ProductImageContentType,
      byteSize: upload.byteSize,
      body: input.body,
    });
  } catch (error) {
    const diagnostic = classifyUploadError(error, 'transfer');
    await recordUploadFailure(upload, diagnostic);
    throw new ProductImageUploadError(diagnostic);
  }
  return completeProductImageUpload({ teamId: input.teamId, userId: input.userId, uploadId: input.uploadId, inspectObject: input.inspectObject });
}

export async function inspectUploadPreflight(input: {
  teamId: number;
  origin: string;
  contentType: string;
}): Promise<UploadPreflightResult> {
  const storage = getObjectStoragePublicConfiguration();
  let diagnostic: UploadDiagnostic | null = null;
  let cors: UploadPreflightResult['cors'] = { status: 'unknown', allowsOrigin: false, allowsPut: false, allowsContentType: false };
  try {
    const result = await probeUploadCors(input);
    const available = result.allowsOrigin && result.allowsPut && result.allowsContentType;
    cors = { status: available ? 'available' as const : 'denied' as const, ...result };
    if (!available) {
      diagnostic = classifyUploadError(Object.assign(new Error('COS CORS policy does not allow this browser upload.'), { statusCode: 403 }), 'preflight');
    }
  } catch (error) {
    diagnostic = classifyUploadError(error, 'preflight');
    cors = { status: diagnostic.code === 'cors_preflight_denied' ? 'denied' : 'unknown', allowsOrigin: false, allowsPut: false, allowsContentType: false };
  }
  return uploadPreflightResultSchema.parse({
    ...storage,
    origin: input.origin,
    signingAvailable: true,
    cors,
    directUploadAvailable: cors.status === 'available',
    serverFallbackAvailable: true,
    diagnostic,
  });
}

async function assetIsReferenced(teamId: number, assetId: number): Promise<boolean> {
  const [primary, detail, campaign, batchItem, jobInput, jobOutput] = await Promise.all([
    db.select({ id: catalogItems.id }).from(catalogItems).where(and(eq(catalogItems.teamId, teamId), eq(catalogItems.primaryAssetId, assetId))).limit(1),
    db.select({ id: catalogItemAssets.id }).from(catalogItemAssets).where(and(eq(catalogItemAssets.teamId, teamId), eq(catalogItemAssets.assetId, assetId))).limit(1),
    db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.teamId, teamId), eq(campaigns.productAssetId, assetId))).limit(1),
    db.select({ id: productionBatchItems.id }).from(productionBatchItems).where(and(eq(productionBatchItems.teamId, teamId), eq(productionBatchItems.inputAssetId, assetId))).limit(1),
    db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.teamId, teamId), eq(videoJobs.inputAssetId, assetId))).limit(1),
    db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.teamId, teamId), eq(videoJobs.outputAssetId, assetId))).limit(1),
  ]);
  return Boolean(primary[0] || detail[0] || campaign[0] || batchItem[0] || jobInput[0] || jobOutput[0]);
}

export async function deleteUnreferencedProductImageUpload(input: { teamId: number; uploadId: number; productionBatchId?: number; deleteObject?: typeof deleteObjectForTeam }): Promise<void> {
  const upload = await getUploadForTeam(input.teamId, input.uploadId);
  if (!upload || (input.productionBatchId !== undefined && upload.productionBatchId !== input.productionBatchId)) return;
  if (upload.assetId && await assetIsReferenced(input.teamId, upload.assetId)) {
    throw new Error('Product image Asset is still referenced by this Workspace.');
  }
  try {
    await (input.deleteObject ?? deleteObjectForTeam)({ teamId: input.teamId, objectKey: upload.objectKey });
  } catch (error) {
    const diagnostic = classifyUploadError(error, 'archive');
    if (diagnostic.code !== 'object_not_found') throw new ProductImageUploadError(diagnostic);
  }
  await db.transaction(async (transaction) => {
    await transaction.delete(assetUploads).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, input.uploadId)));
    if (upload.assetId) await transaction.delete(assets).where(and(eq(assets.teamId, input.teamId), eq(assets.id, upload.assetId)));
  });
}

export async function cleanupExpiredProductImageUploads(input: { teamId: number; deleteObject?: typeof deleteObjectForTeam }) {
  const cutoff = new Date(Date.now() - PRODUCT_IMAGE_FAILED_RETENTION_MS);
  const candidates = await db.select().from(assetUploads).where(and(
    eq(assetUploads.teamId, input.teamId),
    or(
      and(inArray(assetUploads.status, ['signed', 'uploading', 'uploaded']), lt(assetUploads.expiresAt, new Date())),
      and(eq(assetUploads.status, 'failed'), isNotNull(assetUploads.failedAt), lt(assetUploads.failedAt, cutoff)),
    ),
  ));
  let cleaned = 0;
  const failures: Array<{ uploadId: number; diagnostic: UploadDiagnostic }> = [];
  for (const upload of candidates) {
    try {
      await (input.deleteObject ?? deleteObjectForTeam)({ teamId: input.teamId, objectKey: upload.objectKey });
      await db.update(assetUploads).set({
        status: 'expired',
        errorCode: upload.errorCode ?? 'upload_expired',
        errorMessage: upload.errorMessage ?? 'Expired upload object was removed.',
        updatedAt: new Date(),
      }).where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, upload.id)));
      cleaned += 1;
    } catch (error) {
      const diagnostic = classifyUploadError(error, 'archive');
      if (diagnostic.code === 'object_not_found') {
        await db.update(assetUploads).set({ status: 'expired', errorCode: 'upload_expired', errorMessage: 'Expired upload object was already absent.', updatedAt: new Date() })
          .where(and(eq(assetUploads.teamId, input.teamId), eq(assetUploads.id, upload.id)));
        cleaned += 1;
      } else {
        failures.push({ uploadId: upload.id, diagnostic });
      }
    }
  }
  return { candidates: candidates.length, cleaned, failures };
}
