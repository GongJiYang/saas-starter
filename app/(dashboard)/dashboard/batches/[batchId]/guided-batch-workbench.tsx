'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, ClipboardList, Download, Pause, Play, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BatchFeedback } from '../batch-feedback';
import { BatchTable } from '../batch-table';

type Detail = {
  batch: {
    id: number;
    name: string;
    status: string;
    generationMode: 'single' | 'bulk';
    targetPlatform: string;
    durationSeconds: number;
    waveSize: number;
    maxEstimatedCostCny: string | null;
    costConfirmedAt: string | null;
    pausedReason: string | null;
    pausedFromStatus: string | null;
    createdAt: string;
  };
  items: Array<{
    item: { id: number; status: string; isPilot: boolean; waveNumber: number; campaignId: number | null; creativeSpecVersionId: number | null };
    catalogItem: { id: number; externalSku: string; productName: string; readinessStatus: string; primaryAssetId: number | null; brandKitName: string; detailImageCount: number };
    campaign: { id: number; name: string; createdAt: string } | null;
    boundSpec: { id: number; version: string; status: string; approvedAt: string | null } | null;
    latestSpec: { id: number; version: string; status: string } | null;
    latestJob: { id: number; status: string; outputAssetId: number | null; failureReason: string | null; attempts: number } | null;
    latestReview: { decision: string; reason: string | null } | null;
  }>;
  progress: {
    counts: { total: number; pending: number; pilot: number; ready: number; queued: number; generating: number; qualityReview: number; completed: number; failed: number; excluded: number };
    metrics: { retryCount: number; supplierErrorCount: number; actualCostCny: number; averageCompletionSeconds: number };
  };
  skillBindings: Array<{ shotSkillVersionId: number; skillName: string; stableId: string; version: string; definitionHash: string; selectionReason: string }>;
  blockers: Array<{ code: string; message: string; href: string | null; label: string | null }>;
  timeline: Array<{ at: string; type: string; label: string; detail: string }>;
  diagnostics: { batchId: number; itemIds: number[]; catalogItemIds: number[]; campaignIds: number[]; specVersionIds: number[]; shotSkillVersionIds: number[]; videoJobIds: number[] };
};

type GuidedAction =
  | { kind: 'action'; action: string; label: string; body?: Record<string, unknown> }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'refresh'; label: string }
  | null;
type CustomerRemediation = { action: string; label: string; href: string };

class WorkflowRequestError extends Error {
  constructor(message: string, readonly remediations: CustomerRemediation[]) {
    super(message);
    this.name = 'WorkflowRequestError';
  }
}

const steps = ['SKU', 'Campaign', 'Spec', 'Cost', 'Generation', 'QA', 'Review', 'Complete'] as const;

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = body && typeof body === 'object' ? body as { error?: unknown; remediations?: unknown } : {};
    const remediations = Array.isArray(payload.remediations)
      ? payload.remediations.filter((item): item is CustomerRemediation => Boolean(
        item && typeof item === 'object'
        && typeof (item as CustomerRemediation).action === 'string'
        && typeof (item as CustomerRemediation).label === 'string'
        && typeof (item as CustomerRemediation).href === 'string',
      ))
      : [];
    throw new WorkflowRequestError(typeof payload.error === 'string' ? payload.error : 'Request failed.', remediations);
  }
  return body;
}

function completedSteps(detail: Detail): boolean[] {
  const relevant = detail.batch.generationMode === 'bulk' && ['calibrating', 'pilot_review'].includes(detail.batch.status)
    ? detail.items.filter((row) => row.item.isPilot)
    : detail.items;
  const hasJobs = relevant.some((row) => row.latestJob);
  const hasQa = relevant.some((row) => row.latestJob?.status === 'succeeded');
  const hasReview = relevant.some((row) => row.latestReview);
  return [
    detail.items.length > 0,
    relevant.length > 0 && relevant.every((row) => row.campaign),
    relevant.length > 0 && relevant.every((row) => row.boundSpec?.status === 'approved'),
    Boolean(detail.batch.costConfirmedAt),
    hasJobs,
    hasQa,
    hasReview,
    detail.batch.status === 'completed',
  ];
}

function nextGuidedAction(detail: Detail): GuidedAction {
  const { batch, items } = detail;
  if (batch.status === 'completed' || batch.status === 'cancelled') return null;
  if (batch.status === 'paused') return { kind: 'action', action: 'resume', label: `Resume to ${batch.pausedFromStatus?.replaceAll('_', ' ') ?? 'previous stage'}` };
  if (batch.generationMode === 'single') {
    const item = items[0];
    if (!item) return null;
    if (!item.campaign || !item.latestSpec) return { kind: 'action', action: 'create-item-spec', body: { itemId: item.item.id }, label: 'Create Campaign & Spec' };
    if (!item.boundSpec || item.boundSpec.status !== 'approved') return { kind: 'link', href: `/dashboard/specs#spec-${item.latestSpec.id}`, label: item.latestSpec.status === 'draft' ? 'Submit Creative Spec' : 'Review Creative Spec approval' };
    if (!batch.maxEstimatedCostCny) return { kind: 'action', action: 'estimate-cost', label: 'Estimate production cost' };
    if (!batch.costConfirmedAt) return { kind: 'action', action: 'confirm-cost', body: { expectedMaxEstimatedCostCny: Number(batch.maxEstimatedCostCny) }, label: `Confirm ¥${batch.maxEstimatedCostCny}` };
    if (batch.status === 'ready_to_generate') return { kind: 'action', action: 'schedule-single', label: 'Schedule video generation' };
    if (batch.status === 'review') return { kind: 'link', href: '/dashboard/reviews', label: 'Review generated video' };
    return { kind: 'refresh', label: 'Refresh generation status' };
  }

  const pilots = items.filter((row) => row.item.isPilot);
  if (batch.status === 'draft' || pilots.length === 0) return { kind: 'action', action: 'select-pilots', label: 'Select Pilot SKU' };
  if (batch.status === 'calibrating') {
    if (pilots.some((row) => !row.campaign || !row.latestSpec)) return { kind: 'action', action: 'create-pilot-specs', label: 'Create Pilot Campaigns & Specs' };
    const pendingSpec = pilots.find((row) => !row.boundSpec || row.boundSpec.status !== 'approved');
    if (pendingSpec?.latestSpec) return { kind: 'link', href: `/dashboard/specs#spec-${pendingSpec.latestSpec.id}`, label: 'Approve Pilot Creative Specs' };
    if (!batch.maxEstimatedCostCny) return { kind: 'action', action: 'estimate-cost', label: 'Estimate Pilot cost' };
    if (!batch.costConfirmedAt) return { kind: 'action', action: 'confirm-cost', body: { expectedMaxEstimatedCostCny: Number(batch.maxEstimatedCostCny) }, label: `Confirm ¥${batch.maxEstimatedCostCny}` };
    if (!pilots.some((row) => row.latestJob)) return { kind: 'action', action: 'schedule-pilot', label: 'Schedule Pilot generation' };
    return { kind: 'link', href: '/dashboard/reviews', label: 'Review Pilot outputs' };
  }
  if (batch.status === 'pilot_review') return { kind: 'action', action: 'evaluate-pilot', label: 'Evaluate Pilot gate' };
  if (batch.status === 'ready') {
    if (!batch.costConfirmedAt) return !batch.maxEstimatedCostCny
      ? { kind: 'action', action: 'estimate-cost', label: 'Estimate production cost' }
      : { kind: 'action', action: 'confirm-cost', body: { expectedMaxEstimatedCostCny: Number(batch.maxEstimatedCostCny) }, label: `Confirm ¥${batch.maxEstimatedCostCny}` };
    if (items.some((row) => !row.item.isPilot && row.item.waveNumber === 0)) return { kind: 'action', action: 'assign-waves', label: 'Assign production Waves' };
    return { kind: 'action', action: 'schedule-wave', label: 'Schedule next Wave' };
  }
  if (batch.status === 'producing') return { kind: 'action', action: 'schedule-wave', label: 'Schedule next ready Wave' };
  if (batch.status === 'reviewing') return { kind: 'link', href: '/dashboard/reviews', label: 'Complete output review' };
  return { kind: 'refresh', label: 'Refresh task status' };
}

export function GuidedBatchWorkbench({ batchId }: { batchId: number }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState('');
  const [remediations, setRemediations] = useState<CustomerRemediation[]>([]);
  const [busy, setBusy] = useState(false);
  const [showPauseConfirmation, setShowPauseConfirmation] = useState(false);
  function showError(error: unknown, fallback: string) {
    setMessage(error instanceof Error ? error.message : fallback);
    setRemediations(error instanceof WorkflowRequestError ? error.remediations : []);
  }

  async function load() {
    const result = await requestJson(`/api/production-batches/${batchId}/detail`) as { detail: Detail };
    setDetail(result.detail);
  }

  useEffect(() => {
    void load().catch((error: unknown) => showError(error, 'Could not load Production task.'));
  }, [batchId]);

  async function run(action: string, body?: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    setRemediations([]);
    try {
      await requestJson(`/api/production-batches/${batchId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      setMessage(`${action.replaceAll('-', ' ')} completed.`);
      setShowPauseConfirmation(false);
      await load();
    } catch (error) {
      showError(error, 'Production task action failed.');
    } finally {
      setBusy(false);
    }
  }

  const completion = useMemo(() => detail ? completedSteps(detail) : [], [detail]);
  const nextAction = useMemo(() => detail ? nextGuidedAction(detail) : null, [detail]);

  if (!detail) {
    return (
      <div aria-label="Production task loading" className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        {message ? <p className="text-sm text-red-700">{message}</p> : null}
      </div>
    );
  }

  const pausable = detail.batch.generationMode === 'single'
    ? ['ready_for_spec', 'ready_to_generate', 'generating', 'review'].includes(detail.batch.status)
    : ['calibrating', 'pilot_review', 'ready', 'producing', 'reviewing'].includes(detail.batch.status);
  const cancellable = ['draft', 'ready_for_spec', 'calibrating'].includes(detail.batch.status);
  const adoptedOutputs = detail.items.filter((row) => row.latestReview?.decision === 'adopted' && row.latestJob?.outputAssetId);
  const activeItemCount = detail.items.filter((row) => !['completed', 'excluded'].includes(row.item.status)).length;

  return (
    <div className="space-y-6">
      <section className="border-b border-gray-200 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-orange-600">{detail.batch.generationMode === 'single' ? 'Single video' : 'Batch production'}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">{detail.batch.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{detail.batch.targetPlatform} · {detail.batch.durationSeconds}s · {detail.items.length} SKU · {detail.batch.status.replaceAll('_', ' ')}</p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize text-gray-700">{detail.batch.status.replaceAll('_', ' ')}</span>
        </div>
      </section>

      <Card>
        <CardHeader><CardTitle>Production path</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {steps.map((step, index) => {
              const complete = completion[index];
              const current = !complete && completion.slice(0, index).every(Boolean);
              return <li className={`rounded-lg border p-3 text-xs ${complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : current ? 'border-orange-300 bg-orange-50 text-orange-900' : 'bg-gray-50 text-muted-foreground'}`} key={step}><span className="mb-2 flex size-6 items-center justify-center rounded-full bg-white font-semibold">{complete ? <Check className="size-3" /> : index + 1}</span>{step}</li>;
            })}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-orange-200 bg-orange-50/40" id="next-action">
        <CardHeader><CardTitle>Next action</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {nextAction?.kind === 'link' ? <Button asChild><Link href={nextAction.href}>{nextAction.label}<ChevronRight className="ml-2 size-4" /></Link></Button> : null}
          {nextAction?.kind === 'action' ? <Button disabled={busy} onClick={() => void run(nextAction.action, nextAction.body)}>{nextAction.label}<ChevronRight className="ml-2 size-4" /></Button> : null}
          {nextAction?.kind === 'refresh' ? <Button disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 size-4" />{nextAction.label}</Button> : null}
          {!nextAction ? <p className="text-sm text-emerald-800">This production task has no remaining workflow action.</p> : null}
          {detail.batch.status === 'paused' ? <p className="text-sm text-amber-900">Resume returns to <b>{detail.batch.pausedFromStatus?.replaceAll('_', ' ') ?? 'the previous stage'}</b>. Next: {nextAction?.label}.</p> : null}
        </CardContent>
      </Card>
      {detail.batch.status === 'completed' && adoptedOutputs.length ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader><CardTitle>Completed delivery</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-emerald-900">{detail.batch.generationMode === 'single' ? 'The adopted video is ready to download.' : `${adoptedOutputs.length} adopted videos are ready to deliver.`}</p>
            <div className="flex flex-wrap gap-3">
              {adoptedOutputs.map((row) => <Button asChild key={row.latestJob!.id} variant="outline"><a href={`/api/assets/${row.latestJob!.outputAssetId}/download`}><Download className="mr-2 size-4" />Download {row.catalogItem.externalSku}</a></Button>)}
              <Button asChild variant="outline"><a href={`/api/production-batches/${batchId}/adopted-export`}><Download className="mr-2 size-4" />Export adopted manifest</a></Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-4">
        <Precheck title="SKU & Brand" passed={detail.items.every((row) => row.catalogItem.readinessStatus === 'ready')} detail={detail.items.map((row) => `${row.catalogItem.externalSku} · ${row.catalogItem.brandKitName}`).join('; ')} />
        <Precheck title="Materials" passed={detail.items.every((row) => Boolean(row.catalogItem.primaryAssetId))} detail={detail.items.map((row) => `${row.catalogItem.externalSku}: primary ${row.catalogItem.primaryAssetId ? 'ready' : 'missing'}, ${row.catalogItem.detailImageCount} detail`).join('; ')} />
        <Precheck title="Shot Skill" passed={detail.skillBindings.length > 0} detail={detail.skillBindings.map((binding) => `${binding.skillName} v${binding.version}`).join('; ') || 'No frozen version'} />
        <Precheck title="Duration & Cost" passed={Boolean(detail.batch.costConfirmedAt)} detail={`${detail.batch.durationSeconds}s · ${detail.batch.costConfirmedAt ? `confirmed ¥${detail.batch.maxEstimatedCostCny}` : detail.batch.maxEstimatedCostCny ? `estimate ¥${detail.batch.maxEstimatedCostCny} not confirmed` : 'estimate pending'}`} />
      </section>

      {detail.blockers.length ? (
        <Card className="border-amber-200">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-600" />Blocking items</CardTitle></CardHeader>
          <CardContent><ul className="space-y-3">{detail.blockers.map((blocker, index) => <li className="rounded-md bg-amber-50 p-3 text-sm text-amber-950" key={`${blocker.code}-${index}`}>{blocker.message}{blocker.href && blocker.label ? <Link className="ml-2 font-medium underline" href={blocker.href}>{blocker.label}</Link> : null}</li>)}</ul></CardContent>
        </Card>
      ) : null}

      {message ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <p>{message}</p>
          {remediations.length ? <div className="mt-2 flex flex-wrap gap-3">{remediations.map((remediation) => <Link className="font-medium underline" href={remediation.href} key={`${remediation.action}-${remediation.href}`}>{remediation.label}</Link>)}</div> : null}
        </div>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Task controls</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {pausable && detail.batch.status !== 'paused' ? <Button disabled={busy} variant="outline" onClick={() => setShowPauseConfirmation(true)}><Pause className="mr-2 size-4" />Pause</Button> : null}
          {detail.batch.status === 'paused' ? <Button disabled={busy} variant="outline" onClick={() => void run('resume')}><Play className="mr-2 size-4" />Resume to {detail.batch.pausedFromStatus?.replaceAll('_', ' ')}</Button> : null}
          {cancellable ? <Button disabled={busy} variant="outline" onClick={() => void run('cancel')}><X className="mr-2 size-4" />Cancel task</Button> : null}
          <Button disabled={busy} variant="outline" onClick={() => void load()}><RotateCcw className="mr-2 size-4" />Refresh</Button>
        </CardContent>
      </Card>

      <BatchTable batchId={batchId} generationMode={detail.batch.generationMode} active={['generating', 'producing', 'calibrating', 'pilot_review', 'review', 'reviewing'].includes(detail.batch.status)} />
      {detail.batch.generationMode === 'bulk' ? <BatchFeedback batchId={batchId} /> : null}

      <Card>
        <CardHeader><CardTitle>Operation timeline</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-4 border-l border-gray-200 pl-5">{detail.timeline.map((event, index) => <li key={`${event.type}-${event.at}-${index}`}><p className="text-sm font-medium text-gray-950">{event.label}</p><p className="text-xs text-muted-foreground">{new Date(event.at).toLocaleString()} · {event.detail}</p></li>)}</ol>
        </CardContent>
      </Card>

      <details className="rounded-lg border bg-gray-50 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-950"><ClipboardList className="mr-2 inline size-4" />Advanced diagnostics</summary>
        <p className="mt-2 text-xs text-muted-foreground">Copy these identifiers only when troubleshooting with support.</p>
        <pre className="mt-3 overflow-auto rounded-md bg-white p-3 text-xs">{JSON.stringify({ ...detail.diagnostics, skillBindings: detail.skillBindings }, null, 2)}</pre>
      </details>

      {showPauseConfirmation ? (
        <div aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog">
          <Card className="w-full max-w-lg">
            <CardHeader><CardTitle>Pause this production task?</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>Pause affects {activeItemCount} active SKU and prevents new generation work from being scheduled. Running provider requests may still finish and will remain recorded.</p>
              <p>Resume will return to <b>{detail.batch.status.replaceAll('_', ' ')}</b>.</p>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setShowPauseConfirmation(false)}>Keep running</Button><Button disabled={busy} onClick={() => void run('pause')}>Pause task</Button></div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Precheck({ title, passed, detail }: { title: string; passed: boolean; detail: string }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="text-sm"><p className={passed ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>{passed ? 'Ready' : 'Needs attention'}</p><p className="mt-2 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}
