import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { ActivityType, activityLogs, assets, campaigns, catalogItems, creativeSpecVersions, productionBatchItems, reviews, videoJobs } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { createPresignedDownload } from '@/lib/storage/cos';
import { isQualityReportEligibleForAdoptedExport, parseFrozenRecipeSnapshot, parseRecordedQualityReport } from '@/lib/quality/gates';

function escape(value: string): string { return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const batchId = Number((await context.params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return NextResponse.json({ error: { code: 'PRODUCTION_BATCH_ID_INVALID', path: 'batchId', message: 'Invalid Production Batch.' } }, { status: 400 });
  const rows = await db.select({ item: productionBatchItems, catalogItem: catalogItems, campaign: campaigns, spec: creativeSpecVersions, job: videoJobs, output: assets, review: reviews }).from(productionBatchItems).innerJoin(catalogItems, eq(productionBatchItems.catalogItemId, catalogItems.id)).innerJoin(campaigns, eq(productionBatchItems.campaignId, campaigns.id)).innerJoin(creativeSpecVersions, eq(productionBatchItems.creativeSpecVersionId, creativeSpecVersions.id)).innerJoin(videoJobs, eq(videoJobs.campaignId, campaigns.id)).innerJoin(assets, eq(videoJobs.outputAssetId, assets.id)).innerJoin(reviews, eq(reviews.videoJobId, videoJobs.id)).where(and(eq(productionBatchItems.teamId, workspace.team.id), eq(productionBatchItems.productionBatchId, batchId), eq(reviews.teamId, workspace.team.id), eq(reviews.decision, 'adopted'))).orderBy(asc(productionBatchItems.id));
  const lines = ['sku,product_name,campaign,spec_version,approved_claims,review_decision,review_reason,reviewed_at,result_url'];
  for (const row of rows) {
    const recipe = parseFrozenRecipeSnapshot(row.job.recipeSnapshot, {
      skillId: row.job.shotSkillId,
      skillVersion: row.job.shotSkillVersion,
      skillHash: row.job.shotSkillHash,
    });
    const expected = recipe ? {
      observationHash: row.job.qualityObservationHash,
      skillId: row.job.shotSkillId,
      skillVersion: row.job.shotSkillVersion,
      skillHash: row.job.shotSkillHash,
      recipeHash: recipe.recipeHash,
      qualityChecks: recipe.qualityChecks,
    } : null;
    const jobQuality = expected ? parseRecordedQualityReport(parseJson(row.job.qualityReport), expected) : null;
    const reviewQuality = expected ? parseRecordedQualityReport(parseJson(row.review.qualityReport), expected) : null;
    if (!isQualityReportEligibleForAdoptedExport(jobQuality, reviewQuality)) {
      return NextResponse.json({
        error: {
          code: 'ADOPTED_VIDEO_QA_INVALID',
          path: `videoJobs.${row.job.id}.qualityReport`,
          message: 'Adopted export requires an unchanged valid unified and Shot Skill QA pass.',
        },
      }, { status: 409 });
    }
    const resultUrl = createPresignedDownload({ teamId: workspace.team.id, objectKey: row.output.objectKey }).url;
    lines.push([row.catalogItem.externalSku, row.catalogItem.productName, row.campaign.name, row.spec.version, row.catalogItem.approvedClaims, row.review.decision, row.review.reason ?? '', row.review.createdAt.toISOString(), resultUrl].map((value) => escape(String(value))).join(','));
  }
  await db.insert(activityLogs).values({ teamId: workspace.team.id, userId: workspace.user.id, action: ActivityType.EXPORT_ADOPTED_VIDEO });
  return new NextResponse(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="production-batch-${batchId}-adopted.csv"`, 'Cache-Control': 'private, no-store' } });
}
