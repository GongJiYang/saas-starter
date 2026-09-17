'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { ArrowRight, ImagePlay, Layers3, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BatchCreateWizard } from './batch-create-wizard';

type Batch = {
  id: number;
  name: string;
  status: string;
  generationMode: 'single' | 'bulk';
  targetPlatform: string;
  durationSeconds: number;
  waveSize: number;
  maxEstimatedCostCny: string | null;
  costConfirmedAt: string | null;
  pausedFromStatus: string | null;
  createdAt: string;
};
type Progress = {
  counts: { total: number; pending: number; pilot: number; ready: number; queued: number; generating: number; qualityReview: number; completed: number; failed: number; excluded: number };
  metrics: { actualCostCny: number };
};

async function requestJson(path: string) {
  const response = await fetch(path);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Request failed.');
  return body;
}

function nextStep(batch: Batch): string {
  if (batch.status === 'paused') return `Resume ${batch.pausedFromStatus?.replaceAll('_', ' ') ?? 'the previous stage'}`;
  if (batch.status === 'completed') return 'View completed result';
  if (batch.status === 'cancelled') return 'No further action';
  if (batch.generationMode === 'single') {
    return ({
      draft: 'Create Campaign & Spec',
      ready_for_spec: 'Approve Creative Spec',
      ready_to_generate: batch.costConfirmedAt ? 'Schedule generation' : batch.maxEstimatedCostCny ? 'Confirm cost' : 'Estimate cost',
      generating: 'Wait for generation and QA',
      review: 'Review generated video',
    } as Record<string, string>)[batch.status] ?? batch.status.replaceAll('_', ' ');
  }
  return ({
    draft: 'Select Pilot SKU',
    calibrating: 'Complete Pilot Campaign, Spec, cost, and generation',
    pilot_review: 'Evaluate Pilot gate',
    ready: 'Assign and schedule Waves',
    producing: 'Observe or schedule next Wave',
    reviewing: 'Complete final review',
  } as Record<string, string>)[batch.status] ?? batch.status.replaceAll('_', ' ');
}

export function BatchWorkbench() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [progress, setProgress] = useState<Record<number, Progress>>({});
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void requestJson('/api/production-batches').then((result) => {
      const response = result as { batches: Batch[]; progress: Record<number, Progress> };
      setBatches(response.batches);
      setProgress(response.progress);
      setLoaded(true);
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Could not load Production tasks.');
      setLoaded(true);
    });
  }, []);

  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <p className="text-sm font-medium text-orange-600">Production workspace</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">Production tasks</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Choose a clear mode and ready SKU. Each task then guides one legal next action from Campaign through delivery.</p>
      </section>

      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-gray-100" />}><BatchCreateWizard /></Suspense>
      <Card className="overflow-hidden border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50">
        <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-slate-950 shadow-sm"><ImagePlay className="size-5" /></span>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-orange-700"><Sparkles className="size-3.5" />Dedicated workflow</p>
              <h2 className="mt-1 text-xl font-semibold text-gray-950">Create an Image-to-Video batch</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">Upload reference images, set one shared motion direction, then validate a Pilot before scaling production.</p>
            </div>
          </div>
          <Button asChild className="shrink-0 bg-gray-950 text-white hover:bg-gray-800 hover:text-white">
            <Link href="/dashboard/batches/image-to-video">Open creator<ArrowRight className="size-4" /></Link>
          </Button>
        </CardContent>
      </Card>
      {message ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p> : null}

      <section className="space-y-4">
        <div><h2 className="text-xl font-semibold text-gray-950">Recent tasks</h2><p className="mt-1 text-sm text-muted-foreground">Summary only. Open one task for workflow controls, blockers, timeline, and diagnostics.</p></div>
        {!loaded ? <div aria-label="Production task list loading" className="grid gap-4"><div className="h-40 animate-pulse rounded-xl bg-gray-100" /><div className="h-40 animate-pulse rounded-xl bg-gray-100" /></div> : (
          <div className="grid gap-4">
            {batches.map((batch) => {
              const summary = progress[batch.id];
              return (
                <Card key={batch.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div><CardTitle className="flex items-center gap-2"><Layers3 className="size-5 text-orange-600" />{batch.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">#{batch.id} · {batch.generationMode === 'single' ? 'Single video' : 'Batch production'} · {batch.targetPlatform} · {batch.durationSeconds}s</p></div>
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize">{batch.status.replaceAll('_', ' ')}</span>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                    <Summary label="Progress" value={summary ? `${summary.counts.completed}/${summary.counts.total} completed · ${summary.counts.failed} failed` : 'Loading'} />
                    <Summary label="Cost" value={batch.costConfirmedAt ? `Confirmed ¥${batch.maxEstimatedCostCny}` : batch.maxEstimatedCostCny ? `Estimate ¥${batch.maxEstimatedCostCny}` : 'Not estimated'} />
                    <Summary label="Next" value={nextStep(batch)} />
                    <Button asChild><Link href={`/dashboard/batches/${batch.id}`}>Open task<ArrowRight className="ml-2 size-4" /></Link></Button>
                  </CardContent>
                </Card>
              );
            })}
            {batches.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No Production tasks yet. Create the first guided task above.</CardContent></Card> : null}
          </div>
        )}
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium text-gray-950">{value}</p></div>;
}
