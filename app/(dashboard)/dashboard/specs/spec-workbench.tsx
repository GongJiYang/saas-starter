'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileCheck2, Send, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

async function requestJson(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body;
}

type SourceContext = {
  productionBatchId: number | null;
  productionBatchName: string | null;
  productionBatchItemId: number | null;
  externalSku: string | null;
  productName: string | null;
  brandKitName: string;
  campaignName: string;
  skillName: string | null;
  skillStableId: string | null;
  skillVersion: string | null;
};

type Spec = {
  id: number;
  campaignId: number;
  version: string;
  status: string;
  specSnapshot: string;
  rejectionCode: string | null;
  rejectionNote: string | null;
  sourceContext: SourceContext;
};

type Envelope = {
  brief: {
    externalSku: string;
    productName: string;
    approvedClaims: Array<{ id: string; text: string; source: string }>;
    prohibitedClaims: string[];
    mustShowElements: string[];
    immutableElements: string[];
    durationSeconds: number;
    targetPlatform: string;
    cta: string;
  };
  angleProposals: Array<{ id: string; label: string; rationale: string; score: number }>;
  creativeSpec: {
    selectedAngle: { id: string; label: string; rationale: string; evidenceIds: string[]; riskNotes: string[] };
    hookVariants: Array<{ id: string; openingHook: string; firstShotDescription: string }>;
    sharedBodyShotList: Array<{ id: string; description: string }>;
    visualTreatment: string;
    pacing: string;
    captionPlan: string;
    mustShowElements: string[];
    immutableElements: string[];
    forbiddenElements: string[];
    referenceBorrowedStructure: string[];
    referenceExcludedContent: string[];
    estimated: { shotCount: number; durationSeconds: number; maxEstimatedCostCny: number };
  };
};

type ApprovalBinding = {
  productionBatchId: number;
  itemId: number;
  batchStatus: string;
  nextAction: string;
} | null;

export function CreativeSpecWorkbench() {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await requestJson('/api/creative-specs') as { specs: Spec[] };
    setSpecs(result.specs);
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not load Specs.'));
  }, []);


  async function action(specId: number, actionName: 'submit' | 'approve' | 'reject') {
    setBusy(true);
    try {
      const body = actionName === 'reject'
        ? { rejectionCode: 'spec_mismatch', rejectionNote: 'Please revise the selected angle or constraints.' }
        : {};
      const result = await requestJson(`/api/creative-specs/${specId}/${actionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }) as { binding?: ApprovalBinding };
      setMessage(actionName === 'approve' && result.binding
        ? `Spec approved and bound to Batch #${result.binding.productionBatchId}. ${result.binding.nextAction}`
        : `Spec ${actionName} completed.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Spec action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function approveSelected() {
    setBusy(true);
    try {
      const result = await requestJson('/api/creative-specs/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specVersionIds: selected }),
      }) as { results: Array<{ specVersionId: number; status: 'approved' | 'failed'; binding: ApprovalBinding; error: string | null }> };
      setMessage(result.results.map((row) => row.status === 'approved'
        ? `Spec #${row.specVersionId}: approved${row.binding ? ` and bound to Batch #${row.binding.productionBatchId}` : ''}`
        : `Spec #${row.specVersionId}: failed — ${row.error}`).join(' · '));
      setSelected([]);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Bulk approval failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="border-b border-gray-200 pb-6">
        <p className="text-sm font-medium text-orange-600">Generation gate</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">Creative Spec approval</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review the Product Brief, selected Angle, controlled Hooks, Batch source, Brand Kit, Campaign, Skill version, and estimated cost before generation.</p>
      </section>
      <Card>
        <CardHeader><CardTitle>Create Specs from a Production task</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Campaigns, SKU context, Brand Kit, frozen Skill and duration are inherited from the selected BatchItem. No manual IDs are required.</p>
          <Button asChild><Link href="/dashboard/batches">Open production tasks</Link></Button>
        </CardContent>
      </Card>
      {message && <p className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">{message}</p>}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{specs.length} Spec versions</p>
        <Button disabled={busy || selected.length === 0} onClick={() => void approveSelected()}><CheckCircle2 className="mr-2 size-4" />Approve selected awaiting Specs</Button>
      </div>
      <div className="grid gap-4">
        {specs.map((spec) => (
          <SpecCard
            key={spec.id}
            spec={spec}
            selected={selected.includes(spec.id)}
            onSelect={(checked) => setSelected((current) => checked ? [...current, spec.id] : current.filter((id) => id !== spec.id))}
            busy={busy}
            onAction={(name) => void action(spec.id, name)}
          />
        ))}
        {specs.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No Creative Spec versions yet.</CardContent></Card>}
      </div>
    </div>
  );
}

function SpecCard({
  spec,
  selected,
  onSelect,
  busy,
  onAction,
}: {
  spec: Spec;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  busy: boolean;
  onAction: (action: 'submit' | 'approve' | 'reject') => void;
}) {
  let envelope: Envelope | null = null;
  try {
    envelope = JSON.parse(spec.specSnapshot) as Envelope;
  } catch {
    // Malformed snapshots are rejected by the service.
  }
  const creativeSpec = envelope?.creativeSpec;
  const source = spec.sourceContext;
  return (
    <Card id={`spec-${spec.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex gap-3">
          <input aria-label={`Select Spec ${spec.id}`} type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} />
          <div>
            <CardTitle className="flex items-center gap-2"><FileCheck2 className="size-5 text-orange-600" />{source.externalSku ?? envelope?.brief.externalSku ?? `Spec #${spec.id}`} · v{spec.version}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{spec.status} · {source.productName ?? envelope?.brief.productName ?? 'invalid snapshot'}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {source.productionBatchId ? `Batch #${source.productionBatchId} ${source.productionBatchName}` : 'Standalone Spec'}
              {' · '}Campaign: {source.campaignName}
              {' · '}Brand Kit: {source.brandKitName}
              {' · '}Skill: {source.skillName ? `${source.skillName} (${source.skillStableId} v${source.skillVersion})` : 'not resolved'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {spec.status === 'draft' && <Button disabled={busy} onClick={() => onAction('submit')}><Send className="mr-2 size-4" />Submit</Button>}
          {spec.status === 'awaiting_approval' && <>
            <Button disabled={busy} onClick={() => onAction('approve')}><CheckCircle2 className="mr-2 size-4" />Approve & bind</Button>
            <Button disabled={busy} onClick={() => onAction('reject')} variant="outline"><XCircle className="mr-2 size-4" />Reject</Button>
          </>}
        </div>
      </CardHeader>
      <CardContent>
        {creativeSpec ? (
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div><p className="font-medium">Selected Angle</p><p className="mt-1">{creativeSpec.selectedAngle.label}</p><p className="mt-1 text-muted-foreground">{creativeSpec.selectedAngle.rationale}</p></div>
            <div><p className="font-medium">Estimated cost</p><p className="mt-1">¥{creativeSpec.estimated.maxEstimatedCostCny} · {creativeSpec.estimated.shotCount} shots · {creativeSpec.estimated.durationSeconds}s</p></div>
            <div><p className="font-medium">Hook variants</p><ul className="mt-1 list-inside list-disc text-muted-foreground">{creativeSpec.hookVariants.map((hook) => <li key={hook.id}><b>{hook.id}</b> {hook.openingHook}</li>)}</ul></div>
            <div><p className="font-medium">Shared body</p><ul className="mt-1 list-inside list-disc text-muted-foreground">{creativeSpec.sharedBodyShotList.map((shot) => <li key={shot.id}>{shot.description}</li>)}</ul></div>
            <div><p className="font-medium">Constraints</p><p className="mt-1 text-muted-foreground">Must show: {creativeSpec.mustShowElements.join(', ')}. Immutable: {creativeSpec.immutableElements.join(', ')}.</p></div>
            <div><p className="font-medium">Reference guardrails</p><p className="mt-1 text-muted-foreground">Borrow: {creativeSpec.referenceBorrowedStructure.join(', ') || 'none'}. Exclude: {creativeSpec.referenceExcludedContent.join(', ')}.</p></div>
          </div>
        ) : <p className="text-sm text-red-700">Spec snapshot is invalid.</p>}
      </CardContent>
    </Card>
  );
}
