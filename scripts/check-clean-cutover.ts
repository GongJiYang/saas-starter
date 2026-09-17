import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { CSV_TEMPLATE_VERSION } from '../lib/bulk/contracts';

async function main() {
  const counts = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM production_batches WHERE generation_mode IS NULL) AS batches_without_mode,
      (SELECT count(*) FROM production_batches WHERE generation_mode NOT IN ('single','bulk')) AS batches_invalid_mode,
      (SELECT count(*) FROM import_batches WHERE template_version IS NULL OR template_version NOT IN ('v1','v2')) AS imports_invalid_version,
      (SELECT count(*) FROM production_batch_items i WHERE i.campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = i.campaign_id AND c.team_id = i.team_id)) AS items_with_cross_workspace_campaign,
      (SELECT count(*) FROM production_batch_items i WHERE i.creative_spec_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM creative_spec_versions s WHERE s.id = i.creative_spec_version_id AND s.team_id = i.team_id)) AS items_with_cross_workspace_spec
  `))[0] as Record<string, string | number>;
  assert.equal(Number(counts.batches_without_mode), 0);
  assert.equal(Number(counts.batches_invalid_mode), 0);
  assert.equal(Number(counts.imports_invalid_version), 0);
  assert.equal(Number(counts.items_with_cross_workspace_campaign), 0);
  assert.equal(Number(counts.items_with_cross_workspace_spec), 0);
  assert.equal(CSV_TEMPLATE_VERSION, 'v2');
  console.info('Clean cutover checks passed: explicit modes, v2 new imports, and workspace-bound references.');
}

void main();
