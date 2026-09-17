import assert from 'node:assert/strict';
import { desc } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { productionBatches } from '../lib/db/schema';
import { getGuidedProductionBatchDetailForTeam } from '../lib/production-batches/detail';

async function main() {
  const fixture = (await db.select({ id: productionBatches.id, teamId: productionBatches.teamId })
    .from(productionBatches)
    .orderBy(desc(productionBatches.createdAt))
    .limit(1))[0];
  if (!fixture) throw new Error('A Production Batch is required for the guided Workbench check.');
  const detail = await getGuidedProductionBatchDetailForTeam(fixture.teamId, fixture.id);
  assert.ok(detail);
  assert.equal(detail.batch.id, fixture.id);
  assert.equal(detail.progress.counts.total, detail.items.length);
  assert.deepEqual(detail.diagnostics.itemIds, detail.items.map((row) => row.item.id));
  assert.deepEqual(detail.diagnostics.catalogItemIds, detail.items.map((row) => row.catalogItem.id));
  assert.ok(detail.timeline.length >= 1);
  assert.equal(detail.timeline[0]?.type, 'task_created');
  assert.ok(detail.timeline.every((event, index, events) => index === 0 || event.at >= events[index - 1]!.at));
  assert.ok(detail.blockers.every((blocker) => blocker.message.length > 0));
  assert.ok(detail.blockers.every((blocker) => blocker.href === null || blocker.href.startsWith('/dashboard/')));
  assert.ok(detail.skillBindings.every((binding) => binding.productionBatchId === fixture.id));
  assert.equal(await getGuidedProductionBatchDetailForTeam(2_147_483_647, fixture.id), null);
  console.info('Guided Production Workbench checks passed.');
}

void main();
