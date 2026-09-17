import assert from 'node:assert/strict';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import {
  compileShotSkillLibraryPreview,
  diffShotSkillDefinitions,
  getShotSkillDetailForTeam,
  getShotSkillVersionHistoryForTeam,
  getShotSkillVersionMetricsForTeam,
  listShotSkillLibraryForTeam,
} from '../lib/shot-skills';
import { db } from '../lib/db/drizzle';
import { shotSkills, shotSkillVersions, teams } from '../lib/db/schema';

async function main() {
  const configuredTeamId = Number(process.env.SHOT_SKILL_TEST_TEAM_ID);
  const firstTeam = Number.isSafeInteger(configuredTeamId) && configuredTeamId > 0
    ? null
    : (await db.select({ id: teams.id }).from(teams).limit(1))[0];
  const resolvedTeamId = Number.isSafeInteger(configuredTeamId) && configuredTeamId > 0
    ? configuredTeamId
    : firstTeam?.id;
  if (resolvedTeamId === undefined || !Number.isSafeInteger(resolvedTeamId) || resolvedTeamId <= 0) {
    throw new Error('A workspace is required to verify the Shot Skill Library.');
  }
  const teamId = resolvedTeamId;
  const otherTeamPrivateVersion = (await db
    .select({ id: shotSkillVersions.id })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(isNotNull(shotSkills.ownerTeamId), ne(shotSkills.ownerTeamId, teamId)))
    .limit(1))[0];

  const library = await listShotSkillLibraryForTeam({ teamId });
  assert.deepEqual(library.map((entry) => entry.skill.stableId).sort(), [
    'product-hero',
    'product-macro-detail',
    'product-use-case',
  ]);
  assert.ok(library.every((entry) => entry.scope === 'official' && entry.version.status === 'active'));

  const hero = library.find((entry) => entry.skill.stableId === 'product-hero');
  assert.ok(hero);
  const detail = await getShotSkillDetailForTeam({ teamId, skillId: hero.skill.id });
  assert.ok(detail);
  assert.equal(detail.versions.length, 1);
  const history = await getShotSkillVersionHistoryForTeam({ teamId, skillId: hero.skill.id });
  assert.equal(history[0]?.version.id, hero.version.id);

  const inaccessibleVersionId = 2_147_483_647;
  const metrics = await getShotSkillVersionMetricsForTeam({
    teamId,
    versionIds: [
      ...library.map((entry) => entry.version.id),
      ...(otherTeamPrivateVersion ? [otherTeamPrivateVersion.id] : []),
      inaccessibleVersionId,
    ],
  });
  assert.equal(metrics.size, 3);
  assert.equal(metrics.has(inaccessibleVersionId), false);
  if (otherTeamPrivateVersion) assert.equal(metrics.has(otherTeamPrivateVersion.id), false);
  for (const metric of metrics.values()) {
    assert.equal(metric.reviewedSampleCount, metric.adoptedCount + metric.rejectedCount);
    assert.equal(metric.retrySampleCount, metric.attemptCount);
    assert.equal(
      metric.rejectionReasons.reduce((sum, reason) => sum + reason.count, 0),
      metric.rejectedCount,
    );
    assert.equal(
      metric.qaPassRate,
      metric.qaSampleCount === 0 ? null : metric.qaPassedCount / metric.qaSampleCount,
    );
    assert.equal(
      metric.adoptionRate,
      metric.reviewedSampleCount === 0 ? null : metric.adoptedCount / metric.reviewedSampleCount,
    );
    assert.equal(
      metric.retryRate,
      metric.retrySampleCount === 0 ? null : metric.retryCount / metric.retrySampleCount,
    );
    assert.equal(metric.averageUsableCostCny === null, metric.usableCostSampleCount === 0);
    for (const category of metric.productCategories) {
      assert.ok(category.productCategory.length > 0);
      assert.equal(category.reviewedSampleCount, category.adoptedCount + category.rejectedCount);
      assert.equal(category.retrySampleCount, category.attemptCount);
      assert.equal(category.averageUsableCostCny === null, category.usableCostSampleCount === 0);
    }
  }
  assert.equal(metrics.get(hero.version.id)?.qaPassRate, null);
  assert.equal(metrics.get(hero.version.id)?.reviewedSampleCount, 0);
  assert.equal(metrics.get(hero.version.id)?.retrySampleCount, 0);
  assert.equal(metrics.get(hero.version.id)?.usableCostSampleCount, 0);
  assert.deepEqual(metrics.get(hero.version.id)?.rejectionReasons, []);

  const emptyCategoryMetrics = await getShotSkillVersionMetricsForTeam({
    teamId,
    versionIds: [hero.version.id, inaccessibleVersionId],
    productCategory: '__no_such_product_category__',
  });
  assert.equal(emptyCategoryMetrics.size, 1);
  assert.equal(emptyCategoryMetrics.has(inaccessibleVersionId), false);
  assert.equal(emptyCategoryMetrics.get(hero.version.id)?.productCategory, '__no_such_product_category__');
  assert.equal(emptyCategoryMetrics.get(hero.version.id)?.attemptCount, 0);
  assert.equal(emptyCategoryMetrics.get(hero.version.id)?.reviewedSampleCount, 0);
  assert.equal(emptyCategoryMetrics.get(hero.version.id)?.qaPassRate, null);
  assert.equal(emptyCategoryMetrics.get(hero.version.id)?.adoptionRate, null);
  assert.equal(emptyCategoryMetrics.get(hero.version.id)?.retryRate, null);
  assert.equal(emptyCategoryMetrics.get(hero.version.id)?.averageUsableCostCny, null);
  assert.deepEqual(emptyCategoryMetrics.get(hero.version.id)?.productCategories, []);

  const preview = compileShotSkillLibraryPreview(hero.definition);
  assert.equal(preview.skill.id, 'product-hero');
  assert.match(preview.prompt, /Goal:/);
  assert.deepEqual(diffShotSkillDefinitions(hero.definition, hero.definition), []);

  const detailOnly = await listShotSkillLibraryForTeam({ teamId, filters: { requiresDetailImages: true } });
  assert.deepEqual(detailOnly.map((entry) => entry.skill.stableId), ['product-macro-detail']);
  console.info('Shot Skill Library checks passed.');
}

void main();
