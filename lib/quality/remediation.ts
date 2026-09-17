import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { createRemediationSpecVersions } from '@/lib/creative-spec/actions';
import { ActivityType, activityLogs, creativeSpecVersions, productionBatchItems, productionBatches } from '@/lib/db/schema';
import { qualityReportSchema } from './gates';

const remediationRecordSchema = {
  status: 'pending_canary' as const,
};

export async function createBatchRemediation(input: {
  teamId: number;
  userId: number;
  batchId: number;
  itemIds: number[];
  request: unknown;
  fields: Parameters<typeof createRemediationSpecVersions>[0]['fields'];
}) {
  const result = await createRemediationSpecVersions({ teamId: input.teamId, userId: input.userId, productionBatchId: input.batchId, itemIds: input.itemIds, request: input.request, fields: input.fields });
  const current = await db.select().from(productionBatches).where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId))).limit(1);
  if (!current[0]) throw new Error('Production Batch not found.');
  let stopLossConfig: Record<string, unknown> = {};
  try { const parsed: unknown = JSON.parse(current[0].stopLossConfig); if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) stopLossConfig = parsed as Record<string, unknown>; } catch { stopLossConfig = {}; }
  const remediation = { ...remediationRecordSchema, cause: result.cause, changedInputField: result.changedInputField, itemIds: result.itemIds, specVersionIds: result.specs.map((spec) => spec.id), createdAt: new Date().toISOString() };
  await db.update(productionBatches).set({ stopLossConfig: JSON.stringify({ ...stopLossConfig, remediation }), updatedAt: new Date() }).where(eq(productionBatches.id, input.batchId));
  await db.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.CREATE_REMEDIATION });
  return { ...result, remediation };
}

export async function bindRemediationCanary(input: { teamId: number; batchId: number; pairs: Array<{ itemId: number; specVersionId: number }> }) {
  if (input.pairs.length < 2 || input.pairs.length > 3) throw new Error('A remediation Canary must contain two or three SKU.');
  const batch = await db.select().from(productionBatches).where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId))).limit(1);
  if (!batch[0] || batch[0].status !== 'paused') throw new Error('Canary binding requires a paused Production Batch.');
  const itemIds = input.pairs.map((pair) => pair.itemId);
  const specIds = input.pairs.map((pair) => pair.specVersionId);
  const items = await db.select().from(productionBatchItems).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId), inArray(productionBatchItems.id, itemIds)));
  const specs = await db.select().from(creativeSpecVersions).where(and(eq(creativeSpecVersions.teamId, input.teamId), inArray(creativeSpecVersions.id, specIds), eq(creativeSpecVersions.status, 'draft')));
  if (items.length !== input.pairs.length || specs.length !== input.pairs.length) throw new Error('Canary items and draft corrective Specs do not match this Batch.');
  for (const pair of input.pairs) {
    const item = items.find((candidate) => candidate.id === pair.itemId);
    const spec = specs.find((candidate) => candidate.id === pair.specVersionId);
    if (!item || !spec || spec.campaignId !== item.campaignId) throw new Error('Each Canary item must bind its own corrective Spec.');
  }
  await db.transaction(async (tx) => {
    for (const pair of input.pairs) await tx.update(productionBatchItems).set({ creativeSpecVersionId: pair.specVersionId, status: 'ready', updatedAt: new Date() }).where(and(eq(productionBatchItems.id, pair.itemId), eq(productionBatchItems.teamId, input.teamId)));
  });
  return { itemIds, specVersionIds: specIds, status: 'awaiting_spec_approval' as const };
}

export async function evaluateRemediationCanary(input: { teamId: number; batchId: number; itemIds: number[] }) {
  const rows = await db.select().from(productionBatchItems).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId), inArray(productionBatchItems.id, input.itemIds)));
  if (rows.length !== input.itemIds.length) throw new Error('Canary items do not belong to this Batch.');
  const reports = rows.map((row) => { try { const parsed: unknown = JSON.parse(row.resultSummary); if (typeof parsed === 'object' && parsed !== null && 'quality' in parsed) return qualityReportSchema.safeParse(parsed.quality).data; } catch { return undefined; } return undefined; });

  const passed = reports.length === rows.length && reports.every((report) => report?.passed === true) && rows.every((row) => row.status === 'completed');
  return { passed, itemIds: input.itemIds, reason: passed ? null : 'Every Canary must pass quality and be adopted before releasing the remaining SKU.' };
}

export async function releaseRemainingRemediation(input: { teamId: number; batchId: number; canaryItemIds: number[]; pairs: Array<{ itemId: number; specVersionId: number }> }) {
  const canary = await evaluateRemediationCanary({ teamId: input.teamId, batchId: input.batchId, itemIds: input.canaryItemIds });
  if (!canary.passed) throw new Error(canary.reason ?? 'Canary has not passed.');
  const batch = await db.select().from(productionBatches).where(and(eq(productionBatches.id, input.batchId), eq(productionBatches.teamId, input.teamId), eq(productionBatches.status, 'paused'))).limit(1);
  if (!batch[0]) throw new Error('Remaining remediation release requires a paused Production Batch.');
  if (input.pairs.length === 0) throw new Error('At least one remaining SKU is required.');
  const itemIds = input.pairs.map((pair) => pair.itemId);
  const specIds = input.pairs.map((pair) => pair.specVersionId);
  const items = await db.select().from(productionBatchItems).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.productionBatchId, input.batchId), inArray(productionBatchItems.id, itemIds)));
  const specs = await db.select().from(creativeSpecVersions).where(and(eq(creativeSpecVersions.teamId, input.teamId), inArray(creativeSpecVersions.id, specIds), eq(creativeSpecVersions.status, 'approved')));
  if (items.length !== input.pairs.length || specs.length !== input.pairs.length) throw new Error('Remaining items and approved corrective Specs do not match this Batch.');
  for (const pair of input.pairs) {
    const item = items.find((candidate) => candidate.id === pair.itemId);
    const spec = specs.find((candidate) => candidate.id === pair.specVersionId);
    if (!item || !spec || spec.campaignId !== item.campaignId) throw new Error('Each remaining item must bind an approved Spec for its Campaign.');
  }
  await db.transaction(async (tx) => {
    for (const pair of input.pairs) await tx.update(productionBatchItems).set({ creativeSpecVersionId: pair.specVersionId, status: 'ready', updatedAt: new Date() }).where(and(eq(productionBatchItems.id, pair.itemId), eq(productionBatchItems.teamId, input.teamId)));
  });
  return { canary: true, releasedItemIds: itemIds, status: 'awaiting_resume' as const };
}
