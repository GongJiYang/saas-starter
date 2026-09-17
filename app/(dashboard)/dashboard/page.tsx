import Link from 'next/link';
import { Activity, ClipboardCheck, Clapperboard, ImagePlay, Plus, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getWorkspaceOverview } from '@/lib/db/workspace-queries';
import { requireWorkspace } from '@/lib/workspace/access';

const jobStatusLabels = {
  queued: 'Queued',
  generating: 'Generating',
  succeeded: 'Completed',
  failed: 'Failed',
} as const;

export default async function WorkspacePage() {
  const workspace = await requireWorkspace();
  const overview = await getWorkspaceOverview(workspace.team.id);
  const summaryCards = [
    {
      icon: Clapperboard,
      label: 'Campaigns',
      value: overview.campaignCount,
    },
    {
      icon: Activity,
      label: 'In queue',
      value: overview.activeJobCount,
    },
    {
      icon: ClipboardCheck,
      label: 'Ready for review',
      value: overview.readyForReviewCount,
    },
  ];

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-orange-600">Workspace</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">
            {workspace.team.name}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Monitor SKU Campaign creative packages, candidate generation, and review decisions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="inline-flex items-center rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700" href="/dashboard/catalog/new"><Plus className="mr-2 size-4" />Add product</Link>
          <Link className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50" href="/dashboard/batches">Open production tasks</Link>
          <span className="w-fit rounded-full bg-gray-100 px-3 py-2 text-sm font-medium capitalize text-gray-700">
            {workspace.role}
          </span>
        </div>
      </section>

      <section aria-label="Workspace summary" className="grid gap-4 sm:grid-cols-3">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <card.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tracking-tight">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent production tasks</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload and generation tasks remain here after you leave their creator.
            </p>
          </div>
          <ImagePlay className="size-5 text-orange-600" />
        </CardHeader>
        <CardContent>
          {overview.recentProductionBatches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No production tasks yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {overview.recentProductionBatches.map((batch) => (
                <li key={batch.id}>
                  <Link
                    className="flex items-center justify-between gap-4 py-4 hover:text-orange-700"
                    href={`/dashboard/batches/${batch.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{batch.name}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {batch.sourceMode === 'uploaded_images'
                          ? 'Image-to-video upload'
                          : batch.generationMode === 'single'
                            ? 'Single video'
                            : 'Catalog batch'}
                        {' · '}
                        {batch.createdAt.toLocaleString()}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium capitalize text-gray-700">
                      {batch.status.replaceAll('_', ' ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            className="mt-3 inline-flex text-sm font-medium text-orange-700 hover:text-orange-800"
            href="/dashboard/batches"
          >
            View all production tasks
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent candidate activity</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Latest candidate executions submitted by this workspace.
            </p>
          </div>
          <Sparkles className="size-5 text-orange-600" />
        </CardHeader>
        <CardContent>
          {overview.recentJobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No candidate videos have been generated yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {overview.recentJobs.map((job) => (
                <li className="flex items-center justify-between gap-4 py-4" key={job.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-950">{job.campaignName}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {job.shotCardTitle}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                    {jobStatusLabels[job.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
