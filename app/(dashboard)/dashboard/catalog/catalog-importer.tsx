'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Upload, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { uploadSignedFile } from '@/lib/assets/upload-client';

const fetchJson = async (input: RequestInfo, init?: RequestInit) => {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const diagnostic = body.diagnostic as { message?: string; recommendation?: string } | undefined;
    throw new Error(
      diagnostic
        ? [diagnostic.message, diagnostic.recommendation].filter(Boolean).join(' ')
        : body.error ?? 'Request failed.',
    );
  }
  return body;
};

function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', buffer).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  );
}

type ImportIssue = { code?: string; field?: string; message?: string };
type ImportRow = {
  rowNumber: number;
  status: 'pending' | 'ready' | 'needs_fix' | 'excluded' | 'committed';
  rawValues: Record<string, string>;
  normalizedValues: {
    primaryImageUrl?: string;
    primaryAssetId?: number;
    brandKitName?: string;
  } | null;
  errors: ImportIssue[];
};
type BrandKitOption = { id: number; name: string };
type ImportBatch = {
  id: number;
  status: string;
  templateVersion: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
};
type RowDecision = 'create' | 'update' | 'exclude';

function hasExistingSku(row: ImportRow): boolean {
  return row.errors.some((error) => error.code === 'catalog_duplicate_sku');
}

function defaultDecision(row: ImportRow): RowDecision | '' {
  if (row.status !== 'ready') return '';
  return hasExistingSku(row) ? 'update' : 'create';
}

function hasBrandKitIssue(row: ImportRow): boolean {
  return row.errors.some((error) => [
    'unknown_brand_kit_name',
    'ambiguous_brand_kit_name',
    'brand_kit_not_in_workspace',
  ].includes(error.code ?? ''));
}

export function CatalogImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [brandKits, setBrandKits] = useState<BrandKitOption[]>([]);
  const [workspaceName, setWorkspaceName] = useState('');
  const [bulkBrandKit, setBulkBrandKit] = useState('');
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});
  const [editingRow, setEditingRow] = useState<ImportRow | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadPreview = async (batchId: number) => {
    const result = await fetchJson(`/api/bulk/csv/${batchId}?page=1&pageSize=50`);
    const nextRows = result.rows as ImportRow[];
    setBatch(result.batch);
    setRows(nextRows);
    setBrandKits(result.brandKits ?? []);
    setWorkspaceName(result.workspace?.name ?? '');
    setDecisions((current) => {
      const next = { ...current };
      for (const row of nextRows) {
        if (!next[String(row.rowNumber)]) {
          const decision = defaultDecision(row);
          if (decision) next[String(row.rowNumber)] = decision;
        }
      }
      return next;
    });
  };

  useEffect(() => {
    if (!batch || !['uploaded', 'validating'].includes(batch.status)) return;
    const timer = window.setTimeout(() => {
      void loadPreview(batch.id).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not refresh import.'));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [batch]);

  const readyRows = useMemo(() => rows.filter((row) => row.status === 'ready').length, [rows]);
  const errorRows = useMemo(() => rows.filter((row) => row.status === 'needs_fix').length, [rows]);
  const unresolvedBrandRows = useMemo(() => rows.filter(hasBrandKitIssue), [rows]);

  async function uploadCsv() {
    if (!file) return;
    setBusy(true);
    setMessage('Signing CSV upload…');
    try {
      const buffer = await file.arrayBuffer();
      const fileHash = await sha256Hex(buffer);
      const signed = await fetchJson('/api/bulk/csv/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ byteSize: file.size, contentType: 'text/csv' }),
      });
      setMessage('Transferring CSV to object storage…');
      await uploadSignedFile({ file, signed });
      setMessage('Creating import batch…');
      const created = await fetchJson('/api/bulk/csv/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectKey: signed.objectKey,
          fileHash,
          idempotencyKey: `${fileHash}:${file.size}`,
          templateVersion: 'v2',
        }),
      });
      await loadPreview(created.importBatch.id);
      setMessage('CSV uploaded. Worker validation and remote asset verification are running.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload CSV.');
    } finally {
      setBusy(false);
    }
  }

  async function exclude(rowNumber: number) {
    if (!batch) return;
    setBusy(true);
    try {
      await fetchJson(`/api/bulk/csv/${batch.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'exclude', rowNumbers: [rowNumber] }),
      });
      await loadPreview(batch.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not exclude row.');
    } finally {
      setBusy(false);
    }
  }

  async function updateRow() {
    if (!batch || !editingRow) return;
    setBusy(true);
    try {
      await fetchJson(`/api/bulk/csv/${batch.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', rowNumber: editingRow.rowNumber, rawValues: editingValues }),
      });
      setEditingRow(null);
      setMessage(`Row ${editingRow.rowNumber} updated. Revalidate if any asset URL changed.`);
      await loadPreview(batch.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update import row.');
    } finally {
      setBusy(false);
    }
  }

  async function mapBrandKit(rowNumbers: number[], brandKitName: string) {
    if (!batch || rowNumbers.length === 0 || !brandKitName) return;
    setBusy(true);
    try {
      await fetchJson(`/api/bulk/csv/${batch.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'map_brand_kit', rowNumbers, brandKitName }),
      });
      setMessage(`${rowNumbers.length} row${rowNumbers.length === 1 ? '' : 's'} mapped to ${brandKitName}.`);
      await loadPreview(batch.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not map Brand Kit.');
    } finally {
      setBusy(false);
    }
  }

  async function revalidate() {
    if (!batch) return;
    setBusy(true);
    try {
      await fetchJson(`/api/bulk/csv/${batch.id}/revalidate`, { method: 'POST' });
      setBatch((current) => current ? { ...current, status: 'validating' } : current);
      setMessage('Worker revalidation queued.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not revalidate import.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!batch) return;
    setBusy(true);
    try {
      const result = await fetchJson(`/api/bulk/csv/${batch.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions }),
      });
      setMessage(`${result.catalogItemIds.length} SKU rows committed to Catalog.`);
      await loadPreview(batch.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not commit import.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-orange-600">SKU Catalog</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">Import product data</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Upload, validate, repair, and commit product rows. Brand Kits resolve by name inside the current Workspace.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/api/bulk/csv/template"><Download className="mr-2 size-4" />Download v2 template</a>
        </Button>
      </section>

      <Card>
        <CardHeader><CardTitle>Upload CSV</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <Button disabled={!file || busy} onClick={() => void uploadCsv()}>
            <Upload className="mr-2 size-4" />Upload and validate
          </Button>
        </CardContent>
      </Card>

      {message && <p className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">{message}</p>}
      {batch?.totalRows === 1 && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Importing one SKU is valid. For faster single-product entry, use <a className="font-medium underline" href="/dashboard/catalog/new">Add product</a>.
        </p>
      )}
      {editingRow && (
        <Card>
          <CardHeader><CardTitle>Repair import row {editingRow.rowNumber}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {Object.entries(editingValues).map(([field, value]) => (
              <label className="grid gap-1 text-sm font-medium" key={field}>
                {field}
                <Input value={value} onChange={(event) => setEditingValues((current) => ({ ...current, [field]: event.target.value }))} />
              </label>
            ))}
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void updateRow()}>Save row</Button>
              <Button variant="outline" onClick={() => setEditingRow(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {batch && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Import #{batch.id}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workspaceName} · {batch.templateVersion} · {batch.status} · {readyRows} ready · {errorRows} needs input
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline"><a href={`/api/bulk/csv/${batch.id}/errors`}><Download className="mr-2 size-4" />Errors</a></Button>
                <Button asChild variant="outline"><a href={`/api/bulk/csv/${batch.id}/repaired`}><Download className="mr-2 size-4" />Repaired v2</a></Button>
                <Button disabled={busy} onClick={() => void revalidate()} variant="outline"><RefreshCw className="mr-2 size-4" />Revalidate</Button>
                <Button disabled={busy || batch.status === 'committed'} onClick={() => void commit()}>Commit ready rows</Button>
              </div>
            </div>
            {unresolvedBrandRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <span>Map {unresolvedBrandRows.length} unresolved row{unresolvedBrandRows.length === 1 ? '' : 's'}:</span>
                <select className="rounded-md border border-gray-300 bg-white px-2 py-1" value={bulkBrandKit} onChange={(event) => setBulkBrandKit(event.target.value)}>
                  <option value="">Choose Brand Kit</option>
                  {brandKits.map((kit) => <option key={kit.id} value={kit.name}>{kit.name}</option>)}
                </select>
                <Button disabled={busy || !bulkBrandKit} onClick={() => void mapBrandKit(unresolvedBrandRows.map((row) => row.rowNumber), bulkBrandKit)} size="sm">Apply to unresolved rows</Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="border-y border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Row</th><th className="px-4 py-3">Image</th><th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Product</th><th className="px-4 py-3">Brand Kit</th><th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Decision</th><th className="px-4 py-3">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => {
                  const imageUrl = row.normalizedValues?.primaryAssetId
                    ? `/api/assets/${row.normalizedValues.primaryAssetId}/download`
                    : row.normalizedValues?.primaryImageUrl;
                  const advisoryOnly = row.errors.length > 0 && row.errors.every((error) => error.code === 'catalog_duplicate_sku');
                  return (
                    <tr key={row.rowNumber}>
                      <td className="px-4 py-3">{row.rowNumber}</td>
                      <td className="px-4 py-3">
                        {row.status === 'ready' && imageUrl
                          ? <img alt="" className="size-12 rounded-md border object-cover" src={imageUrl} />
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 font-medium">{row.rawValues.external_sku || '—'}</td>
                      <td className="px-4 py-3">{row.rawValues.product_name || '—'}</td>
                      <td className="px-4 py-3">
                        <select
                          className="max-w-44 rounded-md border border-gray-300 px-2 py-1"
                          disabled={busy || batch.templateVersion === 'v1'}
                          value={row.normalizedValues?.brandKitName ?? row.rawValues.brand_kit_name ?? ''}
                          onChange={(event) => void mapBrandKit([row.rowNumber], event.target.value)}
                        >
                          <option value="">Choose</option>
                          {brandKits.map((kit) => <option key={kit.id} value={kit.name}>{kit.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs">{row.status}</span></td>
                      <td className="px-4 py-3">
                        <select
                          className="rounded-md border border-gray-300 px-2 py-1"
                          value={decisions[String(row.rowNumber)] ?? defaultDecision(row)}
                          onChange={(event) => setDecisions((current) => ({ ...current, [row.rowNumber]: event.target.value as RowDecision }))}
                        >
                          <option value="">Choose</option><option value="create">Create</option><option value="update">Update</option><option value="exclude">Exclude</option>
                        </select>
                      </td>
                      <td className={`max-w-[360px] px-4 py-3 text-xs ${advisoryOnly ? 'text-amber-700' : 'text-red-700'}`}>
                        {row.errors.length === 0 ? '—' : <span>{row.errors.map((error) => `${error.field ?? 'row'}: ${error.message ?? error.code}`).join(' · ')}</span>}
                        {row.status === 'needs_fix' && <Button className="ml-2 h-7 px-2" disabled={busy} onClick={() => void exclude(row.rowNumber)} size="sm" variant="ghost"><XCircle className="mr-1 size-3" />Exclude</Button>}
                        {row.status === 'needs_fix' && <Button className="ml-2 h-7 px-2" disabled={busy} onClick={() => { setEditingRow(row); setEditingValues(row.rawValues); }} size="sm" variant="ghost">Repair</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Waiting for the CSV worker to write rows.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
