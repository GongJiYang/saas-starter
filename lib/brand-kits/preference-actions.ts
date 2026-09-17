import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { ActivityType, activityLogs, brandKitPreferenceVersions, brandKits, campaigns, productionBatchItems } from '@/lib/db/schema';

export async function saveBatchBrandPreference(input: { teamId: number; userId: number; batchId: number; preference: string }) {
  const preference = input.preference.trim();
  if (!preference) throw new Error('Brand Preference is required.');
  const source = await db
    .select({ brandKitId: brandKits.id })
    .from(productionBatchItems)
    .innerJoin(campaigns, eq(productionBatchItems.campaignId, campaigns.id))
    .innerJoin(brandKits, eq(campaigns.brandKitId, brandKits.id))
    .where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId)))
    .limit(1);
  if (!source[0]) throw new Error('Batch has no Brand Kit.');
  return db.transaction(async (tx) => {
    const latest = await tx
      .select({ version: brandKitPreferenceVersions.version })
      .from(brandKitPreferenceVersions)
      .where(and(eq(brandKitPreferenceVersions.teamId, input.teamId), eq(brandKitPreferenceVersions.brandKitId, source[0].brandKitId)))
      .orderBy(desc(brandKitPreferenceVersions.version))
      .limit(1);
    const version = (latest[0]?.version ?? 0) + 1;
    await tx.insert(brandKitPreferenceVersions).values({ brandKitId: source[0].brandKitId, teamId: input.teamId, version, preference, sourceBatchId: input.batchId, createdBy: input.userId });
    await tx.update(brandKits).set({ defaultShotPreference: preference, updatedAt: new Date() }).where(and(eq(brandKits.id, source[0].brandKitId), eq(brandKits.teamId, input.teamId)));
    await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.UPDATE_BRAND_KIT });
    return { brandKitId: source[0].brandKitId, version, preference };
  });
}
