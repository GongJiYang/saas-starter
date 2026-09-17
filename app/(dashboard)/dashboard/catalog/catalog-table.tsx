'use client';

import Link from 'next/link';

import { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronLeft, ChevronRight, Edit3, Layers3, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type CatalogRow = { id: number; externalSku: string; productName: string; category: string; primaryImageUrl: string; primaryAssetId: number | null; readinessStatus: 'needs_input' | 'ready' | 'archived'; platform: string; durationSeconds: number; campaignGoal: string; brandKitId: number; brandKitName: string; updatedAt: string };
type CatalogResponse = { rows: CatalogRow[]; page: number; pageCount: number; total: number; brandKits: Array<{ id: number; name: string }>; categories: string[] };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Request failed.');
  return body as T;
}

export function CatalogTable() {
  const [data, setData] = useState<CatalogResponse>({ rows: [], page: 1, pageCount: 1, total: 0, brandKits: [], categories: [] });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [brandKitId, setBrandKitId] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [batchId, setBatchId] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ productName: '', category: '', campaignGoal: '' });
  const [batchName, setBatchName] = useState('');
  const [bulkPlatform, setBulkPlatform] = useState('');
  const [bulkGoal, setBulkGoal] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (status) params.set('status', status);
    if (brandKitId) params.set('brandKitId', brandKitId);
    if (category) params.set('category', category);
    if (query) params.set('query', query);
    if (batchId) params.set('batchId', batchId);
    setData(await requestJson<CatalogResponse>(`/api/catalog?${params.toString()}`));
  }
  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not load Catalog.')); }, [page, status, brandKitId, category, query, batchId]);

  const selectedReady = useMemo(() => data.rows.filter((row) => selected.has(row.id) && row.readinessStatus === 'ready').map((row) => row.id), [data.rows, selected]);
  function toggle(id: number, checked: boolean) { setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; }); }
  function beginEdit(row: CatalogRow) { setEditingId(row.id); setEditValues({ productName: row.productName, category: row.category, campaignGoal: row.campaignGoal }); }

  async function saveEdit() {
    if (editingId === null) return;
    setBusy(true);
    try { await requestJson(`/api/catalog/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editValues) }); setEditingId(null); setMessage('Catalog row updated.'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update Catalog row.'); } finally { setBusy(false); }
  }
  async function bulk(action: 'update' | 'archive') {
    if (selectedReady.length === 0) return;
    setBusy(true);
    try { await requestJson('/api/catalog/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'archive' ? { action, itemIds: selectedReady } : { action, itemIds: selectedReady, fields: { ...(bulkPlatform ? { platform: bulkPlatform } : {}), ...(bulkGoal ? { campaignGoal: bulkGoal } : {}) } }) }); setSelected(new Set()); setMessage(`${selectedReady.length} Catalog rows updated.`); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Catalog bulk action failed.'); } finally { setBusy(false); }
  }
  async function createBatch() {
    if (!batchName || selectedReady.length === 0) return;
    setBusy(true);
    try { const result = await requestJson<{ batch: { id: number } }>('/api/production-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: batchName, catalogItemIds: selectedReady, targetPlatform: bulkPlatform || 'tiktok', durationSeconds: 5, campaignGoal: bulkGoal || 'Product awareness', waveSize: 10 }) }); setMessage(`Production Batch #${result.batch.id} created.`); setBatchName(''); setSelected(new Set()); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create Production Batch.'); } finally { setBusy(false); }
  }

  return <Card><CardHeader><CardTitle>SKU Catalog table</CardTitle><p className="text-sm text-muted-foreground">{data.total} rows · server pagination capped at 50 rows</p></CardHeader><CardContent className="space-y-4"><div className="grid gap-2 md:grid-cols-6"><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search SKU or product" className="pl-8" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search SKU / product" /></div><select aria-label="Filter readiness" className="rounded-md border border-gray-300 px-3 text-sm" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">All readiness</option><option value="ready">Ready</option><option value="needs_input">Needs input</option><option value="archived">Archived</option></select><select aria-label="Filter Brand Kit" className="rounded-md border border-gray-300 px-3 text-sm" value={brandKitId} onChange={(event) => { setPage(1); setBrandKitId(event.target.value); }}><option value="">All Brand Kits</option>{data.brandKits.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select><select aria-label="Filter category" className="rounded-md border border-gray-300 px-3 text-sm" value={category} onChange={(event) => { setPage(1); setCategory(event.target.value); }}><option value="">All categories</option>{data.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select><div className="flex gap-2"><Input aria-label="Bulk platform" value={bulkPlatform} onChange={(event) => setBulkPlatform(event.target.value)} placeholder="Platform" /><Input aria-label="Bulk campaign goal" value={bulkGoal} onChange={(event) => setBulkGoal(event.target.value)} placeholder="Goal" /></div><Input aria-label="Filter Batch ID" value={batchId} onChange={(event) => { setPage(1); setBatchId(event.target.value); }} placeholder="Batch ID" type="number" min="1" /></div>
    <div className="flex flex-wrap items-center gap-2 border-y border-gray-100 py-3 text-sm"><span>{selectedReady.length} ready selected</span><Button disabled={busy || selectedReady.length === 0 || (!bulkPlatform && !bulkGoal)} onClick={() => void bulk('update')}>Apply fields</Button><Button disabled={busy || selectedReady.length === 0} variant="outline" onClick={() => void bulk('archive')}><Archive className="mr-2 size-4" />Archive</Button><Input aria-label="New Batch name" className="w-48" value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="New Batch name" /><Button disabled={busy || selectedReady.length === 0 || !batchName} onClick={() => void createBatch()}><Layers3 className="mr-2 size-4" />Create Batch</Button>{message && <span className="text-orange-700">{message}</span>}</div>
    <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-y border-gray-200 bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-3 py-3"><input aria-label="Select visible rows" type="checkbox" checked={data.rows.length > 0 && data.rows.every((row) => selected.has(row.id))} onChange={(event) => data.rows.forEach((row) => toggle(row.id, event.target.checked))} /></th><th className="px-3 py-3">Product</th><th className="px-3 py-3">SKU</th><th className="px-3 py-3">Readiness</th><th className="px-3 py-3">Brand Kit</th><th className="px-3 py-3">Category</th><th className="px-3 py-3">Updated</th><th className="px-3 py-3">Details</th></tr></thead><tbody className="divide-y divide-gray-100">{data.rows.map((row) => <tr key={row.id} className={row.readinessStatus !== 'ready' ? 'bg-gray-50/70' : ''}><td className="px-3 py-3"><input aria-label={`Select ${row.externalSku}`} type="checkbox" checked={selected.has(row.id)} onChange={(event) => toggle(row.id, event.target.checked)} /></td><td className="px-3 py-3"><div className="flex items-center gap-2"><img alt="" className="size-10 rounded object-cover" src={row.primaryAssetId ? `/api/assets/${row.primaryAssetId}/download` : row.primaryImageUrl} /><span className="font-medium">{row.productName}</span></div></td><td className="px-3 py-3 font-mono text-xs"><Link className="hover:text-orange-700 hover:underline" href={`/dashboard/catalog/${row.id}`}>{row.externalSku}</Link></td><td className="px-3 py-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs">{row.readinessStatus}</span></td><td className="px-3 py-3">{row.brandKitName}</td><td className="px-3 py-3">{row.category}</td><td className="px-3 py-3 text-xs text-muted-foreground">{new Date(row.updatedAt).toLocaleString()}</td><td className="px-3 py-3"><Button size="sm" variant="ghost" onClick={() => beginEdit(row)}><Edit3 className="mr-1 size-3" />Edit</Button>{editingId === row.id && <div className="mt-2 grid gap-2 rounded border bg-white p-3"><Input aria-label={`Edit product ${row.id}`} value={editValues.productName} onChange={(event) => setEditValues((current) => ({ ...current, productName: event.target.value }))} /><Input aria-label={`Edit category ${row.id}`} value={editValues.category} onChange={(event) => setEditValues((current) => ({ ...current, category: event.target.value }))} /><Input aria-label={`Edit goal ${row.id}`} value={editValues.campaignGoal} onChange={(event) => setEditValues((current) => ({ ...current, campaignGoal: event.target.value }))} /><Button disabled={busy} size="sm" onClick={() => void saveEdit()}><Save className="mr-1 size-3" />Save</Button></div>}</td></tr>)}</tbody></table>{data.rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No Catalog rows match the current filters.</p>}</div><div className="flex items-center justify-between text-sm"><span>Page {data.page} / {data.pageCount}</span><div className="flex gap-2"><Button disabled={page <= 1} size="sm" variant="outline" onClick={() => setPage((value) => value - 1)}><ChevronLeft className="size-4" />Previous</Button><Button disabled={page >= data.pageCount} size="sm" variant="outline" onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="size-4" /></Button></div></div></CardContent></Card>;
}
