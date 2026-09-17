import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { previewCatalogItemEligibilityForTeam } from '@/lib/shot-skills';
import { shotRoleSchema } from '@/lib/shot-skills/schema';
import { DomainError } from '@/lib/errors/domain';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({
  catalogItemIds: z.array(z.number().int().positive()).min(1).max(100),
  durationSeconds: z.number().int().min(4).max(15),
  targetPlatform: z.string().trim().min(1).max(50),
  shotRole: shotRoleSchema.default('hook'),
  preferredVersionId: z.number().int().positive().optional(),
}).strict();

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return domainErrorResponse(new DomainError('request_invalid', {
      message: 'Choose valid SKU, platform, duration, and shot role values.',
      field: 'eligibility',
    }), 'request_invalid', { teamId: workspace.team.id, workspaceName: workspace.team.name, operation: 'skill.preview' });
  }
  const catalogItemIds = [...new Set(parsed.data.catalogItemIds)];
  if (catalogItemIds.length !== parsed.data.catalogItemIds.length) {
    return domainErrorResponse(new DomainError('request_invalid', {
      message: 'Choose each SKU only once.',
      field: 'catalogItemIds',
    }), 'request_invalid', { teamId: workspace.team.id, workspaceName: workspace.team.name, operation: 'skill.preview' });
  }
  const previews = await Promise.all(catalogItemIds.map((catalogItemId) =>
    previewCatalogItemEligibilityForTeam({
      teamId: workspace.team.id,
      catalogItemId,
      durationSeconds: parsed.data.durationSeconds,
      targetPlatform: parsed.data.targetPlatform,
      shotRole: parsed.data.shotRole,
      preferredVersionId: parsed.data.preferredVersionId,
    }),
  ));
  if (previews.some((preview) => !preview)) {
    return domainErrorResponse(new DomainError('workspace_entity_forbidden', {
      details: { selectedSkuCount: catalogItemIds.length },
      remediations: [{ action: 'choose_workspace_sku', label: 'Choose Workspace SKU', href: '/dashboard/batches' }],
    }), 'workspace_entity_forbidden', { teamId: workspace.team.id, workspaceName: workspace.team.name, operation: 'skill.preview' });
  }
  const items = previews.filter((preview) => preview !== null);
  const first = items[0]!;
  const commonCandidates = first.candidates
    .filter((candidate) => items.every((item) =>
      item.candidates.some((entry) => entry.versionId === candidate.versionId),
    ))
    .map((candidate) => {
      const entries = items.map((item) =>
        item.candidates.find((entry) => entry.versionId === candidate.versionId)!,
      );
      const blockers = [...new Map(entries.flatMap((entry) => entry.blockers).map((blocker) => [
        `${blocker.code}:${blocker.field}:${blocker.message}`,
        blocker,
      ])).values()];
      return {
        ...candidate,
        eligible: entries.every((entry) => entry.eligible),
        blockers,
        supportedDurations: candidate.supportedDurations.filter((duration) =>
          entries.every((entry) => entry.supportedDurations.includes(duration)),
        ),
      };
    });
  const eligibleCandidates = commonCandidates.filter((candidate) => candidate.eligible);
  const selected = eligibleCandidates.find((candidate) => candidate.versionId === parsed.data.preferredVersionId)
    ?? eligibleCandidates.find((candidate) => candidate.stableId === 'product-hero')
    ?? eligibleCandidates[0];
  const supportedDurations = [...new Set(commonCandidates.flatMap((candidate) => candidate.supportedDurations))]
    .sort((left, right) => left - right);
  return NextResponse.json({
    workspace: { id: workspace.team.id, name: workspace.team.name },
    items,
    commonCandidates,
    supportedDurations,
    selectedVersionId: selected?.versionId ?? null,
    selectedStableId: selected?.stableId ?? null,
    canCreate: items.every((item) => item.readinessStatus === 'ready') && Boolean(selected),
  });
}
