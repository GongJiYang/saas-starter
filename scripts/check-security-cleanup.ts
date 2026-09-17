import assert from 'node:assert/strict';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { assets, catalogItems, creativeSpecVersions, productionBatchItems, productionBatches, shotCards, shotSkillVersions, videoJobs } from '../lib/db/schema';
import { compileApprovedSpecRecipe, resolveShotSkillVersionForApprovedSpec } from '../lib/shot-skills';
import { specEnvelopeSchema } from '../lib/creative-spec/compiler';

async function main() {
  const crossWorkspaceCounts = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM production_batch_items i JOIN production_batches b ON b.id = i.production_batch_id WHERE i.team_id <> b.team_id) AS batch_team_mismatch,
      (SELECT count(*) FROM production_batch_items i JOIN catalog_items c ON c.id = i.catalog_item_id WHERE i.team_id <> c.team_id) AS sku_team_mismatch,
      (SELECT count(*) FROM production_batch_items i JOIN campaigns c ON c.id = i.campaign_id WHERE i.campaign_id IS NOT NULL AND i.team_id <> c.team_id) AS campaign_team_mismatch,
      (SELECT count(*) FROM creative_spec_versions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.team_id <> c.team_id) AS spec_team_mismatch,
      (SELECT count(*) FROM video_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE j.team_id <> c.team_id) AS job_team_mismatch,
      (SELECT count(*) FROM video_jobs j JOIN assets a ON a.id = j.output_asset_id WHERE j.output_asset_id IS NOT NULL AND j.team_id <> a.team_id) AS output_asset_team_mismatch
  `))[0] as Record<string, string | number>;
  for (const [name, value] of Object.entries(crossWorkspaceCounts)) assert.equal(Number(value), 0, `${name} must be zero`);

  const orphanTemporaryRows = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM asset_uploads u WHERE u.status IN ('signed','uploading','uploaded','archiving') AND u.expires_at < now()) AS expired_open_uploads,
      (SELECT count(*) FROM production_batch_items i LEFT JOIN campaigns c ON c.id = i.campaign_id WHERE i.campaign_id IS NOT NULL AND c.id IS NULL) AS missing_campaign_refs,
      (SELECT count(*) FROM production_batch_items i LEFT JOIN creative_spec_versions s ON s.id = i.creative_spec_version_id WHERE i.creative_spec_version_id IS NOT NULL AND s.id IS NULL) AS missing_spec_refs
  `))[0] as Record<string, string | number>;
  assert.equal(Number(orphanTemporaryRows.missing_campaign_refs), 0);
  assert.equal(Number(orphanTemporaryRows.missing_spec_refs), 0);

  const approved = (await db.select({ spec: creativeSpecVersions, skill: shotSkillVersions })
    .from(creativeSpecVersions)
    .innerJoin(productionBatchItems, eq(productionBatchItems.creativeSpecVersionId, creativeSpecVersions.id))
    .innerJoin(shotCards, and(eq(shotCards.campaignId, productionBatchItems.campaignId), eq(shotCards.status, 'selected')))
    .innerJoin(shotSkillVersions, eq(shotSkillVersions.id, shotCards.shotSkillVersionId))
    .where(eq(creativeSpecVersions.status, 'approved')).limit(1))[0];
  if (approved) {
    const skill = await resolveShotSkillVersionForApprovedSpec({ teamId: approved.spec.teamId, specSnapshot: approved.spec.specSnapshot, lockedVersionId: approved.skill.id });
    const recipe = compileApprovedSpecRecipe({
      specSnapshot: approved.spec.specSnapshot,
      shotSkillVersionId: skill.version.id,
      skill: skill.definition,
      selectionReason: skill.selectionReason,
    });
    const envelope = specEnvelopeSchema.parse(JSON.parse(approved.spec.specSnapshot));
    const signedUrlEnvelope = {
      ...envelope,
      brief: { ...envelope.brief, primaryImageUrl: `${envelope.brief.primaryImageUrl}?X-Amz-Signature=temporary` },
    };
    const signedRecipe = compileApprovedSpecRecipe({
      specSnapshot: JSON.stringify(signedUrlEnvelope),
      shotSkillVersionId: skill.version.id,
      skill: skill.definition,
      selectionReason: skill.selectionReason,
    });
    assert.equal(recipe.recipeHash, signedRecipe.recipeHash, 'temporary signed image URLs must not enter frozen Recipe hash');
    assert.equal('primaryImageUrl' in recipe.providerNeutralRecipe, false);
    assert.equal('detailImageUrls' in recipe.providerNeutralRecipe, false);
  }

  const stableModeRows = await db.select({ id: productionBatches.id }).from(productionBatches).where(isNull(productionBatches.generationMode));
  assert.equal(stableModeRows.length, 0, 'new Production Batches require generation mode');
  console.info('Security, audit, cleanup, and transient-URL checks passed.');
}

void main();
