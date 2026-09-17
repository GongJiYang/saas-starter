import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listCampaignsForTeam } from '@/lib/db/video-queries';
import { requireWorkspace } from '@/lib/workspace/access';

export default async function CampaignsPage() {
  const workspace = await requireWorkspace();
  const campaigns = await listCampaignsForTeam(workspace.team.id);

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-orange-600">Campaigns</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">
            SKU Campaign creative packages
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Campaigns are created from Production Batch SKU and retain their frozen Brief and approved Creative Spec.
          </p>
        </div>
      </section>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No Campaigns yet. Commit ready SKU to a Production Batch to create Campaigns.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => (
            <Card key={campaign.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>
                    <Link className="hover:text-orange-700" href={`/dashboard/campaigns/${campaign.id}`}>
                      {campaign.name}
                    </Link>
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {campaign.targetPlatform} · {campaign.durationSeconds}s
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium capitalize text-gray-700">
                  {campaign.status}
                </span>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {campaign.sellingPoints}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
