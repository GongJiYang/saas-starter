import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAssetForTeam, getCampaignForTeam, getCampaignShotSkillBindingForTeam } from '@/lib/db/video-queries';
import { getActiveVideoJobForCampaign } from '@/lib/db/video-job-queries';
import { requireWorkspace } from '@/lib/workspace/access';
import { compiledShotRecipeSchema } from '@/lib/shot-skills';

function getSelectionReason(recipeSnapshot: string | null): string | null {
  if (!recipeSnapshot) return null;
  try {
    const parsed = compiledShotRecipeSchema.safeParse(JSON.parse(recipeSnapshot));
    return parsed.success ? parsed.data.selectionReason ?? null : null;
  } catch {
    return null;
  }
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const workspace = await requireWorkspace();
  const { campaignId: campaignIdParam } = await params;
  const campaignId = Number(campaignIdParam);

  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    notFound();
  }

  const campaign = await getCampaignForTeam(workspace.team.id, campaignId);

  if (!campaign) {
    notFound();
  }

  const [productAsset, activeVideoJob, skillBinding] = await Promise.all([
    getAssetForTeam(workspace.team.id, campaign.productAssetId),
    getActiveVideoJobForCampaign(workspace.team.id, campaign.id),
    getCampaignShotSkillBindingForTeam(workspace.team.id, campaign.id),
  ]);

  const selectionReason = skillBinding?.selectionReason ?? getSelectionReason(activeVideoJob?.recipeSnapshot ?? null);

  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <p className="text-sm font-medium text-orange-600">Campaign</p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
              {campaign.name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {campaign.targetPlatform} · {campaign.durationSeconds}s · {campaign.status}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Product image</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {productAsset?.fileName ?? 'Product image is unavailable.'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Selling points</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
            {campaign.sellingPoints}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-950">Approved execution inputs</h2>
        <p className="text-sm text-muted-foreground">
          Creative direction comes from the versioned Creative Spec. Shot Cards are internal execution records, not customer deliverables.
        </p>
      </section>
      {skillBinding ? (
        <Card>
          <CardHeader>
            <CardTitle>Shot Skill binding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p><span className="font-medium text-gray-950">{skillBinding.skillName}</span> · {skillBinding.stableId} · v{skillBinding.version}</p>
            <p>{selectionReason ?? 'Explicit database Skill version binding.'}</p>
            <p className="font-mono text-xs">Definition hash: {skillBinding.definitionHash}</p>
            <p>Production Prompt is generated from this immutable version and is not editable here.</p>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">Video generation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Production Batches submit approved Creative Specs through the Shot Skill compiler.
          </p>
        </div>
        {activeVideoJob ? (
          <Card>
            <CardContent className="py-5 text-sm text-muted-foreground">
              <p>Video job #{activeVideoJob.id} is {activeVideoJob.status}. Track it in Video jobs.</p>
              {selectionReason ? <p className="mt-2">Skill selection: {selectionReason}.</p> : null}
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            No active job. Schedule this Campaign from its Production Batch.
          </p>
        )}
      </section>
    </div>
  );
}
