import assert from 'node:assert/strict';
import { and, count, desc, eq, gt } from 'drizzle-orm';
import {
  buildCatalogItemEligibilityContext,
  createShotSkillDraftFromVersion,
  evaluateShotSkillEligibility,
  previewCatalogItemEligibilityForTeam,
  listProductionBatchSkillBindingsForTeam,
} from '../lib/shot-skills';
import { productHeroSkill } from '../lib/shot-skills/cards/product-hero';
import { productMacroDetailSkill } from '../lib/shot-skills/cards/product-macro-detail';
import { productUseCaseSkill } from '../lib/shot-skills/cards/product-use-case';
import { createProductionBatch } from '../lib/production-batches/actions';
import { db } from '../lib/db/drizzle';
import {
  ActivityType,
  activityLogs,
  campaigns,
  catalogItems,
  creativeSpecVersions,
  productionBatchItems,
  productionBatches,
  shotSkills,
  shotSkillVersions,
  teamMembers,
  videoJobs,
} from '../lib/db/schema';

const baseContext = {
  shotRole: 'hook' as const,
  productCategory: 'beauty',
  durationSeconds: 5,
  targetPlatform: 'tiktok',
  primaryImageAvailable: true,
  detailImageCount: 2,
  hasSceneBrief: true,
  personRights: 'none' as const,
  brandVoice: 'Precise and premium',
  sellingPoints: 'Clinically tested texture',
  mustShowElements: ['product'],
  immutableElements: ['package'],
  forbiddenElements: ['unapproved claim'],
  shotDirection: 'Clean studio reveal',
};

const heroAtFive = evaluateShotSkillEligibility(baseContext, [productHeroSkill])[0]!;
assert.equal(heroAtFive.eligible, true);
assert.deepEqual(heroAtFive.blockers, []);

const heroAtTen = evaluateShotSkillEligibility({ ...baseContext, durationSeconds: 10 }, [productHeroSkill])[0]!;
assert.equal(heroAtTen.eligible, false);
assert.deepEqual(heroAtTen.blockers.map((blocker) => blocker.code), ['unsupported_duration']);
assert.match(heroAtTen.blockers[0]!.message, /supports 4, 5 seconds, not 10 seconds/);
assert.ok(heroAtTen.reasons.every((reason) => !reason.includes('eligibility.') && !reason.includes('provider.')));

const macroWithoutDetail = evaluateShotSkillEligibility({ ...baseContext, detailImageCount: 0 }, [productMacroDetailSkill])[0]!;
assert.equal(macroWithoutDetail.eligible, false);
assert.ok(macroWithoutDetail.blockers.some((blocker) => blocker.code === 'missing_detail_image'));
assert.ok(macroWithoutDetail.blockers.some((blocker) => blocker.remediations.includes('upload_detail_image')));

const useCaseWithoutScene = evaluateShotSkillEligibility({ ...baseContext, hasSceneBrief: false }, [productUseCaseSkill])[0]!;
assert.equal(useCaseWithoutScene.eligible, false);
assert.ok(useCaseWithoutScene.blockers.some((blocker) => blocker.code === 'missing_scene_brief'));
assert.ok(useCaseWithoutScene.blockers.some((blocker) => blocker.remediations.includes('add_scene_brief')));

const catalogContext = buildCatalogItemEligibilityContext({
  category: 'beauty',
  durationSeconds: 5,
  targetPlatform: 'tiktok',
  primaryImageAvailable: true,
  detailImageCount: 2,
  targetAudience: 'Skincare buyers',
  campaignGoal: 'Show an approved texture detail',
  brandVoice: 'Clinical',
  approvedClaims: [{ text: 'Hydrating', source: 'approved brief' }],
  prohibitedClaims: ['medical cure'],
  mustShowElements: ['logo'],
  immutableElements: ['package shape'],
  forbiddenElements: ['competitor logo'],
  defaultShotPreference: 'Macro first',
});
assert.equal(catalogContext.hasSceneBrief, true);
assert.match(catalogContext.sellingPoints, /Hydrating/);
assert.ok(catalogContext.forbiddenElements.includes('medical cure'));

async function scopedCounts(teamId: number) {
  const tableCounts = await Promise.all([
    db.select({ value: count() }).from(productionBatches).where(eq(productionBatches.teamId, teamId)),
    db.select({ value: count() }).from(campaigns).where(eq(campaigns.teamId, teamId)),
    db.select({ value: count() }).from(creativeSpecVersions).where(eq(creativeSpecVersions.teamId, teamId)),
    db.select({ value: count() }).from(videoJobs).where(eq(videoJobs.teamId, teamId)),
  ]);
  return tableCounts.map((rows) => Number(rows[0]?.value ?? 0));
}

async function main() {
  const fixture = (await db.select({
    catalogItemId: catalogItems.id,
    teamId: catalogItems.teamId,
    userId: teamMembers.userId,
  })
    .from(catalogItems)
    .innerJoin(teamMembers, eq(teamMembers.teamId, catalogItems.teamId))
    .where(eq(catalogItems.readinessStatus, 'ready'))
    .orderBy(desc(catalogItems.createdAt))
    .limit(1))[0];
  if (!fixture) throw new Error('A ready CatalogItem with a Workspace member is required for the Eligibility check.');

  const beforePreview = await scopedCounts(fixture.teamId);
  const previewAtFive = await previewCatalogItemEligibilityForTeam({
    teamId: fixture.teamId,
    catalogItemId: fixture.catalogItemId,
    durationSeconds: 5,
    targetPlatform: 'tiktok',
  });
  assert.ok(previewAtFive);
  assert.ok(previewAtFive.candidates.some((candidate) => candidate.stableId === 'product-hero' && candidate.eligible));
  assert.deepEqual(previewAtFive.supportedDurations, [4, 5]);

  const previewAtTen = await previewCatalogItemEligibilityForTeam({
    teamId: fixture.teamId,
    catalogItemId: fixture.catalogItemId,
    durationSeconds: 10,
    targetPlatform: 'tiktok',
  });
  assert.ok(previewAtTen);
  assert.equal(previewAtTen.canCreate, false);
  assert.ok(previewAtTen.candidates.every((candidate) => !candidate.eligible));
  assert.ok(previewAtTen.candidates.some((candidate) => candidate.blockers.some((blocker) => blocker.code === 'unsupported_duration')));
  assert.equal(await previewCatalogItemEligibilityForTeam({
    teamId: 2_147_483_647,
    catalogItemId: fixture.catalogItemId,
    durationSeconds: 5,
  }), null);
  assert.deepEqual(await scopedCounts(fixture.teamId), beforePreview, 'Preview must have no production side effects.');
  const sourceCandidate = previewAtFive.candidates.find((candidate) => candidate.stableId === 'product-hero');
  assert.ok(sourceCandidate);
  const existingPrivateHero = (await db.select({ id: shotSkills.id }).from(shotSkills).where(and(
    eq(shotSkills.ownerTeamId, fixture.teamId),
    eq(shotSkills.stableId, 'product-hero'),
  )).limit(1))[0];
  const tenSecondDraft = await createShotSkillDraftFromVersion({
    teamId: fixture.teamId,
    userId: fixture.userId,
    sourceVersionId: sourceCandidate.versionId,
    durationSeconds: 10,
  });
  try {
    assert.equal(tenSecondDraft.version.status, 'draft');
    assert.ok(tenSecondDraft.definition.provider.durationSeconds.includes(10));
    assert.equal(evaluateShotSkillEligibility(
      { ...baseContext, durationSeconds: 10 },
      [tenSecondDraft.definition],
    )[0]?.eligible, true);
  } finally {
    await db.delete(shotSkillVersions).where(eq(shotSkillVersions.id, tenSecondDraft.version.id));
    if (!existingPrivateHero) {
      await db.delete(shotSkills).where(and(
        eq(shotSkills.id, tenSecondDraft.skill.id),
        eq(shotSkills.ownerTeamId, fixture.teamId),
      ));
    }
  }


  const rejectedName = `eligibility-rejected-${Date.now()}`;
  await assert.rejects(
    createProductionBatch({
      teamId: fixture.teamId,
      userId: fixture.userId,
      data: {
        name: rejectedName,
        catalogItemIds: [fixture.catalogItemId],
        targetPlatform: 'tiktok',
        durationSeconds: 10,
        campaignGoal: 'Eligibility rejection check',
        waveSize: 10,
        stopLossConfig: {},
      },
    }),
    /supports 10 seconds|supports 4, 5 seconds, not 10 seconds|No active Shot Skill/,
  );
  assert.deepEqual(await scopedCounts(fixture.teamId), beforePreview, 'Rejected creation must have no side effects.');

  const lastLogId = (await db.select({ id: activityLogs.id }).from(activityLogs).orderBy(desc(activityLogs.id)).limit(1))[0]?.id ?? 0;
  let createdBatchId: number | null = null;
  try {
    const created = await createProductionBatch({
      teamId: fixture.teamId,
      userId: fixture.userId,
      data: {
        name: `eligibility-lock-${Date.now()}`,
        catalogItemIds: [fixture.catalogItemId],
        targetPlatform: 'tiktok',
        durationSeconds: 5,
        campaignGoal: 'Eligibility lock check',
        waveSize: 10,
        stopLossConfig: {},
        shotSkillVersionId: previewAtFive.selectedVersionId,
      },
    });
    createdBatchId = created.id;
    const lock = JSON.parse(created.skillVersionLock) as Record<string, { shotSkillVersionId: number; definitionHash: string }>;
    assert.equal(Object.values(lock)[0]?.shotSkillVersionId, previewAtFive.selectedVersionId);
    assert.match(Object.values(lock)[0]?.definitionHash ?? '', /^[a-f0-9]{64}$/);
    const visibleBindings = await listProductionBatchSkillBindingsForTeam(fixture.teamId);
    const visibleLock = visibleBindings.find((binding) => binding.productionBatchId === created.id);
    assert.equal(visibleLock?.shotSkillVersionId, previewAtFive.selectedVersionId);
    assert.match(visibleLock?.selectionReason ?? '', /Eligibility preview/);
  } finally {
    await db.transaction(async (transaction) => {
      if (createdBatchId) {
        const removedItems = await transaction.delete(productionBatchItems)
          .where(eq(productionBatchItems.productionBatchId, createdBatchId))
          .returning({ id: productionBatchItems.id });
        assert.equal(removedItems.length, 1);
        await transaction.delete(productionBatches).where(and(
          eq(productionBatches.teamId, fixture.teamId),
          eq(productionBatches.id, createdBatchId),
        ));
      }
      await transaction.delete(activityLogs).where(and(
        gt(activityLogs.id, lastLogId),
        eq(activityLogs.teamId, fixture.teamId),
        eq(activityLogs.userId, fixture.userId),
        eq(activityLogs.action, ActivityType.CREATE_PRODUCTION_BATCH),
      ));
    });
  }

  assert.deepEqual(await scopedCounts(fixture.teamId), beforePreview, 'Focused check cleanup must restore production row counts.');
  console.info('Shot Skill Eligibility checks passed.');
}

void main();
