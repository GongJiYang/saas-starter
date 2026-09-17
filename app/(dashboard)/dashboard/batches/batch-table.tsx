'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FilePlus2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BatchFeedback } from './batch-feedback';

type BatchRow = {
  item: {
    id: number;
    status: string;
    isPilot: boolean;
    waveNumber: number;
    campaignId: number | null;
    creativeSpecVersionId: number | null;
    lastError: string | null;
  };
  externalSku: string;
  productName: string;
  campaignName: string | null;
  specVersion: string | null;
  specStatus: string | null;
  pendingSpecVersionId: number | null;
  pendingSpecVersion: string | null;
  pendingSpecStatus: string | null;
};

type Response = { rows: BatchRow[]; page: number; pageCount: number; total: number };

function specGuidance(row: BatchRow): string {
  switch (row.pendingSpecStatus) {
    case 'draft':
      return `Draft v${row.pendingSpecVersion} is ready. Submit it for approval.`;
    case 'awaiting_approval':
      return `v${row.pendingSpecVersion} is awaiting approval. Approve it to bind this SKU automatically.`;
    case 'rejected':
      return `v${row.pendingSpecVersion} was rejected. Review its successor Draft.`;
    default:
      return 'No Creative Spec yet.';
  }
}

export function BatchTable({
  batchId,
  active,
  generationMode,
}: {
  batchId: number;
  active: boolean;
  generationMode: 'single' | 'bulk';
}) {
  const [data, setData] = useState<Response>({ rows: [], page: 1, pageCount: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [waveNumber, setWaveNumber] = useState('');
  const [message, setMessage] = useState('');
  const [busyItemId, setBusyItemId] = useState<number | null>(null);

  async function load() {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (status) params.set('status', status);
    if (query) params.set('query', query);
    if (waveNumber) params.set('waveNumber', waveNumber);
    const response = await fetch(`/api/production-batches/${batchId}/items?${params.toString()}`);
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Could not load Batch rows.');
    }
    setData(body as Response);
  }

  async function createSpec(itemId: number) {
    setBusyItemId(itemId);
    setMessage('');
    try {
      const response = await fetch(`/api/production-batches/${batchId}/create-item-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : 'Creative Spec draft could not be created.');
      }
      const result = (body as { result: { externalSku: string; created: boolean } }).result;
      setMessage(`${result.externalSku}: Creative Spec ${result.created ? 'Draft created' : 'already exists'}. Review and approve it in Creative Specs.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Creative Spec draft could not be created.');
    } finally {
      setBusyItemId(null);
    }
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not load Batch rows.'));
  }, [batchId, page, status, query, waveNumber]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, [active, batchId, page, status, query, waveNumber]);

  return (
    <div className="space-y-3 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Filter Batch SKU" className="w-48" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Filter SKU" />
        <select aria-label="Filter Batch status" className="rounded-md border border-gray-300 px-2 py-2 text-sm" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
          <option value="">All statuses</option>
          {['pending', 'pilot', 'ready', 'queued', 'producing', 'quality_review', 'review', 'completed', 'failed', 'excluded'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <Input aria-label="Filter Wave number" className="w-32" type="number" min="0" value={waveNumber} onChange={(event) => { setPage(1); setWaveNumber(event.target.value); }} placeholder="Wave" />
        <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="mr-1 size-3" />Refresh</Button>
        <a className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-orange-700" href={`/api/production-batches/${batchId}/export`}><Download className="size-4" />Export CSV</a>
        <a className="inline-flex items-center gap-1 text-sm font-medium text-orange-700" href={`/api/production-batches/${batchId}/adopted-export`}>Export adopted</a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="border-y border-gray-200 bg-gray-50 uppercase text-gray-500">
            <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Pilot / Wave</th><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Creative Spec</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Failure</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.rows.map((row) => {
              const canCreateSpec = generationMode === 'single' || row.item.isPilot;
              return (
                <tr key={row.item.id}>
                  <td className="px-3 py-2"><b>{row.externalSku}</b><br /><span className="text-muted-foreground">{row.productName}</span></td>
                  <td className="px-3 py-2">{row.item.isPilot ? 'Pilot' : generationMode === 'single' ? 'Single' : `Wave ${row.item.waveNumber}`}</td>
                  <td className="px-3 py-2">{row.campaignName ?? 'Created automatically with the Spec'}</td>
                  <td className="max-w-[300px] px-3 py-2">
                    {row.specVersion ? (
                      <span className="font-medium text-emerald-700">v{row.specVersion} · {row.specStatus} · bound</span>
                    ) : row.pendingSpecVersionId ? (
                      <span>
                        <span className="block text-amber-800">{specGuidance(row)}</span>
                        <a className="mt-1 inline-block font-medium text-orange-700 underline" href={`/dashboard/specs#spec-${row.pendingSpecVersionId}`}>Open Creative Spec</a>
                      </span>
                    ) : canCreateSpec ? (
                      <Button disabled={busyItemId !== null} size="sm" variant="outline" onClick={() => void createSpec(row.item.id)}>
                        <FilePlus2 className="mr-1 size-3" />{busyItemId === row.item.id ? 'Creating…' : 'Create Spec'}
                      </Button>
                    ) : <span className="text-muted-foreground">Select as Pilot before creating a Spec.</span>}
                  </td>
                  <td className="px-3 py-2"><span className="rounded bg-gray-100 px-2 py-1">{row.item.status}</span></td>
                  <td className="max-w-[240px] px-3 py-2 text-red-700">{row.item.lastError ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.rows.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">No Batch rows match these filters.</p>}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{data.total} rows · page {data.page} / {data.pageCount}</span>
        <div className="flex gap-1">
          <Button disabled={page <= 1} size="sm" variant="outline" onClick={() => setPage((value) => value - 1)}><ChevronLeft className="size-3" /></Button>
          <Button disabled={page >= data.pageCount} size="sm" variant="outline" onClick={() => setPage((value) => value + 1)}><ChevronRight className="size-3" /></Button>
        </div>
      </div>
      {message && <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">{message}</p>}
      <BatchFeedback batchId={batchId} />
    </div>
  );
}
