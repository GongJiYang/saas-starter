import Link from 'next/link';
import { ClipboardCheck, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listPendingReviewJobsForTeam } from '@/lib/db/review-queries';
import { requireWorkspace } from '@/lib/workspace/access';
import { AdoptVideoForm, RejectVideoForm } from './review-forms';
import { parseRecordedQualityReport, qualityRemediationSuggestions } from '@/lib/quality/gates';

function getSkillQaReport(value: string) {
  try {
    return parseRecordedQualityReport(JSON.parse(value))?.skill ?? null;
  } catch {
    return null;
  }
}

export default async function ReviewsPage() {
  const workspace = await requireWorkspace();
  const pendingReviews = await listPendingReviewJobsForTeam(workspace.team.id);

  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <div className="flex items-center gap-2 text-sm font-medium text-orange-600">
          <ClipboardCheck className="size-4" />
          Reviews
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">
          Approve generated videos
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Adopt a completed video or record why it should not be used.
        </p>
      </section>

      {pendingReviews.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No completed videos are waiting for review.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {pendingReviews.map((review) => {
            const skillQa = getSkillQaReport(review.qualityReport);
            return (
              <Card key={review.videoJobId}>
                {skillQa ? (
                  <div className={`border-b px-6 py-4 text-sm ${skillQa.passed ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-red-100 bg-red-50 text-red-800'}`}>
                    <p className="font-medium">
                      Skill QA · {skillQa.skillId} v{skillQa.skillVersion} · {skillQa.passed ? 'passed' : 'blocking failures'}
                    </p>
                    {skillQa.checks.some((check) => !check.passed) ? (
                      <ul className="mt-3 grid gap-3">
                        {skillQa.checks.filter((check) => !check.passed).map((check) => (
                          <li className="rounded-md border border-current/20 bg-white/70 p-3" key={check.code}>
                            <div className="flex flex-wrap items-center gap-2 font-medium">
                              <span>{check.code}</span>
                              <span className="rounded-full border border-current/30 px-2 py-0.5 text-xs uppercase">
                                {check.severity}
                              </span>
                              <span className="text-xs">Cause: {check.failureCause}</span>
                            </div>
                            <div className="mt-2">
                              <p className="font-medium">Evidence</p>
                              <ul className="mt-1 list-disc space-y-1 pl-5">
                                {check.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}
                              </ul>
                            </div>
                            <p className="mt-2">
                              <span className="font-medium">Remediation:</span>{' '}
                              {qualityRemediationSuggestions[check.remediationCategory]}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-800">
                    Frozen Skill QA evidence is missing or invalid. Adoption is prohibited.
                  </div>
                )}
                <CardHeader>
                  <CardTitle>{review.campaignName}</CardTitle>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-orange-100 px-2 py-1 font-medium text-orange-800">
                      {review.generationMode === 'single' ? 'Single video' : review.isPilot ? 'Batch Pilot' : review.waveNumber ? `Batch Wave ${review.waveNumber}` : 'Batch production'}
                    </span>
                    {review.externalSku ? <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700">{review.externalSku} · {review.productName}</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Completed {review.completedAt?.toLocaleString() ?? 'recently'}
                  </p>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <p><span className="font-medium text-gray-900">Frozen Skill:</span> {review.shotSkillId && review.shotSkillVersion ? `${review.shotSkillId} v${review.shotSkillVersion}` : 'Legacy job without frozen Skill'}</p>
                    <p><span className="font-medium text-gray-900">Approved Spec:</span> {review.creativeSpecVersionId && review.creativeSpecVersion ? <Link className="text-orange-700 underline" href={`/dashboard/specs#spec-${review.creativeSpecVersionId}`}>v{review.creativeSpecVersion}</Link> : 'Legacy job without bound Spec'}</p>
                    {review.batchId ? <p className="sm:col-span-2"><Link className="text-orange-700 underline" href={`/dashboard/batches/${review.batchId}`}>Open {review.batchName ?? 'Production task'}</Link></p> : null}
                  </div>
                </CardHeader>
                <CardContent className="grid gap-5">
                  {review.outputAssetId ? (
                    <video
                      aria-label={`${review.campaignName} generated video`}
                      className="aspect-video w-full rounded-md bg-black"
                      controls
                      preload="none"
                      src={`/api/assets/${review.outputAssetId}/download`}
                    />
                  ) : null}
                  {review.outputAssetId ? (
                    <Link
                      className="inline-flex w-fit items-center gap-2 text-sm font-medium text-orange-700 hover:text-orange-800"
                      href={`/api/assets/${review.outputAssetId}/download`}
                    >
                      <Download className="size-4" />
                      Download {review.outputFileName ?? 'video'}
                    </Link>
                  ) : null}
                  <div className="flex flex-col gap-4 border-t border-gray-100 pt-5 sm:flex-row sm:items-start sm:justify-between">
                    <AdoptVideoForm videoJobId={review.videoJobId} />
                    <RejectVideoForm videoJobId={review.videoJobId} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
