'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock3, ImageIcon, Loader2, RotateCw, Save, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ImageDetail = {
  batch: { id: number; name: string; sourceMode: string; status: string; sharedPrompt: string; sharedPromptVersion: number; durationSeconds: number; targetPlatform: string; costConfirmedAt: string | null; maxEstimatedCostCny: string | null };
  items: Array<{ item: { id: number; sequence: number; promptMode: 'inherit' | 'override'; promptOverride: string | null; status: string; isPilot: boolean }; catalogItem: { productName: string; primaryAssetId: number | null; externalSku: string }; latestJob: { id: number; status: string; outputAssetId: number | null; failureCode: string | null; failureReason: string | null; externalTaskId: string | null; recipeSnapshot: string | null; createdAt: string; updatedAt: string; completedAt: string | null } | null; latestReview: { decision: string } | null }>;
  progress: { counts: { total: number; pending: number; pilot: number; ready: number; queued: number; generating: number; qualityReview: number; completed: number; failed: number; excluded: number }; metrics: { actualCostCny: number; retryCount: number } };
  timeline: Array<{ at: string; type: string; label: string; detail: string }>;
  diagnostics: { batchId: number; itemIds: number[]; videoJobIds: number[] };
};

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Request failed.');
  return body;
}

export function ImageToVideoWorkbench({ batchId }: { batchId: number }) {
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [sharedPrompt, setSharedPrompt] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [reviewReason, setReviewReason] = useState('');
  const [rejectionCause, setRejectionCause] = useState<'technical' | 'fidelity' | 'spec_mismatch' | 'preference_change' | 'brief_change'>('technical');
  const [costEstimate, setCostEstimate] = useState<number | null>(null);
  async function load() {
    const result = await requestJson(`/api/production-batches/${batchId}/detail`) as { detail: ImageDetail };
    setDetail(result.detail);
    setSharedPrompt(result.detail.batch.sharedPrompt);
    const first = result.detail.items.find((item) => item.item.id === selectedItemId) ?? result.detail.items[0];
    if (first) {
      setSelectedItemId(first.item.id);
      setCustomPrompt(first.item.promptOverride ?? result.detail.batch.sharedPrompt);
    }
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load Image-to-Video Batch.')); }, [batchId]);
  useEffect(() => {
    if (!detail || (detail.progress.counts.queued === 0 && detail.progress.counts.generating === 0)) return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 10_000);
    return () => window.clearInterval(timer);
  }, [detail?.progress.counts.queued, detail?.progress.counts.generating]);

  const selected = useMemo(() => detail?.items.find((item) => item.item.id === selectedItemId) ?? null, [detail, selectedItemId]);
  const inheritedCount = detail?.items.filter((item) => item.item.promptMode === 'inherit').length ?? 0;
  const customCount = detail?.items.filter((item) => item.item.promptMode === 'override').length ?? 0;
  const pilotCount = detail?.items.filter((item) => item.item.isPilot).length ?? 0;
  const pilotItems = detail?.items.filter((item) => item.item.isPilot) ?? [];
  const addingPilots = detail?.batch.status === 'pilot_review';
  const remainingPilotSlots = Math.max(0, 3 - pilotCount);
  const selectedReadyItemCount = detail?.items.filter((item) => selectedItemIds.includes(item.item.id) && !item.item.isPilot && item.item.status === 'ready').length ?? 0;
  const canSelectPilots = !detail || ['draft', 'ready_for_spec', 'calibrating'].includes(detail.batch.status) || (addingPilots && remainingPilotSlots > 0);
  const canScheduleBatch = detail?.batch.status === 'ready' || detail?.batch.status === 'producing';
  const submittablePilotCount = pilotItems.filter((item) => item.item.status === 'pilot').length;
  const confirmationCost = costEstimate ?? (!detail?.batch.costConfirmedAt && detail?.batch.maxEstimatedCostCny !== null ? Number(detail?.batch.maxEstimatedCostCny) : null);


  const isStale = (item: ImageDetail['items'][number]) => {
    if (item.item.promptMode !== 'inherit' || !item.latestJob?.recipeSnapshot) return false;
    try {
      const snapshot = JSON.parse(item.latestJob.recipeSnapshot) as { sharedPromptVersion?: number };
      return typeof snapshot.sharedPromptVersion === 'number' && snapshot.sharedPromptVersion !== detail?.batch.sharedPromptVersion;
    } catch {
      return false;
    }
  };
  const staleCount = detail?.items.filter(isStale).length ?? 0;

  async function restoreSelectedShared() {
    if (selectedItemIds.length === 0) return;
    setBusy(true); setMessage('');
    try {
      await requestJson(`/api/production-batches/${batchId}/items/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: selectedItemIds }) });
      setMessage(`${selectedItemIds.length} items now inherit Shared Prompt.`);
      setSelectedItemIds([]);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Selected items could not be restored.');
    } finally {
      setBusy(false);
    }
  }
  async function saveShared() {
    setBusy(true); setMessage('');
    try { await requestJson(`/api/production-batches/${batchId}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: sharedPrompt }) }); setMessage('Shared Prompt saved.'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Shared Prompt could not be saved.'); }
    finally { setBusy(false); }
  }

  async function saveItem(mode: 'inherit' | 'override') {
    if (!selectedItemId) return;
    setBusy(true); setMessage('');
    try { await requestJson(`/api/production-batches/${batchId}/items/${selectedItemId}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, prompt: mode === 'override' ? customPrompt : undefined }) }); setMessage(mode === 'inherit' ? 'Item now inherits Shared Prompt.' : 'Custom Prompt saved for this item.'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Item Prompt could not be saved.'); }
    finally { setBusy(false); }
  }

  async function runAction(action: string, body?: unknown) {
    const actionLabels: Record<string, string> = {
      'image-eligibility': '检查生成条件',
      'estimate-cost': '估算费用',
      'confirm-cost': '确认费用',
      'select-image-pilots': '设为试生成',
      'schedule-image-pilot': '生成试片',
      'evaluate-pilot': '评估试片',
      'schedule-image-batch': '生成下一批',
      'retry-image-failed': '重试失败任务',
      'regenerate-image-items': '按当前提示词重新生成',
      pause: '暂停',
      resume: '恢复',
    };
    setBusy(true); setMessage('');
    try {
      const result = await requestJson(`/api/production-batches/${batchId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      setMessage(`${actionLabels[action] ?? action}已完成。`);
      await load();
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : `${action} failed.`;
      setMessage(
        detail.includes('Cost confirmation is stale')
          ? '费用确认已失效。请依次点击“估算费用”→“确认 ¥金额”后，再提交生成。'
          : detail,
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function estimateAndConfirm() {
    const result = await runAction('estimate-cost') as { estimate?: { maxEstimatedCostCny: number } } | null;
    if (!result?.estimate) return;
    setCostEstimate(result.estimate.maxEstimatedCostCny);
  }

  async function selectPilots() {
    const result = await runAction(
      'select-image-pilots',
      selectedItemIds.length ? { itemIds: selectedItemIds } : {},
    ) as { selectedItemIds?: number[] } | null;
    if (!result?.selectedItemIds) return;
    setSelectedItemIds([]);
    setMessage(addingPilots
      ? `${result.selectedItemIds.length} image${result.selectedItemIds.length === 1 ? '' : 's'} added as Pilot${result.selectedItemIds.length === 1 ? '' : 's'}.`
      : `${result.selectedItemIds.length} Pilot image${result.selectedItemIds.length === 1 ? '' : 's'} selected.`);
  }
  async function submitPilots() {
    const result = await runAction('schedule-image-pilot') as { queued?: number; videoJobIds?: number[] } | null;
    if (!result) return;
    setMessage(
      result.queued
        ? `已提交 ${result.queued} 条试片任务，正在生成。`
        : '没有可提交的试片。当前试片已完成；如需新版本，请选中素材后使用“按当前提示词重新生成”。',
    );
  }


  async function retryPilot(itemId: number) {
    const result = await runAction('retry-image-failed', { itemIds: [itemId] }) as { queued?: number } | null;
    if (!result) return;
    setSelectedItemIds([]);
    setMessage('Pilot retry queued. Status refreshes automatically while it runs.');
  }

  async function reviewSelected(decision: 'adopted' | 'not_adopted') {
    const jobs = detail?.items.filter((item) => selectedItemIds.includes(item.item.id) && item.latestJob?.status === 'succeeded' && !item.latestReview).map((item) => item.latestJob!.id) ?? [];
    if (jobs.length === 0) return setMessage('Select completed, unreviewed videos.');
    if (decision === 'not_adopted' && !reviewReason.trim()) return setMessage('Enter a rejection reason first.');
    setBusy(true); setMessage('');
    try {
      await requestJson(`/api/production-batches/${batchId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoJobIds: jobs, decision, reason: decision === 'not_adopted' ? reviewReason : null, rejectionCause: decision === 'not_adopted' ? rejectionCause : null }),
      });
      setSelectedItemIds([]); setReviewReason(''); setMessage(`${jobs.length} video review${jobs.length === 1 ? '' : 's'} recorded.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Review could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <div className="h-96 animate-pulse rounded-xl bg-slate-900" />;
  return (
    <div className="min-h-[calc(100vh-8rem)] space-y-5 bg-slate-950 p-5 text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5"><div><Link className="text-sm text-orange-400" href="/dashboard/batches">← Production tasks</Link><p className="mt-3 text-xs uppercase tracking-[0.2em] text-orange-400">Image-to-Video Workspace</p><h1 className="mt-1 text-2xl font-semibold">{detail.batch.name}</h1><p className="mt-1 text-sm text-slate-400">{detail.batch.targetPlatform} · {detail.batch.durationSeconds}s · {detail.items.length} images · {detail.batch.status}</p></div><div className="text-right text-sm text-slate-300"><p>{detail.progress.counts.completed}/{detail.progress.counts.total} completed</p><p className="text-xs text-slate-500">{detail.progress.counts.generating} generating · {detail.progress.counts.failed} failed · ¥{detail.progress.metrics.actualCostCny.toFixed(2)}</p></div></header>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-medium">Shared Motion Prompt</h2><p className="text-xs text-slate-400">Applied to {inheritedCount} images · {customCount} Custom overrides · v{detail.batch.sharedPromptVersion}{staleCount ? ` · ${staleCount} stale result${staleCount === 1 ? '' : 's'}` : ''}</p></div><div className="flex gap-2">{selectedItemIds.length ? <Button disabled={busy} variant="outline" onClick={() => void restoreSelectedShared()}>Use Shared for {selectedItemIds.length}</Button> : null}<Button disabled={busy || !sharedPrompt.trim()} onClick={() => void saveShared()}><Save className="mr-2 size-4" />Save shared Prompt</Button></div></div><textarea aria-label="Shared Motion Prompt" className="min-h-24 w-full rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-orange-500" value={sharedPrompt} onChange={(event) => setSharedPrompt(event.target.value)} /></section>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Pilot execution</h2>
            <p className="mt-1 text-xs text-slate-400">The latest Job for every selected Pilot. Queued and generating Jobs refresh every 10 seconds.</p>
          </div>
          <Button className="border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white" disabled={busy} size="sm" variant="outline" onClick={() => void load()}><RotateCw className="size-3.5" />Refresh status</Button>
        </div>
        {pilotItems.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pilotItems.map((item) => {
              const job = item.latestJob;
              const status = job?.status ?? 'selected';
              const running = status === 'queued' || status === 'generating';
              const failed = status === 'failed';
              const succeeded = status === 'succeeded';
              const statusClass = failed
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : succeeded
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : running
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
              return (
                <article className={`rounded-xl border p-3 ${statusClass}`} key={item.item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">#{item.item.sequence} · {item.catalogItem.productName}</p>
                      <p className="mt-1 text-[11px] opacity-70">{job ? `VideoJob #${job.id}` : 'No VideoJob created yet'}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-slate-950/50 px-2 py-1 text-[11px] font-semibold capitalize">
                      {running ? <Loader2 className="size-3 animate-spin" /> : failed ? <AlertTriangle className="size-3" /> : succeeded ? <Check className="size-3" /> : <Clock3 className="size-3" />}
                      {status}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5">
                    {!job ? 'Selected as Pilot and waiting for Generate Pilots.' : status === 'queued' ? 'Waiting for the BullMQ worker.' : status === 'generating' ? job.externalTaskId ? 'MiniMax accepted the task and generation is in progress.' : 'Submitting the frozen Recipe to MiniMax.' : status === 'succeeded' ? 'Generation completed. Review this output below.' : job.failureReason ?? 'Pilot generation failed.'}
                  </p>
                  {job ? <p className="mt-2 text-[11px] opacity-70">Provider task: {job.externalTaskId ?? 'not created'} · Updated {new Date(job.updatedAt).toLocaleString()}</p> : null}
                  {failed && job?.failureReason?.toLowerCase().includes('insufficient balance') ? <p className="mt-2 rounded-lg bg-slate-950/40 p-2 text-xs text-red-100">MiniMax rejected submission because the provider account balance is insufficient. Recharge it before retrying.</p> : null}
                  {failed ? <Button className="mt-3 border-red-400/40 bg-slate-950 text-red-100 hover:bg-red-950 hover:text-white" disabled={busy} size="sm" variant="outline" onClick={() => void retryPilot(item.item.id)}>Retry this Pilot</Button> : null}
                  {succeeded && job?.outputAssetId ? <div className="mt-3 space-y-2"><video className="aspect-video w-full rounded-lg bg-slate-950" controls preload="metadata" src={`/api/assets/${job.outputAssetId}/download`} /><Button asChild size="sm" variant="outline"><a href={`/api/assets/${job.outputAssetId}/download`}>打开视频</a></Button></div> : null}
                </article>
              );
            })}
          </div>
        ) : <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">No Pilot selected yet. Check 1–3 image cards and set them as Pilots.</p>}
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-slate-400">{pilotCount} Pilot{pilotCount === 1 ? '' : 's'} selected{selectedItemIds.length ? ` · ${selectedItemIds.length} checked` : ''}</p>
            {addingPilots ? <p className="text-amber-300">Select up to {remainingPilotSlots} more ready image{remainingPilotSlots === 1 ? '' : 's'} to add as Pilots.</p> : <p className="text-slate-500">Check 1–3 images, then set them as Pilots</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {detail.items.map((item) => {
              const selectedCard = item.item.id === selectedItemId;
              const checked = selectedItemIds.includes(item.item.id);
              return (
                <div className={`overflow-hidden rounded-xl border bg-slate-900 ${item.item.isPilot ? 'border-orange-400' : 'border-slate-800'} ${selectedCard ? 'ring-2 ring-sky-400/40' : ''}`} key={item.item.id}>
                  <button className="block w-full text-left" onClick={() => { setSelectedItemId(item.item.id); setCustomPrompt(item.item.promptOverride ?? detail.batch.sharedPrompt); }} type="button">
                    <div className="grid aspect-square grid-cols-2 bg-slate-800">
                      {item.catalogItem.primaryAssetId ? <img className="size-full object-cover" src={`/api/assets/${item.catalogItem.primaryAssetId}/download`} alt={item.catalogItem.productName} /> : <div className="flex size-full items-center justify-center"><ImageIcon className="size-8 text-slate-600" /></div>}
                      {item.latestJob?.outputAssetId ? <video className="size-full object-cover" controls={false} muted preload="metadata" src={`/api/assets/${item.latestJob.outputAssetId}/download`} /> : <div className="flex size-full items-center justify-center border-l border-slate-700"><Video className="size-8 text-slate-600" /></div>}
                    </div>
                    <div className="space-y-1 p-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span>#{item.item.sequence}</span>
                        <span className="flex items-center gap-1.5">
                          {item.item.isPilot ? <b className="rounded-full bg-orange-400/15 px-2 py-0.5 font-medium text-orange-300">Pilot</b> : null}
                          <span className={item.item.promptMode === 'inherit' ? 'text-slate-400' : 'text-orange-300'}>{item.item.promptMode === 'inherit' ? 'Shared' : 'Custom'}</span>
                        </span>
                      </div>
                      <p className="truncate text-sm">{item.catalogItem.productName}</p>
                      <p className="text-xs text-slate-500">{item.latestJob?.status ?? item.item.status}{item.latestReview ? ` · ${item.latestReview.decision}` : ''}{isStale(item) ? ' · stale' : ''}</p>
                      {item.latestJob?.failureReason ? <p className="text-xs text-red-300">{item.latestJob.failureReason}</p> : null}
                    </div>
                  </button>
                  <label className="flex items-center gap-2 border-t border-slate-800 px-3 py-2 text-xs text-slate-400">
                    <input type="checkbox" checked={checked} onChange={() => setSelectedItemIds((ids) => checked ? ids.filter((id) => id !== item.item.id) : [...ids, item.item.id])} />
                    {checked ? 'Selected' : 'Select item'}
                  </label>
                </div>
              );
            })}
          </div>
        </section>
        <aside className="h-fit rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Item Inspector</h2>
          {selected ? <div className="mt-4 space-y-3"><p className="text-sm">#{selected.item.sequence} · {selected.catalogItem.productName}</p><p className="text-xs text-slate-400">Effective Prompt</p><textarea aria-label="Item Custom Prompt" className="min-h-44 w-full rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100" value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} /><div className="flex gap-2"><Button disabled={busy} variant="outline" onClick={() => void saveItem('inherit')}>Use Shared</Button><Button disabled={busy || !customPrompt.trim()} onClick={() => void saveItem('override')}>Save Custom</Button></div><div className="border-t border-slate-800 pt-3 text-xs text-slate-400"><p>Input: {selected.catalogItem.externalSku}</p><p>Status: {selected.latestJob?.status ?? selected.item.status}</p><p>Pilot: {selected.item.isPilot ? 'yes' : 'no'}</p><p>Review: {selected.latestReview?.decision ?? 'not reviewed'}</p><p>Recipe: {selected.latestJob?.recipeSnapshot ? 'frozen at submission' : 'not submitted'}</p></div></div> : <p className="mt-4 text-sm text-slate-500">Select an image.</p>}
        </aside>
      </div>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} variant="outline" onClick={() => void runAction('image-eligibility')}>检查生成条件</Button>
          <Button disabled={busy} variant="outline" onClick={() => void estimateAndConfirm()}>估算费用</Button>
          {confirmationCost !== null ? <Button disabled={busy} onClick={() => void runAction('confirm-cost', { expectedMaxEstimatedCostCny: confirmationCost })}>确认 ¥{confirmationCost.toFixed(2)}</Button> : null}
          <Button disabled={busy || !canSelectPilots || (addingPilots && selectedReadyItemCount === 0)} title={!canSelectPilots ? '试片最多三张；当前状态不能再调整试片。' : addingPilots && selectedReadyItemCount === 0 ? '请选择一张尚未生成的素材追加为试片。' : undefined} variant="outline" onClick={() => void selectPilots()}>{addingPilots ? `追加 ${selectedReadyItemCount || ''} 张试片` : selectedItemIds.length ? `将 ${selectedItemIds.length} 个设为试生成` : '自动选择试生成'}</Button>
          <Button disabled={busy || submittablePilotCount === 0} title={submittablePilotCount === 0 ? '没有处于待提交状态的试片。' : undefined} variant="outline" onClick={() => void submitPilots()}>生成试片</Button>
          <Button disabled={busy || !canScheduleBatch} title={!canScheduleBatch ? '至少两条试片被采用并通过评估前，不能进入批量生成。' : undefined} variant="outline" onClick={() => void runAction('schedule-image-batch')}>生成下一批</Button>
          <Button disabled={busy || selectedItemIds.length === 0} variant="outline" onClick={() => void runAction('retry-image-failed', { itemIds: selectedItemIds })}>重试失败任务</Button>
          <Button disabled={busy || selectedItemIds.length === 0 || !canScheduleBatch} title={!canScheduleBatch ? '请先完成试片评估并放行，再按当前提示词重新生成。' : undefined} variant="outline" onClick={() => void runAction('regenerate-image-items', { itemIds: selectedItemIds })}>按当前提示词重新生成</Button>
          {detail.batch.status === 'paused' ? <Button disabled={busy} variant="outline" onClick={() => void runAction('resume')}>恢复</Button> : <Button disabled={busy} variant="outline" onClick={() => void runAction('pause')}>暂停</Button>}
        </div>
        <p className="mt-2 text-xs text-slate-500">提交试生成或批量生成前，必须确认当前费用。重试会复用冻结的 Recipe；按当前提示词重新生成会创建新的 Recipe。</p>
        {message ? <p className="mt-3 rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-100" role="alert">{message}</p> : null}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Review selected outputs</h2>
          <select aria-label="Rejection cause" className="mt-3 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm" value={rejectionCause} onChange={(event) => setRejectionCause(event.target.value as typeof rejectionCause)}><option value="technical">Technical</option><option value="fidelity">Product fidelity</option><option value="spec_mismatch">Spec mismatch</option><option value="preference_change">Preference change</option><option value="brief_change">Brief change</option></select>
          <textarea className="mt-3 min-h-20 w-full rounded-md border border-slate-700 bg-slate-950 p-3 text-sm" placeholder="Rejection reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} />
          <div className="mt-3 flex gap-2"><Button disabled={busy || selectedItemIds.length === 0} onClick={() => void reviewSelected('adopted')}>Adopt selected</Button><Button disabled={busy || selectedItemIds.length === 0 || !reviewReason.trim()} variant="outline" onClick={() => void reviewSelected('not_adopted')}>Reject selected</Button></div>
          <div className="mt-3 flex flex-wrap gap-2">{detail.items.filter((item) => item.latestReview?.decision === 'adopted' && item.latestJob?.outputAssetId).map((item) => <Button asChild key={item.item.id} variant="outline"><a href={`/api/assets/${item.latestJob!.outputAssetId}/download`}>Download #{item.item.sequence}</a></Button>)}</div>
          {detail.items.some((item) => item.latestReview?.decision === 'adopted' && item.latestJob?.outputAssetId) ? <Button variant="outline" onClick={() => { for (const item of detail.items.filter((row) => row.latestReview?.decision === 'adopted' && row.latestJob?.outputAssetId)) window.open(`/api/assets/${item.latestJob!.outputAssetId}/download`, '_blank', 'noopener,noreferrer'); }}>Download all adopted</Button> : null}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Activity</h2>
          <div className="mt-3 max-h-40 space-y-2 overflow-y-auto text-xs text-slate-400">{detail.timeline.map((entry, index) => <p key={`${entry.type}-${index}`}><span className="text-slate-200">{entry.label}</span> · {entry.detail}</p>)}</div>
          <details className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500"><summary className="cursor-pointer">Advanced diagnostics</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(detail.diagnostics, null, 2)}</pre></details>
          <Button asChild variant="outline"><a href={`/api/production-batches/${batchId}/image-manifest`}>Export manifest</a></Button>
        </div>
      </section>
      <p className="flex items-center gap-2 text-xs text-slate-500"><Check className="size-3" />Images remain reference inputs. This workspace does not require first or last frames.</p>
    </div>
  );
}
