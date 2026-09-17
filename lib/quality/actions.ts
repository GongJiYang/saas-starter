import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { assertContractTransition, getWaveStopReasons } from '@/lib/bulk/contracts';
import { enqueueVideoSubmission } from '@/lib/queue/video-generation';
import { ActivityType, activityLogs, catalogItems, productionBatchItems, productionBatches, reviews, shotSkillValidationEvidence, videoJobs } from '@/lib/db/schema';
import { evaluateQualityGate, parseRecordedQualityReport, qualityGateInputSchema, qualityReportSchema, recordedQualityReportSchema, skillQualityReportSchema, type QualityGateInput, type QualityReport } from './gates';
import { compiledShotRecipeSchema, evaluateShotSkillQuality, hashStable, stableStringify, type CompiledShotRecipe } from '@/lib/shot-skills';
import { getShotSkillQualityCheckContract } from '@/lib/shot-skills/quality';

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseReport(value: string): QualityReport | null {
  const parsed = qualityReportSchema.safeParse(parseRecord(value));
  return parsed.success ? parsed.data : null;
}

function parseResultSummaryQuality(value: string): QualityReport | null {
  const parsed = qualityReportSchema.safeParse(parseRecord(value).quality);
  return parsed.success ? parsed.data : null;
}

export type QualitySubmissionIssue = {
  code: string;
  path: string;
  message: string;
};

export class QualitySubmissionError extends Error {
  constructor(readonly issue: QualitySubmissionIssue) {
    super(issue.message);
    this.name = 'QualitySubmissionError';
  }
}

function failQualitySubmission(code: string, path: string, message: string): never {
  throw new QualitySubmissionError({ code, path, message });
}

export function getQualitySubmissionIssue(error: unknown): QualitySubmissionIssue | null {
  return error instanceof QualitySubmissionError ? error.issue : null;
}

function parseFrozenRecipe(
  job: {
    recipeSnapshot: string | null;
    shotSkillId: string | null;
    shotSkillVersion: string | null;
    shotSkillHash: string | null;
    shotSkillVersionId: number | null;
  },
) {
  if (!job.recipeSnapshot) {
    failQualitySubmission('FROZEN_RECIPE_REQUIRED', 'recipeSnapshot', 'VideoJob is missing its frozen Skill recipe.');
  }
  let rawRecipe: unknown;
  try {
    rawRecipe = JSON.parse(job.recipeSnapshot);
  } catch {
    failQualitySubmission('FROZEN_RECIPE_INVALID', 'recipeSnapshot', 'Frozen Skill recipe is not valid JSON.');
  }
  const parsed = compiledShotRecipeSchema.safeParse(rawRecipe);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    failQualitySubmission(
      'FROZEN_RECIPE_INVALID',
      ['recipeSnapshot', ...(issue?.path ?? [])].join('.'),
      issue?.message ?? 'Frozen Skill recipe is invalid.',
    );
  }
  const recipe = parsed.data;
  if (
    !job.shotSkillVersionId
    || recipe.skill.id !== job.shotSkillId
    || recipe.skill.version !== job.shotSkillVersion
    || recipe.skill.hash !== job.shotSkillHash
  ) {
    failQualitySubmission('FROZEN_RECIPE_IDENTITY_MISMATCH', 'recipeSnapshot.skill', 'Frozen Skill recipe does not match the VideoJob Skill identity.');
  }
  const computedRecipeHash = hashStable({
    skillHash: recipe.skill.hash,
    providerNeutralRecipe: recipe.providerNeutralRecipe,
    prompt: recipe.prompt,
    compilationTrace: recipe.compilationTrace,
  });
  if (computedRecipeHash !== recipe.recipeHash) {
    failQualitySubmission('FROZEN_RECIPE_HASH_MISMATCH', 'recipeSnapshot.recipeHash', 'Frozen Skill recipe hash does not match its contents.');
  }
  const checkCodes = recipe.qualityChecks.map((check) => check.code);
  if (new Set(checkCodes).size !== checkCodes.length) {
    failQualitySubmission('FROZEN_RECIPE_DUPLICATE_CHECK', 'recipeSnapshot.qualityChecks', 'Frozen Skill recipe contains duplicate quality checks.');
  }
  for (let index = 0; index < recipe.qualityChecks.length; index += 1) {
    const check = recipe.qualityChecks[index]!;
    if (!getShotSkillQualityCheckContract(check.code)) {
      failQualitySubmission('FROZEN_RECIPE_UNSUPPORTED_CHECK', `recipeSnapshot.qualityChecks.${index}.code`, `Unsupported frozen Skill quality check: ${check.code}.`);
    }
  }
  return recipe;
}

function parseQualityObservation(observation: unknown): QualityGateInput {
  const parsed = qualityGateInputSchema.safeParse(observation);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  failQualitySubmission(
    'QUALITY_OBSERVATION_INVALID',
    ['observation', ...(issue?.path ?? [])].join('.'),
    issue?.message ?? 'Quality observation is invalid.',
  );
}

function evaluateFrozenSkillContract(
  recipe: CompiledShotRecipe,
  observation: QualityGateInput,
) {
  const skill = evaluateShotSkillQuality(recipe.qualityChecks, {
    productCount: {
      value: observation.fidelity.productCount,
      evidence: [`fidelity.productCount=${observation.fidelity.productCount}`],
    },
    productShapePreserved: {
      value: observation.fidelity.productShapePreserved,
      evidence: [`fidelity.productShapePreserved=${observation.fidelity.productShapePreserved}`],
    },
    productVisibleAtEnd: {
      value: observation.fidelity.endFrame.productVisible,
      evidence: observation.fidelity.endFrame.evidence,
    },
    productDetailSupported: {
      value: observation.fidelity.productDetail.supported,
      evidence: observation.fidelity.productDetail.evidence,
    },
    sceneAuthorized: {
      value: observation.spec.scene.authorized,
      evidence: observation.spec.scene.evidence,
    },
    skillTimelineFollowed: {
      value: observation.spec.timeline.followed,
      evidence: observation.spec.timeline.evidence,
    },
  });
  return {
    skill: {
      skillId: recipe.skill.id,
      skillVersion: recipe.skill.version,
      skillHash: recipe.skill.hash,
      recipeHash: recipe.recipeHash,
      ...skill,
    },
    failures: skill.checks
      .filter((check) => check.severity === 'blocking' && !check.passed)
      .map((check) => ({
        code: `skill:${check.code}`,
        cause: check.failureCause,
        remediationCategory: check.remediationCategory,
        detail: getShotSkillQualityCheckContract(check.code)!.userMessage,
      })),
  };
}

async function evaluateBatchStopLoss(teamId: number, batchId: number, waveNumber: number) {
  const batch = (await db.select().from(productionBatches).where(and(eq(productionBatches.id, batchId), eq(productionBatches.teamId, teamId))).limit(1))[0];
  if (!batch) return { reasons: [], paused: false };
  if (batch.generationMode === 'single') return { reasons: [], paused: false };
  const rows = await db.select({ item: productionBatchItems, catalogItem: catalogItems }).from(productionBatchItems).innerJoin(catalogItems, eq(productionBatchItems.catalogItemId, catalogItems.id)).where(and(eq(productionBatchItems.teamId, teamId), eq(productionBatchItems.productionBatchId, batchId), eq(productionBatchItems.waveNumber, waveNumber)));
  const campaignIds = rows.map((row) => row.item.campaignId).filter((id): id is number => id !== null);
  const jobs = campaignIds.length === 0 ? [] : await db.select().from(videoJobs).where(and(eq(videoJobs.teamId, teamId), inArray(videoJobs.campaignId, campaignIds)));
  const latestByCampaign = new Map<number, (typeof jobs)[number]>();
  for (const job of jobs) {
    if (job.campaignId === null) continue;
    const current = latestByCampaign.get(job.campaignId);
    if (!current || current.createdAt < job.createdAt) latestByCampaign.set(job.campaignId, job);
  }
  const effectiveJobs = [...latestByCampaign.values()];
  const fidelityCounts = new Map<string, number>();
  const skillBlockingFailures: Array<{ shotSkillVersionId: number; failureCodes: string[] }> = [];
  for (const row of rows) {
    const report = parseResultSummaryQuality(row.item.resultSummary);
    if (report?.primaryCause === 'fidelity') {
      fidelityCounts.set(row.catalogItem.externalSku, (fidelityCounts.get(row.catalogItem.externalSku) ?? 0) + 1);
    }
    const job = row.item.campaignId ? latestByCampaign.get(row.item.campaignId) : null;
    const skill = report ? skillQualityReportSchema.safeParse(report.skill) : null;
    if (job?.shotSkillVersionId && skill?.success && skill.data.blockingFailures.length > 0) {
      skillBlockingFailures.push({
        shotSkillVersionId: job.shotSkillVersionId,
        failureCodes: skill.data.blockingFailures,
      });
    }
  }
  const waveJobIds = new Set(effectiveJobs.map((job) => job.id));
  const waveReviews = waveJobIds.size === 0 ? [] : await db.select({ rejectionCause: reviews.qualityFailureCause }).from(reviews).where(and(eq(reviews.teamId, teamId), inArray(reviews.videoJobId, [...waveJobIds])));
  const reviewedResults = waveReviews.filter((review) => review.rejectionCause).map((review, index) => ({ sku: `review-${index + 1}`, rejectionCause: review.rejectionCause! }));
  const actualCosts = effectiveJobs.map((job) => Number(job.actualCostCny ?? 0));
  const averageCostCny = actualCosts.length > 0 ? actualCosts.reduce((sum, value) => sum + value, 0) / actualCosts.length : 0;
  const confirmedAverageCostCny = Number(batch.maxEstimatedCostCny ?? 0) / Math.max(1, rows.length);
  const supplierErrors = effectiveJobs.filter((job) => job.failureCode === 'technical' || job.failureCode === 'supplier_error').length;
  const observation = {
    waveSize: batch.waveSize,
    productFidelityFailures: [...fidelityCounts.entries()].map(([sku, value]) => ({ sku, count: value })),
    skillBlockingFailures,
    reviewedResults,
    supplierErrorRate: effectiveJobs.length === 0 ? 0 : supplierErrors / effectiveJobs.length,
    averageCostCny,
    confirmedAverageCostCny,
  };
  const reasons = getWaveStopReasons(observation);
  if (reasons.length > 0 && batch.status !== 'paused') {
    assertContractTransition('production_batch', batch.status, 'paused');
    const config = { ...parseRecord(batch.stopLossConfig), lastQualityObservation: observation, lastStopReasons: reasons };
    await db.update(productionBatches).set({
      status: 'paused',
      pausedFromStatus: batch.status,
      pausedReason: reasons.join('; '),
      stopLossConfig: JSON.stringify(config),
      updatedAt: new Date(),
    }).where(eq(productionBatches.id, batch.id));
  }
  return { reasons, paused: reasons.length > 0, observation };
}

export async function recordVideoQualityReport(input: { teamId: number; userId: number; videoJobId: number; observation: unknown }) {
  const current = await db.select().from(videoJobs).where(and(eq(videoJobs.id, input.videoJobId), eq(videoJobs.teamId, input.teamId))).limit(1);
  const job = current[0];
  if (!job) failQualitySubmission('VIDEO_JOB_NOT_FOUND', 'videoJobId', 'VideoJob not found.');
  if (job.status !== 'succeeded') {
    failQualitySubmission('VIDEO_JOB_NOT_READY', 'videoJobId', 'Only completed VideoJobs can enter the quality gate.');
  }
  if (job.campaignId === null) throw new Error('Uploaded image quality reports use BatchItem context and are not enabled in the SKU quality path yet.');

  const observation = parseQualityObservation(input.observation);
  const observationHash = hashStable(observation);
  const recipe = parseFrozenRecipe(job);
  const expectedReportIdentity = {
    observationHash,
    skillId: job.shotSkillId,
    skillVersion: job.shotSkillVersion,
    skillHash: job.shotSkillHash,
    recipeHash: recipe.recipeHash,
    qualityChecks: recipe.qualityChecks,
  };

  if (job.qualityObservationHash) {
    if (job.qualityObservationHash !== observationHash) {
      failQualitySubmission('QUALITY_OBSERVATION_CONFLICT', 'observation', 'VideoJob already has a different immutable quality observation.');
    }
    const existing = parseRecordedQualityReport(parseRecord(job.qualityReport), expectedReportIdentity);
    if (!existing) {
      failQualitySubmission('QUALITY_REPORT_INVALID', 'qualityReport', 'Persisted quality report is invalid or does not match the frozen observation.');
    }
    return { report: existing, stopLoss: null, idempotent: true };
  }
  if (Object.keys(parseRecord(job.qualityReport)).length > 0) {
    failQualitySubmission('QUALITY_REPORT_ALREADY_RECORDED', 'qualityReport', 'A legacy quality report already exists and cannot be replaced.');
  }

  const baseReport = evaluateQualityGate(observation);
  const frozenSkill = evaluateFrozenSkillContract(recipe, observation);
  const failures = [...baseReport.failures, ...frozenSkill.failures];
  const technicalPassed = failures.every((failure) => failure.cause !== 'technical');
  const fidelityPassed = failures.every((failure) => failure.cause !== 'fidelity');
  const specPassed = failures.every((failure) => failure.cause !== 'spec_mismatch');
  const report = recordedQualityReportSchema.parse({
    ...baseReport,
    passed: technicalPassed && fidelityPassed && specPassed && frozenSkill.skill.passed,
    technicalPassed,
    fidelityPassed,
    specPassed,
    failures,
    primaryCause: failures[0]?.cause ?? null,
    observations: observation,
    observationHash,
    skill: frozenSkill.skill,
  });
  const item = await db.select().from(productionBatchItems).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.campaignId, job.campaignId))).limit(1);
  const persisted = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(videoJobs)
      .set({
        qualityReport: JSON.stringify(report),
        qualityObservationHash: observationHash,
        actualCostCny: report.actualCostCny.toFixed(2),
        failureCode: report.passed ? null : report.primaryCause,
        failureReason: report.passed ? null : JSON.stringify(report.failures),
        updatedAt: new Date(),
      })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.teamId, input.teamId), isNull(videoJobs.qualityObservationHash)))
      .returning({ id: videoJobs.id });

    if (!claimed[0]) {
      const raced = (await tx.select().from(videoJobs).where(and(eq(videoJobs.id, job.id), eq(videoJobs.teamId, input.teamId))).limit(1))[0];
      if (!raced || raced.qualityObservationHash !== observationHash) {
        failQualitySubmission('QUALITY_OBSERVATION_CONFLICT', 'observation', 'VideoJob already has a different immutable quality observation.');
      }
      const racedReport = parseRecordedQualityReport(parseRecord(raced.qualityReport), expectedReportIdentity);
      if (!racedReport) {
        failQualitySubmission('QUALITY_REPORT_INVALID', 'qualityReport', 'Persisted quality report is invalid or does not match the frozen observation.');
      }
      return { report: racedReport, idempotent: true };
    }

    if (item[0]) {
      const summary = { ...parseRecord(item[0].resultSummary), quality: report };
      await tx.update(productionBatchItems).set({ resultSummary: JSON.stringify(summary), status: report.passed ? 'quality_review' : 'failed', lastError: report.passed ? null : report.failures[0]?.detail, updatedAt: new Date() }).where(and(eq(productionBatchItems.id, item[0].id), eq(productionBatchItems.teamId, input.teamId)));
    }
    await tx.insert(shotSkillValidationEvidence).values({
      teamId: input.teamId,
      shotSkillVersionId: job.shotSkillVersionId!,
      videoJobId: job.id,
      evidenceType: 'quality_gate',
      passed: report.passed,
      reason: report.failures.map((failure) => failure.code).join(', ') || null,
      detail: {
        skill: report.skill,
        failures: report.failures,
        actualCostCny: report.actualCostCny,
      },
      observationHash,
      observationSnapshot: stableStringify(observation),
      evidenceSnapshot: stableStringify({
        failures: report.failures,
        skillChecks: report.skill.checks,
      }),
    });
    await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.QUALITY_GATE_RECORDED });
    return { report, idempotent: false };
  });

  if (persisted.idempotent) return { report: persisted.report, stopLoss: null, idempotent: true };
  const stopLoss = item[0] ? await evaluateBatchStopLoss(input.teamId, (await db.select({ productionBatchId: productionBatchItems.productionBatchId }).from(productionBatchItems).where(eq(productionBatchItems.id, item[0].id)).limit(1))[0]?.productionBatchId ?? 0, item[0].waveNumber) : { reasons: [], paused: false };
  return { report: persisted.report, stopLoss, idempotent: false };
}

export async function retryTechnicalQualityFailure(input: { teamId: number; userId: number; videoJobId: number }) {
  const current = await db.select().from(videoJobs).where(and(eq(videoJobs.id, input.videoJobId), eq(videoJobs.teamId, input.teamId))).limit(1);
  const original = current[0];
  if (!original) throw new Error('VideoJob not found.');
  const report = parseReport(original.qualityReport);
  if (!report || report.passed || report.primaryCause !== 'technical') throw new Error('Only technical quality failures can be automatically retried.');
  const retryRootId = original.retryOfVideoJobId ?? original.id;
  const retries = await db.select({ value: count() }).from(videoJobs).where(and(eq(videoJobs.teamId, input.teamId), eq(videoJobs.retryOfVideoJobId, retryRootId)));
  if (Number(retries[0]?.value ?? 0) >= 3) throw new Error('Technical retry limit reached.');
  if (
    !original.shotCardId
    || !original.creativeSpecVersionId
    || !original.shotSkillVersionId
    || !original.shotSkillId
    || !original.shotSkillVersion
    || !original.shotSkillHash
    || !original.recipeSnapshot
  ) {
    throw new Error('VideoJob is missing its frozen Skill recipe.');
  }
  if (original.campaignId === null) throw new Error('Uploaded image quality retries use the Image-to-Video retry path.');
  const campaignId = original.campaignId;
  const inserted = await db.transaction(async (tx) => {
    const created = await tx.insert(videoJobs).values({ teamId: input.teamId, campaignId, productionBatchItemId: original.productionBatchItemId, inputAssetId: original.inputAssetId, creativeSpecVersionId: original.creativeSpecVersionId, shotCardId: original.shotCardId, submittedBy: input.userId, provider: original.provider, shotSkillId: original.shotSkillId, shotSkillVersionId: original.shotSkillVersionId, shotSkillVersion: original.shotSkillVersion, shotSkillHash: original.shotSkillHash, recipeSnapshot: original.recipeSnapshot, retryOfVideoJobId: retryRootId, retryReason: 'technical', status: 'queued' }).returning({ id: videoJobs.id });
    if (created[0]) await tx.update(productionBatchItems).set({ status: 'queued', lastError: null, updatedAt: new Date() }).where(and(eq(productionBatchItems.teamId, input.teamId), eq(productionBatchItems.campaignId, campaignId)));
    if (created[0]) await tx.insert(activityLogs).values({ teamId: input.teamId, userId: input.userId, action: ActivityType.RETRY_VIDEO_JOB });
    return created[0];
  });
  if (!inserted) throw new Error('Retry VideoJob could not be created.');
  await enqueueVideoSubmission(inserted.id);
  return { videoJobId: inserted.id, retryOfVideoJobId: retryRootId, reason: 'technical' as const };
}
