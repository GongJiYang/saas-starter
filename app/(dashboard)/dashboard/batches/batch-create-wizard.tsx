'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, ImageIcon, Search, Video, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type CatalogChoice = {
  id: number;
  externalSku: string;
  productName: string;
  readinessStatus: string;
  primaryAssetId: number | null;
  brandKitName: string;
};

type EligibilityRemediation = { code: string; label: string; href: string | null };
type EligibilityBlocker = { code: string; field: string; message: string; remediations: EligibilityRemediation[] };
type EligibilityCandidate = {
  stableId: string;
  name: string;
  scope: 'official' | 'workspace_private';
  versionId: number;
  version: string;
  eligible: boolean;
  blockers: EligibilityBlocker[];
  supportedDurations: number[];
};
type EligibilityPreview = {
  items: Array<{ catalogItemId: number; externalSku: string; productName: string; readinessStatus: string; blockers: EligibilityBlocker[] }>;
  commonCandidates: EligibilityCandidate[];
  supportedDurations: number[];
  selectedVersionId: number | null;
  canCreate: boolean;
};

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Request failed.');
  return body;
}

export function BatchCreateWizard() {
  const searchParams = useSearchParams();
  const deepLinkedSku = searchParams.get('sku') ?? '';
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [name, setName] = useState('');
  const [query, setQuery] = useState(deepLinkedSku);
  const [choices, setChoices] = useState<CatalogChoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedChoices, setSelectedChoices] = useState<CatalogChoice[]>([]);
  const [targetPlatform, setTargetPlatform] = useState('tiktok');
  const [durationSeconds, setDurationSeconds] = useState('5');
  const [campaignGoal, setCampaignGoal] = useState('Product awareness');
  const [waveSize, setWaveSize] = useState('10');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [eligibility, setEligibility] = useState<EligibilityPreview | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [selectedSkillVersionId, setSelectedSkillVersionId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCatalogLoading(true);
      const params = new URLSearchParams({ page: '1', pageSize: '20', status: 'ready' });
      if (query.trim()) params.set('query', query.trim());
      void requestJson(`/api/catalog?${params.toString()}`, { signal: controller.signal })
        .then((result) => {
          const rows = (result as { rows: CatalogChoice[] }).rows;
          setChoices(rows);
          if (deepLinkedSku && selectedIds.length === 0) {
            const exact = rows.find((row) => row.externalSku === deepLinkedSku);
            if (exact) {
              setSelectedIds([exact.id]);
              setSelectedChoices([exact]);
            }
          }
        })
        .catch((error: unknown) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not search SKU.'); })
        .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [deepLinkedSku, query]);

  useEffect(() => {
    if ((mode === 'single' && selectedIds.length !== 1) || (mode === 'bulk' && selectedIds.length < 3)) {
      setEligibility(null);
      setSelectedSkillVersionId(null);
      return;
    }
    const controller = new AbortController();
    setEligibilityLoading(true);
    void requestJson('/api/skills/eligibility/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogItemIds: selectedIds, durationSeconds: Number(durationSeconds), targetPlatform, shotRole: 'hook' }),
      signal: controller.signal,
    }).then((result) => {
      const preview = result as EligibilityPreview;
      setEligibility(preview);
      setSelectedSkillVersionId((current) => preview.commonCandidates.some((candidate) => candidate.versionId === current && candidate.eligible) ? current : preview.selectedVersionId);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setEligibility(null);
        setSelectedSkillVersionId(null);
        setMessage(error instanceof Error ? error.message : 'Could not run task preflight.');
      }
    }).finally(() => { if (!controller.signal.aborted) setEligibilityLoading(false); });
    return () => controller.abort();
  }, [durationSeconds, mode, selectedIds, targetPlatform]);

  function choose(choice: CatalogChoice) {
    setMessage('');
    if (mode === 'single') {
      setSelectedIds([choice.id]);
      setSelectedChoices([choice]);
      return;
    }
    setSelectedIds((current) => current.includes(choice.id)
      ? current.filter((id) => id !== choice.id)
      : [...current, choice.id]);
    setSelectedChoices((current) => current.some((selected) => selected.id === choice.id)
      ? current.filter((selected) => selected.id !== choice.id)
      : [...current, choice]);
  }

  function changeMode(next: 'single' | 'bulk') {
    setMode(next);
    setSelectedIds([]);
    setSelectedChoices([]);
    setEligibility(null);
    setSelectedSkillVersionId(null);
  }

  async function create() {
    setBusy(true);
    setMessage('');
    try {
      const result = await requestJson('/api/production-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          catalogItemIds: selectedIds,
          targetPlatform,
          durationSeconds: Number(durationSeconds),
          campaignGoal,
          waveSize: Number(waveSize),
          shotSkillVersionId: selectedSkillVersionId,
        }),
      }) as { batch: { id: number } };
      window.location.assign(`/dashboard/batches/${result.batch.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create Production task.');
    } finally {
      setBusy(false);
    }
  }

  const validSelection = mode === 'single' ? selectedIds.length === 1 : selectedIds.length >= 3;
  const canCreate = validSelection && Boolean(name.trim()) && Boolean(eligibility?.canCreate) && Boolean(selectedSkillVersionId) && !eligibilityLoading;

  return (
    <Card>
      <CardHeader><CardTitle>Create Production task</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <section>
          <p className="mb-3 text-sm font-medium">1. Choose production mode</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button className={`rounded-lg border p-4 text-left ${mode === 'single' ? 'border-orange-500 bg-orange-50' : 'hover:bg-gray-50'}`} onClick={() => changeMode('single')} type="button"><Video className="size-5 text-orange-600" /><span className="mt-2 block font-medium">Single video</span><span className="mt-1 block text-xs text-muted-foreground">One SKU, direct Campaign → Spec → generation → review path.</span></button>
            <button className={`rounded-lg border p-4 text-left ${mode === 'bulk' ? 'border-orange-500 bg-orange-50' : 'hover:bg-gray-50'}`} onClick={() => changeMode('bulk')} type="button"><Workflow className="size-5 text-orange-600" /><span className="mt-2 block font-medium">Batch production</span><span className="mt-1 block text-xs text-muted-foreground">Three or more SKU with Pilot, cost, Wave, and stop-loss gates.</span></button>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between"><p className="text-sm font-medium">2. Select ready SKU</p><span className="text-xs text-muted-foreground">{selectedIds.length} selected · {mode === 'single' ? 'exactly 1 required' : 'at least 3 required'}</span></div>
          <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search ready SKU" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product name or SKU" /></div>
          {catalogLoading ? <div aria-label="SKU search loading" className="mt-3 grid gap-2 sm:grid-cols-2"><div className="h-20 animate-pulse rounded-lg bg-gray-100" /><div className="h-20 animate-pulse rounded-lg bg-gray-100" /></div> : (
            <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
              {choices.map((choice) => {
                const selected = selectedIds.includes(choice.id);
                return <button className={`flex items-center gap-3 rounded-lg border p-3 text-left ${selected ? 'border-orange-500 bg-orange-50' : 'hover:bg-gray-50'}`} key={choice.id} onClick={() => choose(choice)} type="button">{choice.primaryAssetId ? <img alt="" className="size-14 rounded bg-gray-50 object-contain" src={`/api/assets/${choice.primaryAssetId}/download`} /> : <span className="flex size-14 items-center justify-center rounded bg-gray-100"><ImageIcon className="size-5 text-gray-400" /></span>}<span className="min-w-0 flex-1"><span className="block truncate font-medium">{choice.productName}</span><span className="block truncate font-mono text-xs text-muted-foreground">{choice.externalSku}</span><span className="block truncate text-xs text-muted-foreground">{choice.brandKitName}</span></span>{selected ? <Check className="size-4 text-orange-600" /> : null}</button>;
              })}
              {choices.length === 0 ? <p className="text-sm text-muted-foreground">No ready SKU match this search. Complete product information in SKU Catalog first.</p> : null}
            </div>
          )}
        </section>

        <section className="grid gap-3 md:grid-cols-5">
          <Input aria-label="Task name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Task name" />
          <Input aria-label="Target platform" value={targetPlatform} onChange={(event) => setTargetPlatform(event.target.value)} placeholder="Platform" />
          <select aria-label="Duration seconds" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)}>{Array.from({ length: 12 }, (_, index) => index + 4).map((duration) => <option disabled={Boolean(eligibility) && !eligibility!.supportedDurations.includes(duration)} key={duration} value={duration}>{duration}s{eligibility && !eligibility.supportedDurations.includes(duration) ? ' · no eligible Skill' : ''}</option>)}</select>
          <Input aria-label="Campaign goal" value={campaignGoal} onChange={(event) => setCampaignGoal(event.target.value)} placeholder="Campaign goal" />
          {mode === 'bulk' ? <Input aria-label="Wave size" type="number" min="1" value={waveSize} onChange={(event) => setWaveSize(event.target.value)} placeholder="Wave size" /> : <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-muted-foreground">Direct generation</div>}
        </section>

        <section aria-label="Task preflight" className="rounded-lg border bg-gray-50 p-4">
          <div className="flex items-center justify-between"><h3 className="font-semibold">3. Task preflight</h3>{eligibilityLoading ? <span className="text-xs text-muted-foreground">Checking…</span> : null}</div>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-4"><Preflight label="SKU & Brand" ready={validSelection && selectedChoices.every((choice) => choice.readinessStatus === 'ready')} value={selectedChoices.map((choice) => `${choice.externalSku} · ${choice.brandKitName}`).join('; ') || 'Choose SKU'} /><Preflight label="Materials" ready={validSelection && selectedChoices.every((choice) => choice.primaryAssetId)} value={selectedChoices.length ? `${selectedChoices.filter((choice) => choice.primaryAssetId).length}/${selectedChoices.length} primary images ready` : 'Choose SKU'} /><Preflight label="Shot Skill" ready={Boolean(eligibility?.canCreate && selectedSkillVersionId)} value={eligibility?.commonCandidates.find((candidate) => candidate.versionId === selectedSkillVersionId)?.name ?? 'Waiting for eligible Skill'} /><Preflight label="Duration & Cost" ready={Boolean(eligibility?.supportedDurations.includes(Number(durationSeconds)))} value={`${durationSeconds}s · cost estimated after Spec approval`} /></div>
          {eligibility ? <div className="mt-4 space-y-2">{eligibility.items.flatMap((item) => item.blockers.map((blocker) => <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" key={`${item.catalogItemId}-${blocker.code}`}>{item.externalSku}: {blocker.message}{blocker.remediations.map((remediation) => remediation.href ? <a className="ml-2 font-medium underline" href={remediation.href} key={remediation.code}>{remediation.label}</a> : null)}</p>))}{eligibility.commonCandidates.map((candidate) => <label className={`flex items-start gap-2 rounded-md border p-3 text-sm ${candidate.eligible ? 'bg-white' : 'bg-gray-100 text-muted-foreground'}`} key={candidate.versionId}><input checked={selectedSkillVersionId === candidate.versionId} disabled={!candidate.eligible} name="createSkillVersion" onChange={() => setSelectedSkillVersionId(candidate.versionId)} type="radio" /><span><span className="font-medium">{candidate.name}</span> · {candidate.scope === 'official' ? 'Official' : 'Private'} v{candidate.version}<span className="block text-xs">{candidate.eligible ? `Eligible · ${candidate.supportedDurations.join(', ')}s` : candidate.blockers.map((blocker) => blocker.message).join(' ')}</span></span></label>)}</div> : <p className="mt-3 text-sm text-muted-foreground">Complete mode and SKU selection to run preflight.</p>}
        </section>

        {message ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</p> : null}
        <div className="flex justify-end"><Button disabled={busy || !canCreate} onClick={() => void create()}>{busy ? 'Creating…' : `Create ${mode === 'single' ? 'Single video' : 'Batch production'}`}</Button></div>
      </CardContent>
    </Card>
  );
}

function Preflight({ label, ready, value }: { label: string; ready: boolean; value: string }) {
  return <div className="rounded-md bg-white p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 font-medium ${ready ? 'text-emerald-700' : 'text-amber-700'}`}>{ready ? 'Ready' : 'Needs attention'}</p><p className="mt-1 text-xs text-muted-foreground">{value}</p></div>;
}
