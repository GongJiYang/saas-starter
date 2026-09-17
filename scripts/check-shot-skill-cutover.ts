import assert from 'node:assert/strict';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import {
  campaigns,
  creativeSpecVersions,
  shotCards,
  shotSkillVersions,
  videoJobs,
} from '../lib/db/schema';
import {
  compileApprovedSpecRecipe,
  resolveShotSkillVersionForApprovedSpec,
} from '../lib/shot-skills';
import { processVideoSubmission } from '../lib/video-jobs/worker';

async function main() {
  const contexts = await db.select({
    campaignId: campaigns.id,
    shotCardId: shotCards.id,
    specId: creativeSpecVersions.id,
    specSnapshot: creativeSpecVersions.specSnapshot,
    submittedBy: campaigns.createdBy,
    teamId: creativeSpecVersions.teamId,
  }).from(creativeSpecVersions)
    .innerJoin(campaigns, eq(creativeSpecVersions.campaignId, campaigns.id))
    .innerJoin(shotCards, eq(shotCards.campaignId, campaigns.id))
    .where(and(
      eq(creativeSpecVersions.status, 'approved'),
      eq(shotCards.status, 'selected'),
    ));
  const activeCampaigns = contexts.length === 0 ? [] : await db.select({
    campaignId: videoJobs.campaignId,
  }).from(videoJobs).where(and(
    inArray(videoJobs.campaignId, contexts.map((context) => context.campaignId)),
    sql`${videoJobs.status} IN ('queued', 'generating')`,
  ));
  const activeCampaignIds = new Set(activeCampaigns.map((row) => row.campaignId));
  const approved = contexts.find((context) => !activeCampaignIds.has(context.campaignId));
  if (!approved) throw new Error('An idle approved Campaign is required for the runtime cutover check.');

  const resolved = await resolveShotSkillVersionForApprovedSpec({
    teamId: approved.teamId,
    specSnapshot: approved.specSnapshot,
  });
  const locked = await resolveShotSkillVersionForApprovedSpec({
    teamId: approved.teamId,
    specSnapshot: approved.specSnapshot,
    lockedVersionId: resolved.version.id,
  });
  assert.equal(locked.version.id, resolved.version.id);

  const recipe = compileApprovedSpecRecipe({
    specSnapshot: approved.specSnapshot,
    shotSkillVersionId: resolved.version.id,
    skill: resolved.definition,
    selectionReason: resolved.selectionReason,
  });
  assert.equal(recipe.skill.id, resolved.skill.stableId);
  assert.equal(recipe.skill.version, resolved.version.version);
  assert.equal(recipe.skill.hash, resolved.version.definitionHash);
  assert.throws(() => compileApprovedSpecRecipe({
    specSnapshot: approved.specSnapshot,
    shotSkillVersionId: 0,
    skill: resolved.definition,
    selectionReason: resolved.selectionReason,
  }), /explicit Shot Skill version ID/);

  const mismatchedVersion = (await db.select({ id: shotSkillVersions.id })
    .from(shotSkillVersions)
    .where(and(
      eq(shotSkillVersions.status, 'active'),
      ne(shotSkillVersions.id, resolved.version.id),
    ))
    .limit(1))[0];
  if (!mismatchedVersion) throw new Error('A second active Skill version is required for the mismatch check.');

  let videoJobId: number | undefined;
  try {
    const inserted = await db.insert(videoJobs).values({
      teamId: approved.teamId,
      campaignId: approved.campaignId,
      creativeSpecVersionId: approved.specId,
      shotCardId: approved.shotCardId,
      submittedBy: approved.submittedBy,
      provider: 'minimax',
      shotSkillId: recipe.skill.id,
      shotSkillVersionId: mismatchedVersion.id,
      shotSkillVersion: recipe.skill.version,
      shotSkillHash: recipe.skill.hash,
      recipeSnapshot: JSON.stringify(recipe),
      status: 'queued',
    }).returning({ id: videoJobs.id });
    videoJobId = inserted[0]?.id;
    if (!videoJobId) throw new Error('Mismatch VideoJob fixture could not be created.');
    await assert.rejects(
      () => processVideoSubmission(videoJobId!),
      /persisted Shot Skill version does not match its frozen recipe/,
    );
  } finally {
    if (videoJobId) await db.delete(videoJobs).where(eq(videoJobs.id, videoJobId));
  }
  await assert.rejects(
    () => db.insert(videoJobs).values({
      teamId: approved.teamId,
      campaignId: approved.campaignId,
      creativeSpecVersionId: approved.specId,
      shotCardId: approved.shotCardId,
      submittedBy: approved.submittedBy,
      provider: 'minimax',
      status: 'queued',
    }),
    /video_jobs_new_recipe_complete/,
  );
  console.info(`Shot Skill runtime cutover check passed with version ${resolved.version.id}.`);
}

void main();
