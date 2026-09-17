import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { brandKits, catalogItemAssets, catalogItems } from '@/lib/db/schema';
import { evaluateShotSkillEligibility, type EligibilityBlocker, type EligibilityRemediation } from './eligibility';
import { listShotSkillLibraryForTeam } from './queries';
import { shotRoleSchema, shotSkillContextSchema, type ShotRole, type ShotSkillContext } from './schema';

export const eligibilityRemediationCodeSchema = z.enum([
  'change_duration',
  'upload_primary_image',
  'upload_detail_image',
  'add_scene_brief',
  'confirm_person_rights',
  'change_shot_role',
  'edit_product',
  'create_private_skill',
]);

export const customerEligibilityRemediationSchema = z.object({
  code: eligibilityRemediationCodeSchema,
  label: z.string().min(1),
  href: z.string().min(1).nullable(),
}).strict();

export const customerEligibilityBlockerSchema = z.object({
  code: z.string().min(1),
  field: z.string().min(1),
  message: z.string().min(1),
  remediations: z.array(customerEligibilityRemediationSchema),
}).strict();

export const skillEligibilityCandidateSchema = z.object({
  skillId: z.number().int().positive(),
  stableId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  scope: z.enum(['official', 'workspace_private']),
  versionId: z.number().int().positive(),
  version: z.string().min(1),
  definitionHash: z.string().length(64),
  eligible: z.boolean(),
  blockers: z.array(customerEligibilityBlockerSchema),
  supportedDurations: z.array(z.number().int().min(4).max(15)),
  requiresDetailImages: z.boolean(),
  requiresSceneBrief: z.boolean(),
  privateDraftHref: z.string().min(1),
}).strict();

export const catalogItemEligibilityPreviewSchema = z.object({
  catalogItemId: z.number().int().positive(),
  externalSku: z.string().min(1),
  productName: z.string().min(1),
  readinessStatus: z.enum(['needs_input', 'ready', 'archived']),
  context: shotSkillContextSchema,
  candidates: z.array(skillEligibilityCandidateSchema),
  supportedDurations: z.array(z.number().int().min(4).max(15)),
  selectedVersionId: z.number().int().positive().nullable(),
  selectedStableId: z.string().min(1).nullable(),
  recommendedDuration: z.number().int().min(4).max(15).nullable(),
  canCreate: z.boolean(),
  blockers: z.array(customerEligibilityBlockerSchema),
}).strict();

export type CustomerEligibilityRemediation = z.infer<typeof customerEligibilityRemediationSchema>;
export type CustomerEligibilityBlocker = z.infer<typeof customerEligibilityBlockerSchema>;
export type SkillEligibilityCandidate = z.infer<typeof skillEligibilityCandidateSchema>;
export type CatalogItemEligibilityPreview = z.infer<typeof catalogItemEligibilityPreviewSchema>;

const remediationLabels: Record<EligibilityRemediation, string> = {
  change_duration: 'Use a supported duration',
  upload_primary_image: 'Upload a primary product image',
  upload_detail_image: 'Upload product detail images',
  add_scene_brief: 'Add a Scene Brief',
  confirm_person_rights: 'Confirm person and character rights',
  change_shot_role: 'Choose another shot role',
  edit_product: 'Edit product information',
  create_private_skill: 'Create a Private Shot Skill',
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function remediationHref(input: {
  code: EligibilityRemediation;
  catalogItemId: number;
  versionId: number;
  durationSeconds: number;
}): string | null {
  switch (input.code) {
    case 'upload_primary_image':
    case 'upload_detail_image':
    case 'add_scene_brief':
    case 'confirm_person_rights':
    case 'edit_product':
      return `/dashboard/catalog/${input.catalogItemId}#edit-product`;
    case 'create_private_skill':
      return `/dashboard/skills/new?sourceVersionId=${input.versionId}&durationSeconds=${input.durationSeconds}`;
    case 'change_duration':
    case 'change_shot_role':
      return null;
  }
}

function customerBlocker(
  blocker: EligibilityBlocker,
  input: { catalogItemId: number; versionId: number; durationSeconds: number },
): CustomerEligibilityBlocker {
  return customerEligibilityBlockerSchema.parse({
    code: blocker.code,
    field: blocker.field,
    message: blocker.message,
    remediations: blocker.remediations.map((code) => ({
      code,
      label: remediationLabels[code],
      href: remediationHref({ ...input, code }),
    })),
  });
}

export function buildCatalogItemEligibilityContext(input: {
  category: string;
  durationSeconds: number;
  targetPlatform: string;
  primaryImageAvailable: boolean;
  detailImageCount: number;
  targetAudience: string;
  campaignGoal: string;
  brandVoice: string;
  approvedClaims: Array<{ text?: string; source?: string }>;
  prohibitedClaims: string[];
  mustShowElements: string[];
  immutableElements: string[];
  forbiddenElements: string[];
  defaultShotPreference: string;
  shotRole?: ShotRole;
}): ShotSkillContext {
  const hasSceneBrief = Boolean(input.targetAudience.trim() && input.campaignGoal.trim());
  return shotSkillContextSchema.parse({
    shotRole: input.shotRole ?? 'hook',
    productCategory: input.category,
    durationSeconds: input.durationSeconds,
    targetPlatform: input.targetPlatform,
    primaryImageAvailable: input.primaryImageAvailable,
    detailImageCount: input.detailImageCount,
    hasSceneBrief,
    personRights: 'none',
    brandVoice: input.brandVoice,
    sellingPoints: input.approvedClaims
      .map((claim) => [claim.text, claim.source].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('; ') || 'Use only approved product information.',
    mustShowElements: input.mustShowElements,
    immutableElements: input.immutableElements,
    forbiddenElements: [...new Set([...input.forbiddenElements, ...input.prohibitedClaims])],
    shotDirection: [input.defaultShotPreference, input.campaignGoal].filter(Boolean).join('. '),
  });
}

export async function previewCatalogItemEligibilityForTeam(input: {
  teamId: number;
  catalogItemId: number;
  durationSeconds?: number;
  targetPlatform?: string;
  shotRole?: ShotRole;
  preferredVersionId?: number;
}): Promise<CatalogItemEligibilityPreview | null> {
  const rows = await db.select({ item: catalogItems, brandKit: brandKits })
    .from(catalogItems)
    .innerJoin(brandKits, and(eq(catalogItems.brandKitId, brandKits.id), eq(brandKits.teamId, input.teamId)))
    .where(and(eq(catalogItems.id, input.catalogItemId), eq(catalogItems.teamId, input.teamId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const assetBindings = await db.select({ purpose: catalogItemAssets.purpose })
    .from(catalogItemAssets)
    .where(and(
      eq(catalogItemAssets.teamId, input.teamId),
      eq(catalogItemAssets.catalogItemId, input.catalogItemId),
    ));
  const detailImageCount = assetBindings.filter((binding) => binding.purpose === 'detail').length;
  const context = buildCatalogItemEligibilityContext({
    category: row.item.category,
    durationSeconds: input.durationSeconds ?? row.item.durationSeconds,
    targetPlatform: input.targetPlatform ?? row.item.platform,
    primaryImageAvailable: Boolean(row.item.primaryAssetId),
    detailImageCount,
    targetAudience: row.item.targetAudience,
    campaignGoal: row.item.campaignGoal,
    brandVoice: row.brandKit.brandVoice,
    approvedClaims: parseJson(row.item.approvedClaims, []),
    prohibitedClaims: parseJson(row.item.prohibitedClaims, []),
    mustShowElements: parseJson(row.item.mustShowElements, []),
    immutableElements: parseJson(row.item.immutableElements, []),
    forbiddenElements: parseJson(row.brandKit.forbiddenElements, []),
    defaultShotPreference: row.brandKit.defaultShotPreference,
    shotRole: input.shotRole,
  });
  const library = await listShotSkillLibraryForTeam({
    teamId: input.teamId,
    filters: { status: 'active' },
  });
  const evaluations = evaluateShotSkillEligibility(context, library.map((entry) => entry.definition));
  const candidates = library.map((entry, index) => {
    const evaluation = evaluations[index]!;
    const supportedDurations = entry.definition.provider.durationSeconds.filter((durationSeconds) =>
      evaluateShotSkillEligibility({ ...context, durationSeconds }, [entry.definition])[0]?.eligible,
    );
    return skillEligibilityCandidateSchema.parse({
      skillId: entry.skill.id,
      stableId: entry.skill.stableId,
      name: entry.skill.name,
      description: entry.skill.description,
      scope: entry.scope,
      versionId: entry.version.id,
      version: entry.version.version,
      definitionHash: entry.version.definitionHash,
      eligible: evaluation.eligible,
      blockers: evaluation.blockers.map((blocker) => customerBlocker(blocker, {
        catalogItemId: input.catalogItemId,
        versionId: entry.version.id,
        durationSeconds: context.durationSeconds,
      })),
      supportedDurations,
      requiresDetailImages: entry.definition.requiredInputs.some((required) => required.type === 'product_detail_image' && required.minimumCount > 0),
      requiresSceneBrief: entry.definition.requiredInputs.some((required) => required.type === 'scene_brief' && required.minimumCount > 0),
      privateDraftHref: `/dashboard/skills/new?sourceVersionId=${entry.version.id}&durationSeconds=${context.durationSeconds}`,
    });
  });
  const supportedDurations = [...new Set(candidates.flatMap((candidate) => candidate.supportedDurations))]
    .sort((left, right) => left - right);
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const selected = eligible.find((candidate) => candidate.versionId === input.preferredVersionId)
    ?? eligible.find((candidate) => candidate.stableId === 'product-hero')
    ?? eligible[0];
  const blockers: CustomerEligibilityBlocker[] = [];
  if (row.item.readinessStatus !== 'ready') {
    blockers.push({
      code: 'catalog_item_not_ready',
      field: 'readinessStatus',
      message: `SKU ${row.item.externalSku} must be ready before creating a production task.`,
      remediations: [{ code: 'edit_product', label: remediationLabels.edit_product, href: `/dashboard/catalog/${row.item.id}#edit-product` }],
    });
  }
  if (!selected) {
    const durationOnly = candidates.some((candidate) => candidate.blockers.every((blocker) => blocker.code === 'unsupported_duration'));
    const recommendedDuration = supportedDurations.includes(5) ? 5 : supportedDurations[0] ?? null;
    blockers.push({
      code: 'no_eligible_shot_skill',
      field: 'shotSkill',
      message: durationOnly && recommendedDuration
        ? `No active Shot Skill supports ${context.durationSeconds} seconds for this product. Change to ${recommendedDuration} seconds or create a Private Skill that supports ${context.durationSeconds} seconds.`
        : 'No active Shot Skill supports the current product materials and production settings. Review the Skill-specific fixes below.',
      remediations: [
        ...(recommendedDuration ? [{ code: 'change_duration' as const, label: `Use ${recommendedDuration} seconds`, href: null }] : []),
        ...(candidates[0] ? [{ code: 'create_private_skill' as const, label: remediationLabels.create_private_skill, href: candidates[0].privateDraftHref }] : []),
      ],
    });
  }
  const recommendedDuration = supportedDurations.includes(5) ? 5 : supportedDurations[0] ?? null;
  return catalogItemEligibilityPreviewSchema.parse({
    catalogItemId: row.item.id,
    externalSku: row.item.externalSku,
    productName: row.item.productName,
    readinessStatus: row.item.readinessStatus,
    context,
    candidates,
    supportedDurations,
    selectedVersionId: selected?.versionId ?? null,
    selectedStableId: selected?.stableId ?? null,
    recommendedDuration,
    canCreate: row.item.readinessStatus === 'ready' && Boolean(selected),
    blockers,
  });
}
