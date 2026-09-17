import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  assets,
  brandKits,
  campaigns,
  catalogItemAssets,
  catalogItems,
  creativeSpecVersions,
  productionBatchItems,
  productionBatches,
  reviews,
  videoJobs,
} from '@/lib/db/schema';
import { listProductionBatchSkillBindingsForTeam } from '@/lib/shot-skills/queries';
import { getProductionBatchProgress } from './actions';
import { getSingleReviewRemediation, isReviewRejectionCause } from '@/lib/reviews/remediation';

export type GuidedBatchBlocker = {
  code: string;
  message: string;
  href: string | null;
  label: string | null;
};

export async function getGuidedProductionBatchDetailForTeam(teamId: number, batchId: number) {
  const batch = (await db.select().from(productionBatches).where(and(
    eq(productionBatches.teamId, teamId),
    eq(productionBatches.id, batchId),
  )).limit(1))[0];
  if (!batch) return null;
  if (batch.sourceMode === 'uploaded_images') return getUploadedImageBatchDetailForTeam(teamId, batchId, batch);

  const rows = await db.select({
    item: productionBatchItems,
    catalogItem: catalogItems,
    brandKitName: brandKits.name,
    campaign: campaigns,
    boundSpec: creativeSpecVersions,
  })
    .from(productionBatchItems)
    .innerJoin(catalogItems, and(
      eq(catalogItems.id, productionBatchItems.catalogItemId),
      eq(catalogItems.teamId, teamId),
    ))
    .innerJoin(brandKits, and(
      eq(brandKits.id, catalogItems.brandKitId),
      eq(brandKits.teamId, teamId),
    ))
    .leftJoin(campaigns, and(
      eq(campaigns.id, productionBatchItems.campaignId),
      eq(campaigns.teamId, teamId),
    ))
    .leftJoin(creativeSpecVersions, and(
      eq(creativeSpecVersions.id, productionBatchItems.creativeSpecVersionId),
      eq(creativeSpecVersions.teamId, teamId),
    ))
    .where(and(
      eq(productionBatchItems.teamId, teamId),
      eq(productionBatchItems.productionBatchId, batchId),
    ))
    .orderBy(asc(productionBatchItems.id));
  const catalogItemIds = rows.map((row) => row.catalogItem.id);
  const campaignIds = rows.map((row) => row.item.campaignId).filter((id): id is number => id !== null);
  const [assetBindings, campaignSpecs, jobs, skillBindings, progress] = await Promise.all([
    catalogItemIds.length
      ? db.select({ catalogItemId: catalogItemAssets.catalogItemId, purpose: catalogItemAssets.purpose })
        .from(catalogItemAssets)
        .where(and(eq(catalogItemAssets.teamId, teamId), inArray(catalogItemAssets.catalogItemId, catalogItemIds)))
      : [],
    campaignIds.length
      ? db.select().from(creativeSpecVersions).where(and(
        eq(creativeSpecVersions.teamId, teamId),
        inArray(creativeSpecVersions.campaignId, campaignIds),
      )).orderBy(asc(creativeSpecVersions.createdAt))
      : [],
    campaignIds.length
      ? db.select().from(videoJobs).where(and(
        eq(videoJobs.teamId, teamId),
        inArray(videoJobs.campaignId, campaignIds),
      )).orderBy(asc(videoJobs.createdAt))
      : [],
    listProductionBatchSkillBindingsForTeam(teamId),
    getProductionBatchProgress(teamId, batchId),
  ]);
  const jobIds = jobs.map((job) => job.id);
  const jobReviews = jobIds.length
    ? await db.select().from(reviews).where(and(
      eq(reviews.teamId, teamId),
      inArray(reviews.videoJobId, jobIds),
    )).orderBy(asc(reviews.createdAt))
    : [];
  const latestSpecByCampaign = new Map<number, typeof campaignSpecs[number]>();
  for (const spec of campaignSpecs) latestSpecByCampaign.set(spec.campaignId, spec);
  const assetCounts = new Map<number, { primary: number; detail: number }>();
  for (const binding of assetBindings) {
    const current = assetCounts.get(binding.catalogItemId) ?? { primary: 0, detail: 0 };
    if (binding.purpose === 'primary') current.primary += 1;
    if (binding.purpose === 'detail') current.detail += 1;
    assetCounts.set(binding.catalogItemId, current);
  }
  const reviewByJobId = new Map(jobReviews.map((review) => [review.videoJobId, review]));
  const jobsByCampaign = new Map<number, typeof jobs>();
  for (const job of jobs) {
    if (job.campaignId === null) continue;
    jobsByCampaign.set(job.campaignId, [...(jobsByCampaign.get(job.campaignId) ?? []), job]);
  }
  const detailItems = rows.map((row) => {
    const latestSpec = row.item.campaignId ? latestSpecByCampaign.get(row.item.campaignId) : undefined;
    const itemJobs = row.item.campaignId ? jobsByCampaign.get(row.item.campaignId) ?? [] : [];
    const latestJob = itemJobs.at(-1);
    const materialCounts = assetCounts.get(row.catalogItem.id) ?? { primary: 0, detail: 0 };
    return {
      item: row.item,
      catalogItem: {
        id: row.catalogItem.id,
        externalSku: row.catalogItem.externalSku,
        productName: row.catalogItem.productName,
        readinessStatus: row.catalogItem.readinessStatus,
        primaryAssetId: row.catalogItem.primaryAssetId,
        brandKitId: row.catalogItem.brandKitId,
        brandKitName: row.brandKitName,
        detailImageCount: materialCounts.detail,
      },
      campaign: row.campaign,
      boundSpec: row.boundSpec,
      latestSpec: latestSpec ?? null,
      latestJob: latestJob ?? null,
      latestReview: latestJob ? reviewByJobId.get(latestJob.id) ?? null : null,
    };
  });
  const blockers: GuidedBatchBlocker[] = [];
  for (const row of detailItems) {
    if (row.catalogItem.readinessStatus !== 'ready' || !row.catalogItem.primaryAssetId) {
      blockers.push({
        code: 'sku_not_ready',
        message: `${row.catalogItem.externalSku} needs complete product information and a verified primary image.`,
        href: `/dashboard/catalog/${row.catalogItem.id}#edit-product`,
        label: 'Fix product',
      });
    }
    if (row.latestSpec && row.latestSpec.status !== 'approved' && !row.boundSpec) {
      blockers.push({
        code: 'spec_not_approved',
        message: `${row.catalogItem.externalSku} Creative Spec v${row.latestSpec.version} is ${row.latestSpec.status.replaceAll('_', ' ')}.`,
        href: `/dashboard/specs#spec-${row.latestSpec.id}`,
        label: 'Review Creative Spec',
      });
    }
    if (row.latestJob?.status === 'failed') {
      blockers.push({
        code: 'generation_failed',
        message: `${row.catalogItem.externalSku} generation failed${row.latestJob.failureReason ? `: ${row.latestJob.failureReason}` : '.'}`,
        href: '/dashboard/jobs',
        label: 'Open Video jobs',
      });
    }
    if (
      batch.generationMode === 'single'
      && row.latestReview?.decision === 'not_adopted'
      && isReviewRejectionCause(row.latestReview.qualityFailureCause)
      && row.item.campaignId
      && row.item.creativeSpecVersionId
    ) {
      blockers.push(getSingleReviewRemediation({
        cause: row.latestReview.qualityFailureCause,
        batchId,
        catalogItemId: row.catalogItem.id,
        campaignId: row.item.campaignId,
        specVersionId: row.item.creativeSpecVersionId,
      }));
    }
  }
  const batchSkillBindings = skillBindings.filter((binding) => binding.productionBatchId === batchId);
  if (batchSkillBindings.length === 0) {
    blockers.push({ code: 'skill_missing', message: 'No frozen Shot Skill version is available for this task.', href: '/dashboard/skills', label: 'Open Shot Skills' });
  }

  const timeline: Array<{ at: Date; type: string; label: string; detail: string }> = [{
    at: batch.createdAt,
    type: 'task_created',
    label: 'Task created',
    detail: `${batch.generationMode === 'single' ? 'Single video' : 'Batch production'} with ${rows.length} SKU.`,
  }];
  for (const row of rows) {
    if (row.campaign) timeline.push({ at: row.campaign.createdAt, type: 'campaign_created', label: 'Campaign created', detail: `${row.catalogItem.externalSku} · ${row.campaign.name}` });
  }
  for (const spec of campaignSpecs) {
    timeline.push({ at: spec.createdAt, type: 'spec_created', label: 'Creative Spec created', detail: `Campaign #${spec.campaignId} · v${spec.version}` });
    if (spec.approvedAt) timeline.push({ at: spec.approvedAt, type: 'spec_approved', label: 'Creative Spec approved', detail: `Spec #${spec.id} bound to its BatchItem.` });
  }
  if (batch.costConfirmedAt) timeline.push({ at: batch.costConfirmedAt, type: 'cost_confirmed', label: 'Cost confirmed', detail: `Maximum estimated cost ¥${batch.maxEstimatedCostCny ?? '—'}.` });
  for (const job of jobs) {
    timeline.push({ at: job.createdAt, type: 'job_queued', label: 'Video job queued', detail: `Job #${job.id} · Campaign #${job.campaignId}.` });
    if (job.completedAt) timeline.push({ at: job.completedAt, type: 'job_completed', label: `Video job ${job.status}`, detail: `Job #${job.id}${job.actualCostCny ? ` · ¥${job.actualCostCny}` : ''}.` });
  }
  for (const review of jobReviews) timeline.push({ at: review.createdAt, type: 'review_recorded', label: 'Review recorded', detail: `Job #${review.videoJobId} · ${review.decision}.` });
  timeline.sort((left, right) => left.at.getTime() - right.at.getTime());

  return {
    batch,
    items: detailItems,
    progress,
    skillBindings: batchSkillBindings,
    blockers,
    timeline,
    diagnostics: {
      batchId,
      itemIds: detailItems.map((row) => row.item.id),
      catalogItemIds,
      campaignIds,
      specVersionIds: [...new Set(campaignSpecs.map((spec) => spec.id))],
      shotSkillVersionIds: [...new Set(batchSkillBindings.map((binding) => binding.shotSkillVersionId))],
      videoJobIds: jobs.map((job) => job.id),
    },
  };
}

async function getUploadedImageBatchDetailForTeam(teamId: number, batchId: number, batch: typeof productionBatches.$inferSelect) {
  const rows = await db.select({ item: productionBatchItems, inputAsset: assets })
    .from(productionBatchItems)
    .leftJoin(assets, and(
      eq(assets.id, productionBatchItems.inputAssetId),
      eq(assets.teamId, teamId),
    ))
    .where(and(
      eq(productionBatchItems.teamId, teamId),
      eq(productionBatchItems.productionBatchId, batchId),
    ))
    .orderBy(asc(productionBatchItems.sequence), asc(productionBatchItems.id));
  const itemIds = rows.map((row) => row.item.id);
  const jobs = itemIds.length ? await db.select().from(videoJobs).where(and(
    eq(videoJobs.teamId, teamId),
    inArray(videoJobs.productionBatchItemId, itemIds),
  )).orderBy(asc(videoJobs.createdAt)) : [];
  const jobReviews = jobs.length ? await db.select().from(reviews).where(and(
    eq(reviews.teamId, teamId),
    inArray(reviews.videoJobId, jobs.map((job) => job.id)),
  )).orderBy(asc(reviews.createdAt)) : [];
  const jobsByItem = new Map<number, typeof jobs>();
  for (const job of jobs) {
    if (job.productionBatchItemId === null) continue;
    jobsByItem.set(job.productionBatchItemId, [...(jobsByItem.get(job.productionBatchItemId) ?? []), job]);
  }
  const reviewByJob = new Map(jobReviews.map((review) => [review.videoJobId, review]));
  const items = rows.map((row) => {
    const latestJob = jobsByItem.get(row.item.id)?.at(-1) ?? null;
    return {
      item: row.item,
      catalogItem: {
        id: row.inputAsset?.id ?? 0,
        externalSku: `IMAGE-${row.item.sequence}`,
        productName: row.inputAsset?.fileName ?? `Image ${row.item.sequence}`,
        readinessStatus: row.inputAsset ? 'ready' : 'needs_input',
        primaryAssetId: row.inputAsset?.id ?? null,
        brandKitId: null,
        brandKitName: 'Image input',
        detailImageCount: 0,
      },
      campaign: null,
      boundSpec: null,
      latestSpec: null,
      latestJob,
      latestReview: latestJob ? reviewByJob.get(latestJob.id) ?? null : null,
    };
  });
  const blockers: GuidedBatchBlocker[] = rows.filter((row) => !row.inputAsset).map((row) => ({
    code: 'image_asset_missing',
    message: `Image ${row.item.sequence} has not finished archiving.`,
    href: null,
    label: null,
  }));
  const progress = await getProductionBatchProgress(teamId, batchId);
  const timeline: Array<{ at: Date; type: string; label: string; detail: string }> = [{
    at: batch.createdAt,
    type: 'task_created',
    label: 'Image-to-Video Batch created',
    detail: `${rows.length} uploaded image item${rows.length === 1 ? '' : 's'}.`,
  }];
  for (const job of jobs) {
    timeline.push({ at: job.createdAt, type: 'job_queued', label: 'Video job queued', detail: `Job #${job.id} · Image item.` });
    if (job.completedAt) timeline.push({ at: job.completedAt, type: 'job_completed', label: `Video job ${job.status}`, detail: `Job #${job.id}${job.actualCostCny ? ` · ¥${job.actualCostCny}` : ''}.` });
  }
  for (const review of jobReviews) timeline.push({ at: review.createdAt, type: 'review_recorded', label: 'Review recorded', detail: `Job #${review.videoJobId} · ${review.decision}.` });
  timeline.sort((left, right) => left.at.getTime() - right.at.getTime());
  return {
    batch,
    items,
    progress,
    skillBindings: [],
    blockers,
    timeline,
    diagnostics: {
      batchId,
      itemIds,
      catalogItemIds: [],
      campaignIds: [],
      specVersionIds: [],
      shotSkillVersionIds: [],
      videoJobIds: jobs.map((job) => job.id),
    },
  };
}
export type GuidedProductionBatchDetail = NonNullable<Awaited<ReturnType<typeof getGuidedProductionBatchDetailForTeam>>>;
