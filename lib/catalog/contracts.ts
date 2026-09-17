import { z } from 'zod';
import {
  referenceModeSchema,
  referenceRightsSchema,
  validateSkuReadiness,
  type SkuReadinessResult,
} from '@/lib/bulk/contracts';

const trimmed = (maximum: number) => z.string().trim().max(maximum);
const listValueSchema = trimmed(500);
const claimSchema = z.object({
  text: trimmed(1_000),
  source: trimmed(2_000),
}).strict();

export const catalogProductInputSchema = z.object({
  externalSku: z.string().trim().min(1, 'SKU is required.').max(160),
  productName: trimmed(255),
  category: trimmed(100),
  primaryImageUrl: trimmed(2_000),
  productPageUrl: trimmed(2_000).optional(),
  primaryImageAuthorized: z.boolean().default(false),
  primaryAssetId: z.number().int().positive().nullable().optional(),
  detailImageUrls: z.array(trimmed(2_000)).max(9).default([]),
  detailAssetIds: z.array(z.number().int().positive()).max(9).default([]),
  approvedClaims: z.array(claimSchema).max(5).default([]),
  prohibitedClaims: z.array(listValueSchema).max(5).default([]),
  mustShowElements: z.array(listValueSchema).max(5).default([]),
  immutableElements: z.array(listValueSchema).max(5).default([]),
  targetAudience: trimmed(2_000),
  campaignGoal: trimmed(4_000),
  platform: trimmed(50),
  durationSeconds: z.number().int().min(4).max(15),
  brandKitId: z.number().int().positive(),
  cta: trimmed(2_000),
  referenceVideoUrl: trimmed(2_000).optional(),
  referenceRights: referenceRightsSchema.optional(),
  referenceMode: referenceModeSchema.optional(),
}).strict();

export const catalogProductUpdateSchema = catalogProductInputSchema
  .omit({ externalSku: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Select at least one Catalog field.' });

export const catalogCopyInputSchema = z.object({
  externalSku: z.string().trim().min(1, 'New SKU is required.').max(160),
}).strict();

export const catalogConflictSchema = z.object({
  code: z.literal('external_sku_conflict'),
  externalSku: z.string().min(1),
  existingProductName: z.string().min(1),
  existingItemHref: z.string().startsWith('/dashboard/catalog/'),
  options: z.tuple([z.literal('update'), z.literal('cancel')]),
}).strict();
export type CatalogConflict = z.infer<typeof catalogConflictSchema>;

export type CatalogProductInput = z.infer<typeof catalogProductInputSchema>;
export type CatalogProductUpdate = z.infer<typeof catalogProductUpdateSchema>;

export function compactCatalogProductInput(input: CatalogProductInput): CatalogProductInput {
  return {
    ...input,
    productPageUrl: input.productPageUrl || undefined,
    detailImageUrls: input.detailImageUrls.filter(Boolean),
    detailAssetIds: [...new Set(input.detailAssetIds)],
    approvedClaims: input.approvedClaims.filter((claim) => claim.text || claim.source),
    prohibitedClaims: input.prohibitedClaims.filter(Boolean),
    mustShowElements: input.mustShowElements.filter(Boolean),
    immutableElements: input.immutableElements.filter(Boolean),
    referenceVideoUrl: input.referenceVideoUrl || undefined,
  };
}

export function previewCatalogReadiness(input: CatalogProductInput): SkuReadinessResult {
  const value = compactCatalogProductInput(input);
  return validateSkuReadiness({
    externalSku: value.externalSku,
    productName: value.productName,
    category: value.category,
    primaryImageUrl: value.primaryImageUrl,
    primaryAssetId: value.primaryAssetId ?? undefined,
    primaryImageAuthorized: value.primaryImageAuthorized,
    detailImageUrls: value.detailImageUrls,
    approvedClaims: value.approvedClaims,
    prohibitedClaims: value.prohibitedClaims,
    mustShowElements: value.mustShowElements,
    immutableElements: value.immutableElements,
    targetAudience: value.targetAudience,
    campaignGoal: value.campaignGoal,
    platform: value.platform,
    durationSeconds: value.durationSeconds,
    brandKitId: value.brandKitId,
    cta: value.cta,
    referenceVideoUrl: value.referenceVideoUrl,
    referenceRights: value.referenceRights,
    referenceMode: value.referenceMode,
  });
}
