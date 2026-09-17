import { and, desc, eq } from 'drizzle-orm';
import { db } from './drizzle';
import {
  assets,
  brandKits,
  campaigns,
  shotCards,
  shotSkillVersions,
  shotSkills,
  reviews,
  videoJobs,
} from './schema';

/**
 * Callers must derive teamId from authenticated membership, never directly
 * from untrusted client input. Every video-domain read is tenant-scoped here.
 */
export async function getBrandKitForTeam(teamId: number, brandKitId: number) {
  const result = await db
    .select()
    .from(brandKits)
    .where(and(eq(brandKits.teamId, teamId), eq(brandKits.id, brandKitId)))
    .limit(1);

  return result[0] ?? null;
}

export async function listBrandKitsForTeam(teamId: number) {
  const result = await db
    .select()
    .from(brandKits)
    .where(eq(brandKits.teamId, teamId))
    .orderBy(desc(brandKits.createdAt));

  return result;
}

export async function getAssetForTeam(teamId: number, assetId: number) {
  const result = await db
    .select()
    .from(assets)
    .where(and(eq(assets.teamId, teamId), eq(assets.id, assetId)))
    .limit(1);

  return result[0] ?? null;
}

export async function listAssetsForTeam(teamId: number) {
  const result = await db
    .select()
    .from(assets)
    .where(eq(assets.teamId, teamId))
    .orderBy(desc(assets.createdAt));

  return result;
}

export async function getCampaignForTeam(teamId: number, campaignId: number) {
  const result = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.teamId, teamId), eq(campaigns.id, campaignId)))
    .limit(1);

  return result[0] ?? null;
}

export async function getCampaignShotSkillBindingForTeam(teamId: number, campaignId: number) {
  const result = await db.select({
    skillName: shotSkills.name,
    stableId: shotSkills.stableId,
    version: shotSkillVersions.version,
    definitionHash: shotSkillVersions.definitionHash,
    selectionReason: shotCards.skillSelectionReason,
    eligibility: shotCards.skillEligibility,
  }).from(shotCards)
    .innerJoin(shotSkillVersions, eq(shotCards.shotSkillVersionId, shotSkillVersions.id))
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotCards.teamId, teamId),
      eq(shotCards.campaignId, campaignId),
      eq(shotCards.status, 'selected'),
    ))
    .limit(1);
  return result[0] ?? null;
}

export async function listCampaignsForTeam(teamId: number) {
  const result = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.teamId, teamId))
    .orderBy(desc(campaigns.createdAt));

  return result;
}


export async function getVideoJobForTeam(teamId: number, videoJobId: number) {
  const result = await db
    .select()
    .from(videoJobs)
    .where(and(eq(videoJobs.teamId, teamId), eq(videoJobs.id, videoJobId)))
    .limit(1);

  return result[0] ?? null;
}

export async function listVideoJobsForTeam(teamId: number) {
  const result = await db
    .select()
    .from(videoJobs)
    .where(eq(videoJobs.teamId, teamId))
    .orderBy(desc(videoJobs.createdAt));

  return result;
}

export async function getReviewForTeam(teamId: number, reviewId: number) {
  const result = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.teamId, teamId), eq(reviews.id, reviewId)))
    .limit(1);

  return result[0] ?? null;
}

export async function listReviewsForTeam(teamId: number) {
  const result = await db
    .select()
    .from(reviews)
    .where(eq(reviews.teamId, teamId))
    .orderBy(desc(reviews.createdAt));

  return result;
}
