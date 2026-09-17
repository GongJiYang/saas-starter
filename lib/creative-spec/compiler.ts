import { createHash } from 'node:crypto';
import { z } from 'zod';
import { creativeSpecSchema } from '@/lib/bulk/contracts';
import type { BrandKit, Campaign, CatalogItem } from '@/lib/db/schema';

export const angleProposalSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  riskNotes: z.array(z.string().min(1)).min(1),
  source: z.string().min(1),
  score: z.number().nonnegative(),
}).strict();

export const productBriefSchema = z.object({
  catalogItemId: z.number().int().positive(),
  campaignId: z.number().int().positive(),
  externalSku: z.string().min(1),
  productName: z.string().min(1),
  category: z.string().min(1),
  primaryImageUrl: z.string().url(),
  detailImageUrls: z.array(z.string().url()),
  approvedClaims: z.array(z.object({ id: z.string(), text: z.string(), source: z.string() }).strict()).min(1),
  prohibitedClaims: z.array(z.string()).min(1),
  mustShowElements: z.array(z.string()).min(1),
  immutableElements: z.array(z.string()).min(1),
  targetAudience: z.string().min(1),
  campaignGoal: z.string().min(1),
  targetPlatform: z.string().min(1),
  durationSeconds: z.number().int().min(4).max(15),
  cta: z.string().min(1),
}).strict();

export const specEnvelopeSchema = z.object({
  brief: productBriefSchema,
  brandKitSnapshot: z.object({
    name: z.string().min(1),
    brandVoice: z.string().min(1),
    requiredElements: z.string().min(1),
    forbiddenElements: z.string().min(1),
    defaultShotPreference: z.string().min(1),
  }).strict(),
  angleProposals: z.array(angleProposalSchema).length(3),
  referenceAnalysisSource: z.object({
    analysisId: z.number().int().positive().nullable(),
    borrowedStructure: z.array(z.string()),
    excludedContent: z.array(z.string()).min(1),
  }).strict(),
  creativeSpec: creativeSpecSchema,
}).strict();

function parseJson<T>(value: string | null, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashSpecEnvelope(envelope: z.infer<typeof specEnvelopeSchema>): string {
  return createHash('sha256').update(stableStringify(envelope)).digest('hex');
}

export function compileProductBrief(input: {
  catalogItem: CatalogItem;
  campaign: Campaign;
}): z.infer<typeof productBriefSchema> {
  const approvedClaims = parseJson<Array<{ text: string; source: string }>>(input.catalogItem.approvedClaims, []);
  const detailImageUrls = parseJson<string[]>(input.catalogItem.primaryImageUrl ? '[]' : '[]', []);
  const brief = {
    catalogItemId: input.catalogItem.id,
    campaignId: input.campaign.id,
    externalSku: input.catalogItem.externalSku,
    productName: input.catalogItem.productName,
    category: input.catalogItem.category,
    primaryImageUrl: input.catalogItem.primaryImageUrl,
    detailImageUrls,
    approvedClaims: approvedClaims.map((claim, index) => ({ id: `claim-${index + 1}`, ...claim })),
    prohibitedClaims: parseJson<string[]>(input.catalogItem.prohibitedClaims, []),
    mustShowElements: parseJson<string[]>(input.catalogItem.mustShowElements, []),
    immutableElements: parseJson<string[]>(input.catalogItem.immutableElements, []),
    targetAudience: input.catalogItem.targetAudience,
    campaignGoal: input.catalogItem.campaignGoal,
    targetPlatform: input.campaign.targetPlatform,
    durationSeconds: input.campaign.durationSeconds,
    cta: input.catalogItem.cta,
  };
  return productBriefSchema.parse(brief);
}

export function rankEligibleAngles(brief: z.infer<typeof productBriefSchema>): z.infer<typeof angleProposalSchema>[] {
  const candidates = [
    {
      id: 'product-detail',
      label: 'Product detail reveal',
      rationale: 'Lead with a recognizable product detail before resolving to the complete product.',
      evidenceIds: ['primary-image', 'claim-1'],
      riskNotes: ['Do not redraw the label or alter product shape.'],
      source: 'catalog.primary_image + approved_claims',
      score: 3,
      eligible: Boolean(brief.primaryImageUrl && brief.approvedClaims.length > 0),
    },
    {
      id: 'product-use-case',
      label: 'Audience use case',
      rationale: `Show the product in a legible context for ${brief.targetAudience}.`,
      evidenceIds: ['target-audience', 'campaign-goal', 'claim-1'],
      riskNotes: ['Do not invent a product effect beyond approved claims.'],
      source: 'catalog.target_audience + campaign.goal',
      score: 2.8,
      eligible: Boolean(brief.targetAudience && brief.campaignGoal),
    },
    {
      id: 'claim-proof',
      label: 'Approved claim proof',
      rationale: 'Make one approved, sourced product claim the visual center of the story.',
      evidenceIds: brief.approvedClaims.slice(0, 2).map((claim) => claim.id),
      riskNotes: ['Use only the supplied claim wording and evidence source.'],
      source: 'catalog.approved_claims',
      score: 2.6,
      eligible: brief.approvedClaims.length >= 1,
    },
    {
      id: 'comparison',
      label: 'Comparison',
      rationale: 'Requires explicit comparison evidence that this brief does not provide.',
      evidenceIds: [],
      riskNotes: ['Blocked without comparison evidence.'],
      source: 'angle.comparison',
      score: 0,
      eligible: false,
    },
    {
      id: 'social-proof',
      label: 'Social proof',
      rationale: 'Requires approved testimonial or social-proof evidence.',
      evidenceIds: [],
      riskNotes: ['Blocked without testimonial evidence.'],
      source: 'angle.social_proof',
      score: 0,
      eligible: false,
    },
    {
      id: 'offer',
      label: 'Offer',
      rationale: 'Requires an explicit approved offer and expiry constraint.',
      evidenceIds: [],
      riskNotes: ['Blocked without offer evidence.'],
      source: 'angle.offer',
      score: 0,
      eligible: false,
    },
  ];
  return candidates.filter((candidate) => candidate.eligible).sort((a, b) => b.score - a.score).slice(0, 3).map(({ eligible: _eligible, ...proposal }) => angleProposalSchema.parse(proposal));
}

export function compileSpecEnvelope(input: {
  brief: z.infer<typeof productBriefSchema>;
  brandKit: BrandKit;
  proposals: z.infer<typeof angleProposalSchema>[];
  referenceAnalysis?: { id: number; analysisSnapshot: string; borrowedStructure: string; excludedContent: string } | null;
  selectedAngleId?: string;
}): z.infer<typeof specEnvelopeSchema> {
  if (input.proposals.length !== 3) throw new Error('Exactly three eligible Angle Proposals are required.');
  const selected = input.proposals.find((proposal) => proposal.id === input.selectedAngleId) ?? input.proposals[0];
  if (!selected) throw new Error('A selected Creative Angle is required.');
  const excludedContent = input.referenceAnalysis
    ? parseJson<string[]>(input.referenceAnalysis.excludedContent, [])
    : ['original_script', 'original_audio'];
  const borrowedStructure = input.referenceAnalysis
    ? parseJson<string[]>(input.referenceAnalysis.borrowedStructure, [])
    : [];
  const approvedClaimIds = input.brief.approvedClaims.map((claim) => claim.id);
  const hooks = [
    ['A', `Open with the most recognizable ${input.brief.productName} detail.`, 'Macro product detail.'],
    ['B', `Begin with the ${input.brief.targetAudience} use context, then resolve to the product.`, 'Context-to-product reveal.'],
    ['C', `Start on the approved claim proof, then show the complete product.`, 'Claim proof close-up.'],
  ] as const;
  const creativeSpec = {
    version: '1.0.0',
    status: 'draft' as const,
    selectedAngle: {
      id: selected.id,
      label: selected.label,
      rationale: selected.rationale,
      evidenceIds: selected.evidenceIds,
      riskNotes: selected.riskNotes,
    },
    hookVariants: hooks.map(([id, openingHook, firstShotDescription]) => ({ id: id as 'A' | 'B' | 'C', openingHook, firstShotDescription, approvedClaimIds: approvedClaimIds.slice(0, 1) })),
    sharedBodyShotList: [
      { id: 'body-1', description: `Resolve to one complete ${input.brief.productName}.`, approvedClaimIds },
      { id: 'body-2', description: `Show ${input.brief.mustShowElements.join(', ')} clearly.`, approvedClaimIds },
      { id: 'body-3', description: `Present the approved proof for ${input.brief.approvedClaims[0]?.text}.`, approvedClaimIds: approvedClaimIds.slice(0, 1) },
      { id: 'body-4', description: `End with a clear ${input.brief.cta} prompt.`, approvedClaimIds },
    ],
    visualTreatment: input.brandKit.defaultShotPreference,
    pacing: 'Clear, controlled, and legible for mobile viewing.',
    captionPlan: 'Programmatic captions from approved claims only.',
    mustShowElements: input.brief.mustShowElements,
    immutableElements: input.brief.immutableElements,
    forbiddenElements: [...input.brief.prohibitedClaims, input.brandKit.forbiddenElements],
    referenceBorrowedStructure: borrowedStructure,
    referenceExcludedContent: excludedContent,
    estimated: {
      shotCount: 8,
      durationSeconds: input.brief.durationSeconds,
      maxEstimatedCostCny: 10,
    },
  };
  return specEnvelopeSchema.parse({
    brief: input.brief,
    brandKitSnapshot: {
      name: input.brandKit.name,
      brandVoice: input.brandKit.brandVoice,
      requiredElements: input.brandKit.requiredElements,
      forbiddenElements: input.brandKit.forbiddenElements,
      defaultShotPreference: input.brandKit.defaultShotPreference,
    },
    angleProposals: input.proposals,
    referenceAnalysisSource: {
      analysisId: input.referenceAnalysis?.id ?? null,
      borrowedStructure,
      excludedContent,
    },
    creativeSpec,
  });
}
