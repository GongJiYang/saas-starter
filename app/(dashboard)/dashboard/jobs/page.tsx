import Link from 'next/link';
import { Download, ListVideo } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listVideoJobsWithCampaignForTeam } from '@/lib/db/video-job-queries';
import { requireWorkspace } from '@/lib/workspace/access';

const statusLabels = {
  failed: 'Failed',
  generating: 'Generating',
  queued: 'Queued',
  succeeded: 'Completed',
} as const;

export default async function JobsPage() {
  const workspace = await requireWorkspace();
  const jobs = await listVideoJobsWithCampaignForTeam(workspace.team.id);

  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <div className="flex items-center gap-2 text-sm font-medium text-orange-600">
          <ListVideo className="size-4" />
          Video jobs
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">
          Generation queue
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Track MiniMax submissions, processing failures, and completed videos.
        </p>
      </section>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No video jobs yet. Prepare a Single task, or pass the Pilot gate for a Bulk Batch.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{job.campaignName}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Submitted {job.createdAt.toLocaleString()}
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                  {statusLabels[job.status]}
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                {job.failureReason ? (
                  <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {job.failureCode ? `${job.failureCode}: ` : ''}
                    {job.failureReason}
                  </div>
                ) : null}
                {job.status === 'failed' ? <p className="text-sm text-muted-foreground">Retry is available only after a structured technical QA result.</p> : null}
                {job.status === 'succeeded' && job.outputAssetId ? (
                  <Link
                    className="inline-flex items-center gap-2 text-sm font-medium text-orange-700 hover:text-orange-800"
                    href={`/api/assets/${job.outputAssetId}/download`}
                  >
                    <Download className="size-4" />
                    Download {job.outputFileName ?? 'video'}
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
