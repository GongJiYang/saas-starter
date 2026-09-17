import { and, eq, lt, ne } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { importBatches } from '@/lib/db/schema';
import { deleteObjectForTeam } from '@/lib/storage/cos';

export async function cleanupExpiredImportObjects(input: { teamId?: number; retentionDays?: number } = {}) {
  const cutoff = new Date(Date.now() - (input.retentionDays ?? 7) * 24 * 60 * 60 * 1000);
  const batches = await db.select().from(importBatches).where(and(lt(importBatches.createdAt, cutoff), ne(importBatches.status, 'committed'), input.teamId ? eq(importBatches.teamId, input.teamId) : undefined));
  let cleaned = 0;
  for (const batch of batches) {
    try {
      await deleteObjectForTeam({ teamId: batch.teamId, objectKey: batch.fileObjectKey });
      await db.update(importBatches).set({ status: 'failed', updatedAt: new Date() }).where(eq(importBatches.id, batch.id));
      cleaned += 1;
    } catch {
      // Keep the batch retryable when object storage is temporarily unavailable.
    }
  }
  return { scanned: batches.length, cleaned };
}
