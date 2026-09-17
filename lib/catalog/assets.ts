import { and, eq } from 'drizzle-orm';
import { archiveRemoteObject } from '@/lib/storage/cos';
import { consumeRateLimit } from '@/lib/ops/rate-limit';
import { db } from '@/lib/db/drizzle';
import { assetUploads, assets } from '@/lib/db/schema';

export type CatalogTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function archiveCatalogImage(
  transaction: CatalogTransaction,
  input: {
    teamId: number;
    userId: number;
    sourceUrl: string;
    uploadSource: 'remote_archive' | 'csv_import';
  },
): Promise<number> {
  const hostname = new URL(input.sourceUrl).hostname;
  if (!consumeRateLimit(`remote-host:${hostname}`, 120, 60_000)) {
    throw new Error(`Remote host rate limit exceeded for ${hostname}.`);
  }
  const archived = await archiveRemoteObject({
    teamId: input.teamId,
    sourceUrl: input.sourceUrl,
    kind: 'image',
  });
  const existing = await transaction
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.teamId, input.teamId), eq(assets.objectKey, archived.objectKey)))
    .limit(1);
  let assetId = existing[0]?.id;
  if (!assetId) {
    const inserted = await transaction
      .insert(assets)
      .values({
        teamId: input.teamId,
        uploadedBy: input.userId,
        type: 'product_image',
        uploadSource: input.uploadSource,
        objectKey: archived.objectKey,
        fileName: archived.fileName,
        contentType: archived.contentType,
        byteSize: archived.byteSize,
      })
      .returning({ id: assets.id });
    assetId = inserted[0]?.id;
  }
  if (!assetId) throw new Error('Archived product image could not be recorded.');
  const completedAt = new Date();
  await transaction.insert(assetUploads).values({
    teamId: input.teamId,
    createdBy: input.userId,
    assetId,
    source: input.uploadSource,
    status: 'completed',
    stage: 'complete',
    objectKey: archived.objectKey,
    fileName: archived.fileName,
    contentType: archived.contentType,
    byteSize: archived.byteSize,
    uploadedAt: completedAt,
    archivedAt: completedAt,
  }).onConflictDoNothing({ target: [assetUploads.teamId, assetUploads.objectKey] });
  return assetId;
}
