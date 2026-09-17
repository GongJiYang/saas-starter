'use client';

import { useEffect, useState } from 'react';
import { Film, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { uploadSignedFile } from '@/lib/assets/upload-client';

async function requestJson(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body;
}

type Reference = {
  id: number;
  sourceId: string;
  rights: 'owned' | 'licensed' | 'inspiration_only';
  mode: 'structure' | 'owned_template';
  contentType: string;
  byteSize: number;
  durationSeconds: string | null;
  ratio: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudioTrack: boolean | null;
  readabilityStatus: string;
  status: string;
  analysis: {
    id: number;
    status: string;
    analysisSnapshot: string;
    borrowedStructure: string;
    excludedContent: string;
  } | null;
};

export function ReferenceWorkbench() {
  const [references, setReferences] = useState<Reference[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState('reference-1');
  const [rights, setRights] = useState<Reference['rights']>('owned');
  const [mode, setMode] = useState<'structure' | 'owned_template'>('structure');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function loadReferences() {
    const result = await requestJson('/api/bulk/references');
    setReferences(result.references);
  }

  useEffect(() => {
    void loadReferences().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not load references.'));
  }, []);

  useEffect(() => {
    if (!references.some((reference) => ['uploaded', 'analyzing'].includes(reference.status))) return;
    const timer = window.setTimeout(() => void loadReferences(), 2000);
    return () => window.clearTimeout(timer);
  }, [references]);

  async function uploadReference() {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const contentType = file.type as 'video/mp4' | 'video/quicktime' | 'video/webm';
      const signed = await requestJson('/api/bulk/references/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, rights, mode, contentType, byteSize: file.size }),
      });
      await uploadSignedFile({ file, signed });
      await requestJson('/api/bulk/references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, rights, mode, objectKey: signed.objectKey, contentType, byteSize: file.size }),
      });
      setFile(null);
      setMessage('Reference uploaded. Technical probing and structure analysis are running.');
      await loadReferences();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload reference.');
    } finally {
      setBusy(false);
    }
  }

  async function approve(analysisId: number) {
    setBusy(true);
    try {
      await requestJson(`/api/bulk/reference-analyses/${analysisId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      await loadReferences();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not approve analysis.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-orange-600">Creative references</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">Reference video analysis</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Use structure and pacing as reference. The system never promises pixel-level cloning.</p>
        </div>
        <Button disabled={busy} onClick={() => void loadReferences()} variant="outline"><RefreshCw className="mr-2 size-4" />Refresh</Button>
      </section>

      <Card>
        <CardHeader><CardTitle>Upload a reference video</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Input value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="Reference ID" />
          <Input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <label className="grid gap-1 text-sm"><span className="font-medium">Rights</span><select className="rounded-md border border-gray-300 px-3 py-2" value={rights} onChange={(event) => { const next = event.target.value as Reference['rights']; setRights(next); if (next === 'inspiration_only') setMode('structure'); }}>{['owned', 'licensed', 'inspiration_only'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="grid gap-1 text-sm"><span className="font-medium">Mode</span><select className="rounded-md border border-gray-300 px-3 py-2" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="structure">Structure reference</option><option disabled={rights === 'inspiration_only'} value="owned_template">Reuse owned structure only</option></select></label>
          <Button className="md:col-span-2" disabled={!file || !sourceId || busy} onClick={() => void uploadReference()}><Upload className="mr-2 size-4" />Upload and analyze</Button>
        </CardContent>
      </Card>

      {message && <p className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">{message}</p>}

      <div className="grid gap-4">
        {references.map((reference) => {
          const analysis = reference.analysis;
          const parsed = analysis ? safeJson<Record<string, unknown>>(analysis.analysisSnapshot, {}) : null;
          return (
            <Card key={`${reference.id}-${analysis?.id ?? 'none'}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><Film className="size-5 text-orange-600" />{reference.sourceId}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{reference.rights} · {reference.mode} · {reference.status}</p></div>{analysis?.status === 'draft' && <Button disabled={busy} onClick={() => void approve(analysis.id)}>Approve analysis</Button>}</CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid gap-2 sm:grid-cols-4"><span>Readability: <b>{reference.readabilityStatus}</b></span><span>Duration: <b>{reference.durationSeconds ?? '—'}s</b></span><span>Ratio: <b>{reference.ratio ?? '—'}</b></span><span>Audio: <b>{reference.hasAudioTrack ? reference.audioCodec ?? 'yes' : 'none'}</b></span></div>
                {analysis ? <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2"><div><p className="font-medium">Borrowed structure</p><p className="mt-1 text-muted-foreground">{jsonList(analysis.borrowedStructure)}</p></div><div><p className="font-medium">Explicitly excluded</p><p className="mt-1 text-muted-foreground">{jsonList(analysis.excludedContent)}</p></div><div className="md:col-span-2"><p className="font-medium">Shot map</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{Array.isArray(parsed?.shots) && parsed.shots.map((shot, index) => <div className="rounded-md bg-gray-50 p-3 text-xs" key={index}>{String((shot as Record<string, unknown>).role)} · {String((shot as Record<string, unknown>).fromSeconds)}–{String((shot as Record<string, unknown>).toSeconds)}s</div>)}</div></div></div> : <p className="text-muted-foreground">Analysis is pending.</p>}
              </CardContent>
            </Card>
          );
        })}
        {references.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No reference videos yet.</CardContent></Card>}
      </div>
    </div>
  );
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function jsonList(value: string): string {
  const parsed = safeJson<unknown[]>(value, []);
  return parsed.join(', ') || '—';
}
