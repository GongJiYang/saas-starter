import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  creativeSpecVersions,
  productionBatchItems,
  productionBatches,
  shotCards,
  reviews,
  shotSkillValidationEvidence,
  shotSkillVersions,
  shotSkills,
  videoJobs,
  type ShotSkill,
  type ShotSkillVersion,
} from '@/lib/db/schema';
import { qualityReportSchema } from '@/lib/quality/gates';
import { shotRoleSchema, shotSkillCardSchema, type ShotRole, type ShotSkillCard } from './schema';

export type ShotSkillLibraryFilters = {
  scope?: 'official' | 'workspace_private';
  status?: ShotSkillVersion['status'];
  shotRole?: ShotRole;
  requiresDetailImages?: boolean;
};

export type ShotSkillLibraryVersion = {
  skill: ShotSkill;
  version: ShotSkillVersion;
  definition: ShotSkillCard;
  scope: 'official' | 'workspace_private';
};

export type ShotSkillMetricAggregate = {
  attemptCount: number;
  qaSampleCount: number;
  qaPassedCount: number;
  reviewedSampleCount: number;
  adoptedCount: number;
  rejectedCount: number;
  retryCount: number;
  retrySampleCount: number;
  usableCostSampleCount: number;
  qaPassRate: number | null;
  adoptionRate: number | null;
  retryRate: number | null;
  averageUsableCostCny: number | null;
  rejectionReasons: Array<{ reasonCode: string; count: number }>;
  lastValidatedAt: Date | null;
};

export type ShotSkillProductCategoryMetrics = ShotSkillMetricAggregate & {
  productCategory: string;
};

export type ShotSkillVersionMetrics = ShotSkillMetricAggregate & {
  productCategory: string | null;
  productCategories: ShotSkillProductCategoryMetrics[];
};

function parseDefinition(value: unknown): ShotSkillCard {
  return shotSkillCardSchema.parse(value);
}

function isVisibleToTeam(skill: ShotSkill, teamId: number): boolean {
  return skill.ownerTeamId === null || skill.ownerTeamId === teamId;
}

function supportsShotRole(definition: ShotSkillCard, shotRole: ShotRole): boolean {
  const { all, any, none } = definition.eligibility;
  if (all.some((predicate) => predicate.field === 'shotRole' && !predicate.in.includes(shotRole))) {
    return false;
  }
  if (none.some((predicate) => predicate.field === 'shotRole' && predicate.in.includes(shotRole))) {
    return false;
  }
  return any.length === 0 || any.some(
    (predicate) => predicate.field !== 'shotRole' || predicate.in.includes(shotRole),
  );
}

export function getShotSkillSupportedRoles(definition: ShotSkillCard): ShotRole[] {
  return shotRoleSchema.options.filter((shotRole) => supportsShotRole(definition, shotRole));
}

function matchesFilters(
  entry: ShotSkillLibraryVersion,
  filters: ShotSkillLibraryFilters,
): boolean {
  if (filters.scope && entry.scope !== filters.scope) return false;
  if (filters.status && entry.version.status !== filters.status) return false;
  if (filters.shotRole && !supportsShotRole(entry.definition, filters.shotRole)) return false;
  if (filters.requiresDetailImages !== undefined) {
    const requiresDetails = entry.definition.requiredInputs.some(
      (requiredInput) => requiredInput.type === 'product_detail_image' && requiredInput.minimumCount > 0,
    );
    if (requiresDetails !== filters.requiresDetailImages) return false;
  }
  return true;
}

export async function listShotSkillLibraryForTeam(input: {
  teamId: number;
  filters?: ShotSkillLibraryFilters;
}): Promise<ShotSkillLibraryVersion[]> {
  const rows = await db
    .select({ skill: shotSkills, version: shotSkillVersions })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(or(
      and(isNull(shotSkills.ownerTeamId), eq(shotSkillVersions.status, 'active')),
      eq(shotSkills.ownerTeamId, input.teamId),
    ))
    .orderBy(desc(shotSkillVersions.updatedAt), desc(shotSkillVersions.createdAt));

  const filters = input.filters ?? {};
  return rows
    .filter((row) => isVisibleToTeam(row.skill, input.teamId))
    .map((row) => ({
      ...row,
      definition: parseDefinition(row.version.normalizedDefinition),
      scope: row.skill.ownerTeamId === null ? 'official' as const : 'workspace_private' as const,
    }))
    .filter((entry) => matchesFilters(entry, filters));
}

export async function getShotSkillDetailForTeam(input: {
  teamId: number;
  skillId: number;
}): Promise<{ skill: ShotSkill; versions: ShotSkillLibraryVersion[] } | null> {
  const skill = (await db.select().from(shotSkills).where(eq(shotSkills.id, input.skillId)).limit(1))[0];
  if (!skill || !isVisibleToTeam(skill, input.teamId)) return null;

  const versions = await db.select().from(shotSkillVersions)
    .where(eq(shotSkillVersions.shotSkillId, skill.id))
    .orderBy(desc(shotSkillVersions.createdAt));
  const visibleVersions = skill.ownerTeamId === null
    ? versions.filter((version) => version.status !== 'draft')
    : versions;

  return {
    skill,
    versions: visibleVersions.map((version) => ({
      skill,
      version,
      definition: parseDefinition(version.normalizedDefinition),
      scope: skill.ownerTeamId === null ? 'official' as const : 'workspace_private' as const,
    })),
  };
}

export async function getShotSkillVersionHistoryForTeam(input: {
  teamId: number;
  skillId: number;
}): Promise<ShotSkillLibraryVersion[]> {
  const detail = await getShotSkillDetailForTeam(input);
  return detail?.versions ?? [];
}

function parseQualityReport(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = qualityReportSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function parseProductCategory(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const brief = (parsed as Record<string, unknown>).brief;
    if (!brief || typeof brief !== 'object') return null;
    const category = (brief as Record<string, unknown>).category;
    return typeof category === 'string' && category.trim() ? category.trim() : null;
  } catch {
    return null;
  }
}

function parseRejectionCause(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const cause = (value as Record<string, unknown>).rejectionCause;
  return typeof cause === 'string' && cause.trim() ? cause.trim() : null;
}

function parseEvidenceCost(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const cost = (value as Record<string, unknown>).actualCostCny;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

type MetricAccumulator = {
  metric: ShotSkillMetricAggregate;
  usableCosts: number[];
  rejectionReasonCounts: Map<string, number>;
};

function emptyMetricAccumulator(): MetricAccumulator {
  return {
    metric: {
      attemptCount: 0,
      qaSampleCount: 0,
      qaPassedCount: 0,
      reviewedSampleCount: 0,
      adoptedCount: 0,
      rejectedCount: 0,
      retryCount: 0,
      retrySampleCount: 0,
      usableCostSampleCount: 0,
      qaPassRate: null,
      adoptionRate: null,
      retryRate: null,
      averageUsableCostCny: null,
      rejectionReasons: [],
      lastValidatedAt: null,
    },
    usableCosts: [],
    rejectionReasonCounts: new Map(),
  };
}

function addMetricSample(
  accumulator: MetricAccumulator,
  sample: {
    isRetry: boolean;
    qaPassed: boolean | null;
    validatedAt: Date | null;
    reviewDecision: 'adopted' | 'not_adopted' | null;
    rejectionCause: string | null;
    usableCostCny: number | null;
  },
): void {
  const { metric } = accumulator;
  metric.attemptCount += 1;
  metric.retrySampleCount += 1;
  if (sample.isRetry) metric.retryCount += 1;

  if (sample.qaPassed !== null) {
    metric.qaSampleCount += 1;
    if (sample.qaPassed) metric.qaPassedCount += 1;
    if (sample.validatedAt && (!metric.lastValidatedAt || sample.validatedAt > metric.lastValidatedAt)) {
      metric.lastValidatedAt = sample.validatedAt;
    }
  }

  if (sample.reviewDecision) metric.reviewedSampleCount += 1;
  if (sample.reviewDecision === 'adopted') {
    metric.adoptedCount += 1;
    if (sample.usableCostCny !== null && Number.isFinite(sample.usableCostCny) && sample.usableCostCny >= 0) {
      accumulator.usableCosts.push(sample.usableCostCny);
    }
  } else if (sample.reviewDecision === 'not_adopted') {
    metric.rejectedCount += 1;
    const cause = sample.rejectionCause ?? 'unspecified';
    accumulator.rejectionReasonCounts.set(
      cause,
      (accumulator.rejectionReasonCounts.get(cause) ?? 0) + 1,
    );
  }
}

function finalizeMetric(accumulator: MetricAccumulator): ShotSkillMetricAggregate {
  const { metric, usableCosts } = accumulator;
  metric.qaPassRate = metric.qaSampleCount === 0 ? null : metric.qaPassedCount / metric.qaSampleCount;
  metric.adoptionRate = metric.reviewedSampleCount === 0 ? null : metric.adoptedCount / metric.reviewedSampleCount;
  metric.retryRate = metric.retrySampleCount === 0 ? null : metric.retryCount / metric.retrySampleCount;
  metric.usableCostSampleCount = usableCosts.length;
  metric.averageUsableCostCny = usableCosts.length === 0
    ? null
    : usableCosts.reduce((sum, cost) => sum + cost, 0) / usableCosts.length;
  metric.rejectionReasons = [...accumulator.rejectionReasonCounts]
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode));
  return metric;
}

export async function getShotSkillVersionMetricsForTeam(input: {
  teamId: number;
  versionIds: number[];
  productCategory?: string;
}): Promise<Map<number, ShotSkillVersionMetrics>> {
  const uniqueVersionIds = [...new Set(input.versionIds)];
  if (uniqueVersionIds.length === 0) return new Map();

  const accessibleVersions = await db
    .select({ id: shotSkillVersions.id })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      inArray(shotSkillVersions.id, uniqueVersionIds),
      or(
        eq(shotSkills.ownerTeamId, input.teamId),
        and(isNull(shotSkills.ownerTeamId), ne(shotSkillVersions.status, 'draft')),
      ),
    ));
  const accessibleVersionIdSet = new Set(accessibleVersions.map((version) => version.id));
  const accessibleVersionIds = uniqueVersionIds.filter((versionId) => accessibleVersionIdSet.has(versionId));
  if (accessibleVersionIds.length === 0) return new Map();

  const requestedCategory = input.productCategory?.trim();
  const overallAccumulators = new Map<number, MetricAccumulator>(
    accessibleVersionIds.map((versionId) => [versionId, emptyMetricAccumulator()]),
  );
  const categoryAccumulators = new Map<number, Map<string, MetricAccumulator>>(
    accessibleVersionIds.map((versionId) => [versionId, new Map()]),
  );

  const jobs = await db.select().from(videoJobs).where(and(
    eq(videoJobs.teamId, input.teamId),
    inArray(videoJobs.shotSkillVersionId, accessibleVersionIds),
  ));
  const jobIds = jobs.map((job) => job.id);
  const creativeSpecVersionIds = [
    ...new Set(jobs.flatMap((job) => job.creativeSpecVersionId ? [job.creativeSpecVersionId] : [])),
  ];
  const [jobReviews, evidence, creativeSpecs] = await Promise.all([
    jobIds.length === 0
      ? Promise.resolve([])
      : db.select({
          videoJobId: reviews.videoJobId,
          decision: reviews.decision,
          qualityFailureCause: reviews.qualityFailureCause,
        }).from(reviews).where(and(
          eq(reviews.teamId, input.teamId),
          inArray(reviews.videoJobId, jobIds),
        )),
    jobIds.length === 0
      ? Promise.resolve([])
      : db.select({
          videoJobId: shotSkillValidationEvidence.videoJobId,
          shotSkillVersionId: shotSkillValidationEvidence.shotSkillVersionId,
          evidenceType: shotSkillValidationEvidence.evidenceType,
          passed: shotSkillValidationEvidence.passed,
          detail: shotSkillValidationEvidence.detail,
          createdAt: shotSkillValidationEvidence.createdAt,
        }).from(shotSkillValidationEvidence).where(and(
          eq(shotSkillValidationEvidence.teamId, input.teamId),
          inArray(shotSkillValidationEvidence.shotSkillVersionId, accessibleVersionIds),
          inArray(shotSkillValidationEvidence.videoJobId, jobIds),
        )),
    creativeSpecVersionIds.length === 0
      ? Promise.resolve([])
      : db.select({
          id: creativeSpecVersions.id,
          specSnapshot: creativeSpecVersions.specSnapshot,
        }).from(creativeSpecVersions).where(and(
          eq(creativeSpecVersions.teamId, input.teamId),
          inArray(creativeSpecVersions.id, creativeSpecVersionIds),
        )),
  ]);

  const reviewByJobId = new Map(jobReviews.map((review) => [review.videoJobId, review]));
  const evidenceByJobId = new Map<number, typeof evidence>();
  for (const entry of evidence) {
    const entries = evidenceByJobId.get(entry.videoJobId) ?? [];
    entries.push(entry);
    evidenceByJobId.set(entry.videoJobId, entries);
  }
  const categoryByCreativeSpecVersionId = new Map(
    creativeSpecs.map((spec) => [spec.id, parseProductCategory(spec.specSnapshot)]),
  );

  for (const job of jobs) {
    if (!job.shotSkillVersionId) continue;
    const overall = overallAccumulators.get(job.shotSkillVersionId);
    if (!overall) continue;
    const category = job.creativeSpecVersionId
      ? categoryByCreativeSpecVersionId.get(job.creativeSpecVersionId) ?? null
      : null;
    if (requestedCategory !== undefined && category !== requestedCategory) continue;

    const jobEvidence = (evidenceByJobId.get(job.id) ?? [])
      .filter((entry) => entry.shotSkillVersionId === job.shotSkillVersionId);
    const qualityEvidence = jobEvidence.find((entry) => entry.evidenceType === 'quality_gate');
    const adoptedEvidence = jobEvidence.find((entry) => entry.evidenceType === 'adopted');
    const rejectedEvidence = jobEvidence.find((entry) => entry.evidenceType === 'rejected');
    const legacyQuality = qualityEvidence ? null : parseQualityReport(job.qualityReport);
    const legacyReview = reviewByJobId.get(job.id);
    const reviewDecision = adoptedEvidence
      ? 'adopted' as const
      : rejectedEvidence
        ? 'not_adopted' as const
        : legacyReview?.decision ?? null;
    const rejectionCause = rejectedEvidence
      ? parseRejectionCause(rejectedEvidence.detail) ?? legacyReview?.qualityFailureCause ?? null
      : legacyReview?.qualityFailureCause ?? null;
    const sample = {
      isRetry: job.retryOfVideoJobId !== null,
      qaPassed: qualityEvidence?.passed ?? legacyQuality?.passed ?? null,
      validatedAt: qualityEvidence?.createdAt ?? (legacyQuality ? new Date(legacyQuality.checkedAt) : null),
      reviewDecision,
      rejectionCause,
      usableCostCny: parseEvidenceCost(qualityEvidence?.detail)
        ?? (job.actualCostCny === null ? null : Number(job.actualCostCny)),
    };
    addMetricSample(overall, sample);

    if (category) {
      const versionCategories = categoryAccumulators.get(job.shotSkillVersionId);
      if (!versionCategories) continue;
      const categoryAccumulator = versionCategories.get(category) ?? emptyMetricAccumulator();
      addMetricSample(categoryAccumulator, sample);
      versionCategories.set(category, categoryAccumulator);
    }
  }

  const metrics = new Map<number, ShotSkillVersionMetrics>();
  for (const [versionId, accumulator] of overallAccumulators) {
    const productCategories = [...(categoryAccumulators.get(versionId) ?? new Map<string, MetricAccumulator>())]
      .map(([productCategory, categoryAccumulator]) => ({
        ...finalizeMetric(categoryAccumulator),
        productCategory,
      }))
      .sort((left, right) => left.productCategory.localeCompare(right.productCategory));
    metrics.set(versionId, {
      ...finalizeMetric(accumulator),
      productCategory: requestedCategory ?? null,
      productCategories,
    });
  }
  return metrics;
}

export type ShotSkillEvidenceReasonAggregate = {
  reasonCode: string;
  sampleCount: number;
};

export type ShotSkillValidationEvidenceAggregate = {
  qualitySampleCount: number;
  qaPassedSampleCount: number;
  reviewedSampleCount: number;
  adoptedSampleCount: number;
  rejectedSampleCount: number;
  adoptionReasons: ShotSkillEvidenceReasonAggregate[];
  rejectionReasons: ShotSkillEvidenceReasonAggregate[];
};

function parseEvidenceReasonCode(
  detail: unknown,
  fallback: string,
): string {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return fallback;
  const record = detail as Record<string, unknown>;
  const reasonCode = record.reasonCode ?? record.rejectionCause;
  return typeof reasonCode === 'string' && reasonCode.trim() ? reasonCode.trim() : fallback;
}

export async function getShotSkillValidationEvidenceAggregateForTeam(input: {
  teamId: number;
  shotSkillVersionId: number;
}): Promise<ShotSkillValidationEvidenceAggregate | null> {
  const accessibleVersion = (await db
    .select({ id: shotSkillVersions.id, ownerTeamId: shotSkills.ownerTeamId })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkillVersions.id, input.shotSkillVersionId),
      or(
        eq(shotSkills.ownerTeamId, input.teamId),
        and(isNull(shotSkills.ownerTeamId), ne(shotSkillVersions.status, 'draft')),
      ),
    ))
    .limit(1))[0];
  if (!accessibleVersion) return null;

  const evidence = await db
    .select({
      evidenceType: shotSkillValidationEvidence.evidenceType,
      passed: shotSkillValidationEvidence.passed,
      detail: shotSkillValidationEvidence.detail,
    })
    .from(shotSkillValidationEvidence)
    .where(accessibleVersion.ownerTeamId === null
      ? eq(shotSkillValidationEvidence.shotSkillVersionId, input.shotSkillVersionId)
      : and(
          eq(shotSkillValidationEvidence.teamId, input.teamId),
          eq(shotSkillValidationEvidence.shotSkillVersionId, input.shotSkillVersionId),
        ));
  const adoptionReasonCounts = new Map<string, number>();
  const rejectionReasonCounts = new Map<string, number>();
  let qualitySampleCount = 0;
  let qaPassedSampleCount = 0;
  let adoptedSampleCount = 0;
  let rejectedSampleCount = 0;

  for (const sample of evidence) {
    if (sample.evidenceType === 'quality_gate') {
      qualitySampleCount += 1;
      if (sample.passed) qaPassedSampleCount += 1;
      continue;
    }
    if (sample.evidenceType === 'adopted') {
      adoptedSampleCount += 1;
      const reasonCode = parseEvidenceReasonCode(sample.detail, 'qa_passed_and_adopted');
      adoptionReasonCounts.set(reasonCode, (adoptionReasonCounts.get(reasonCode) ?? 0) + 1);
      continue;
    }
    if (sample.evidenceType === 'rejected') {
      rejectedSampleCount += 1;
      const reasonCode = parseEvidenceReasonCode(sample.detail, 'unspecified');
      rejectionReasonCounts.set(reasonCode, (rejectionReasonCounts.get(reasonCode) ?? 0) + 1);
    }
  }
  const toSortedReasons = (counts: Map<string, number>): ShotSkillEvidenceReasonAggregate[] =>
    [...counts].map(([reasonCode, sampleCount]) => ({ reasonCode, sampleCount }))
      .sort((left, right) => right.sampleCount - left.sampleCount || left.reasonCode.localeCompare(right.reasonCode));

  return {
    qualitySampleCount,
    qaPassedSampleCount,
    reviewedSampleCount: adoptedSampleCount + rejectedSampleCount,
    adoptedSampleCount,
    rejectedSampleCount,
    adoptionReasons: toSortedReasons(adoptionReasonCounts),
    rejectionReasons: toSortedReasons(rejectionReasonCounts),
  };
}


export type ProductionBatchSkillBindingSummary = {
  productionBatchId: number;
  shotSkillVersionId: number;
  skillName: string;
  stableId: string;
  version: string;
  definitionHash: string;
  selectionReason: string;
};

export async function listProductionBatchSkillBindingsForTeam(
  teamId: number,
): Promise<ProductionBatchSkillBindingSummary[]> {
  const [boundRows, batches] = await Promise.all([
    db
      .selectDistinct({
        productionBatchId: productionBatchItems.productionBatchId,
        shotSkillVersionId: shotSkillVersions.id,
        skillName: shotSkills.name,
        stableId: shotSkills.stableId,
        version: shotSkillVersions.version,
        definitionHash: shotSkillVersions.definitionHash,
        selectionReason: shotCards.skillSelectionReason,
      })
      .from(productionBatchItems)
      .innerJoin(
        shotCards,
        and(
          eq(shotCards.teamId, productionBatchItems.teamId),
          eq(shotCards.campaignId, productionBatchItems.campaignId),
          eq(shotCards.status, 'selected'),
        ),
      )
      .innerJoin(shotSkillVersions, eq(shotSkillVersions.id, shotCards.shotSkillVersionId))
      .innerJoin(shotSkills, eq(shotSkills.id, shotSkillVersions.shotSkillId))
      .where(eq(productionBatchItems.teamId, teamId)),
    db.select({
      productionBatchId: productionBatches.id,
      skillVersionLock: productionBatches.skillVersionLock,
    }).from(productionBatches).where(eq(productionBatches.teamId, teamId)),
  ]);
  const lockedByBatch = batches.flatMap((batch) => {
    try {
      const parsed = JSON.parse(batch.skillVersionLock) as Record<string, unknown>;
      return Object.values(parsed).flatMap((value) => {
        if (!value || typeof value !== 'object' || !('shotSkillVersionId' in value)) return [];
        const versionId = Number((value as { shotSkillVersionId: unknown }).shotSkillVersionId);
        return Number.isSafeInteger(versionId) && versionId > 0
          ? [{ productionBatchId: batch.productionBatchId, shotSkillVersionId: versionId }]
          : [];
      });
    } catch {
      return [];
    }
  });
  const versionIds = [...new Set(lockedByBatch.map((entry) => entry.shotSkillVersionId))];
  const lockedVersions = versionIds.length
    ? await db.select({
      shotSkillVersionId: shotSkillVersions.id,
      skillName: shotSkills.name,
      stableId: shotSkills.stableId,
      version: shotSkillVersions.version,
      definitionHash: shotSkillVersions.definitionHash,
    })
      .from(shotSkillVersions)
      .innerJoin(shotSkills, eq(shotSkills.id, shotSkillVersions.shotSkillId))
      .where(and(
        inArray(shotSkillVersions.id, versionIds),
        or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, teamId)),
      ))
    : [];
  const versionById = new Map(lockedVersions.map((entry) => [entry.shotSkillVersionId, entry]));
  const summaries = new Map<string, ProductionBatchSkillBindingSummary>();
  for (const locked of lockedByBatch) {
    const version = versionById.get(locked.shotSkillVersionId);
    if (!version) continue;
    summaries.set(`${locked.productionBatchId}:${locked.shotSkillVersionId}`, {
      productionBatchId: locked.productionBatchId,
      ...version,
      selectionReason: 'Selected by the Eligibility preview and frozen when the Production task was created.',
    });
  }
  for (const row of boundRows) {
    summaries.set(`${row.productionBatchId}:${row.shotSkillVersionId}`, {
      ...row,
      selectionReason: row.selectionReason ?? 'Explicit database Skill version binding.',
    });
  }
  return [...summaries.values()];
}
