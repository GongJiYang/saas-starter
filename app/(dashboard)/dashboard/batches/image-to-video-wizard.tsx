'use client';
import Link from 'next/link';

import { useEffect, useMemo, useState } from 'react';
import { DragEvent } from 'react';
import { CheckCircle2, Clock3, Film, ImagePlus, Loader2, UploadCloud, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MAX_FILES = 500;
const MAX_CONCURRENCY = 4;
type UploadState = 'waiting' | 'signing' | 'uploading' | 'archiving' | 'ready' | 'failed';
type LocalFile = { id: string; file: File; state: UploadState; error?: string; uploadId?: number };
type SignedUpload = { uploadId: number; url: string; headers: Record<string, string>; completeUrl: string };
type RecoveredUpload = { id: number; clientFileId: string | null; fileName: string; byteSize: number; status: string; errorMessage: string | null };

function addFiles(current: LocalFile[], files: File[]) {
  const next = files.slice(0, Math.max(0, MAX_FILES - current.length)).map((file) => ({ id: crypto.randomUUID(), file, state: 'waiting' as const }));
  return [...current, ...next];
}

async function requestJson(path: string, init: RequestInit) {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Request failed.');
  return body;
}

export function ImageToVideoBatchWizard() {
  const [name, setName] = useState('Image-to-Video batch');
  const [prompt, setPrompt] = useState('Animate the supplied reference image with subtle, controlled motion. Preserve the subject, composition, colors, and details exactly.');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [duration, setDuration] = useState('5');
  const [platform, setPlatform] = useState('tiktok');
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [recoveredUploads, setRecoveredUploads] = useState<RecoveredUpload[]>([]);

  useEffect(() => {
    const stored = window.localStorage.getItem('image-video-upload-batch');
    const recoveredBatchId = Number(stored);
    if (!Number.isSafeInteger(recoveredBatchId) || recoveredBatchId <= 0) return;
    setBatchId(recoveredBatchId);
    void requestJson(`/api/production-batches/${recoveredBatchId}/uploads`, { method: 'GET' })
      .then((result: { uploads?: RecoveredUpload[] }) => {
        const uploads = result.uploads ?? [];
        setRecoveredUploads(uploads);
        setMessage(`Recovered Batch #${recoveredBatchId} with ${uploads.length} recorded uploads. Re-select failed local files to retry them.`);
      })
      .catch(() => window.localStorage.removeItem('image-video-upload-batch'));
  }, []);

  const counts = useMemo(() => files.reduce((result, item) => {
    result[item.state] = (result[item.state] ?? 0) + 1;
    return result;
  }, {} as Record<string, number>), [files]);

  function choose(filesToAdd: FileList | File[]) {
    const accepted = [...filesToAdd].filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 20 * 1024 * 1024);
    setFiles((current) => {
      const additions = accepted.slice(0, Math.max(0, MAX_FILES - current.length)).map((file) => {
        const recovered = recoveredUploads.find((upload) => upload.fileName === file.name && upload.byteSize === file.size && upload.status !== 'completed' && upload.clientFileId);
        return recovered
          ? { id: recovered.clientFileId!, file, state: 'failed' as const, error: recovered.errorMessage ?? 'Recovered upload is ready to retry.', uploadId: recovered.id }
          : { id: crypto.randomUUID(), file, state: 'waiting' as const };
      });
      return [...current, ...additions];
    });
    if (accepted.length !== filesToAdd.length) setMessage('Only JPEG, PNG, and WebP images up to 20 MB were added.');
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    choose(event.dataTransfer.files);
  }

  async function uploadOne(item: LocalFile, id: number, currentBatchId: number) {
    const update = (state: UploadState, error?: string) => setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, state, error } : entry));
    try {
      update('signing');
      const signed = await requestJson(`/api/production-batches/${currentBatchId}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientFileId: item.id, sequence: id + 1, fileName: item.file.name, contentType: item.file.type, byteSize: item.file.size }),
      }) as SignedUpload;
      setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, uploadId: signed.uploadId } : entry));
      update('uploading');
      const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: item.file });
      if (!put.ok) throw new Error(`Storage upload returned ${put.status}.`);
      update('archiving');
      await requestJson(signed.completeUrl, { method: 'POST' });
      update('ready');
    } catch (error) {
      update('failed', error instanceof Error ? error.message : 'Upload failed.');
    }
  }

  async function createAndUpload() {
    if (!name.trim() || !prompt.trim() || files.length === 0 || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await requestJson('/api/production-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceMode: 'uploaded_images', name, sharedPrompt: prompt, targetPlatform: platform, durationSeconds: Number(duration), campaignGoal: 'Image-to-video production' }),
      }) as { batch: { id: number } };
      setBatchId(result.batch.id);
      window.localStorage.setItem('image-video-upload-batch', String(result.batch.id));
      let cursor = 0;
      async function worker() {
        while (cursor < files.length) {
          const index = cursor++;
          await uploadOne(files[index]!, index, result.batch.id);
        }
      }
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, files.length) }, () => worker()));
      setMessage('Upload queue finished. Ready items are attached to the Production Batch.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create Image-to-Video Batch.');
    } finally {
      setBusy(false);
    }
  }

  async function retryFailed() {
    if (!batchId || busy) return;
    const currentBatchId = batchId;
    const failed = files.filter((item) => item.state === 'failed');
    setBusy(true);
    let cursor = 0;
    async function worker() {
      while (cursor < failed.length) {
        const item = failed[cursor++]!;
        const index = files.findIndex((entry) => entry.id === item.id);
        await uploadOne(item, index, currentBatchId);
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, failed.length) }, () => worker()));
    setBusy(false);
    setMessage('Failed uploads retried.');
  }

  async function removeFile(item: LocalFile) {
    if (item.uploadId && batchId) {
      await fetch(`/api/production-batches/${batchId}/uploads/${item.uploadId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    setFiles((current) => current.filter((entry) => entry.id !== item.id));
  }

  return (
    <div className="overflow-hidden rounded-[1.75rem] bg-[#0b0d10] text-slate-100 shadow-2xl shadow-slate-950/15 ring-1 ring-slate-900/10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-orange-500 text-slate-950"><WandSparkles className="size-5" /></span>
          <div><p className="font-semibold">Build your image set</p><p className="text-xs text-slate-400">One image becomes one independent video</p></div>
        </div>
        <ol className="flex items-center gap-2 text-xs text-slate-500" aria-label="Image-to-Video workflow">
          <li className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-950">1 · Upload</li>
          <li className="hidden sm:block">2 · Pilot</li>
          <li className="hidden sm:block">3 · Review</li>
          <li className="hidden sm:block">4 · Deliver</li>
        </ol>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="min-w-0 space-y-5 p-5 sm:p-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-400">Reference images</p>
            <h2 className="mt-1 text-xl font-semibold">Add the products you want to animate</h2>
            <p className="mt-1 text-sm text-slate-400">The image is a visual reference—not a required first or last frame.</p>
          </div>

          <label className="group flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/70 p-8 text-center transition-colors hover:border-orange-400 hover:bg-slate-900" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <span className="flex size-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-orange-400 transition-transform group-hover:-translate-y-1"><UploadCloud className="size-7" /></span>
            <span className="mt-4 text-base font-semibold">Drop images here</span>
            <span className="mt-1 text-sm text-slate-400">or click to choose files from your computer</span>
            <span className="mt-4 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">JPEG, PNG or WebP · 20 MB max · {files.length}/{MAX_FILES}</span>
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { if (event.target.files) choose(event.target.files); event.currentTarget.value = ''; }} />
          </label>

          {files.length ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-sm font-semibold">Upload queue</h3><p className="text-xs text-slate-500">Files keep their displayed sequence through generation and delivery.</p></div>
                <span className="text-xs text-slate-400">{Object.entries(counts).map(([state, count]) => `${state}: ${count}`).join(' · ')}</span>
              </div>
              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {files.map((item, index) => (
                  <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900 p-2.5 text-xs" key={item.id}>
                    <FilePreview file={item.file} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-200" title={item.file.name}>{index + 1}. {item.file.name}</p>
                      <p className={`mt-1 break-words ${item.state === 'failed' ? 'text-red-300' : item.state === 'ready' ? 'text-emerald-300' : 'text-slate-400'}`}>
                        {item.state === 'ready' ? <CheckCircle2 className="mr-1 inline size-3" /> : <Clock3 className="mr-1 inline size-3" />}
                        {item.state}{item.error ? ` · ${item.error}` : ''}
                      </p>
                    </div>
                    {item.state !== 'ready' ? <button className="rounded-md px-1.5 py-0.5 text-slate-500 hover:bg-slate-800 hover:text-red-300" type="button" onClick={() => void removeFile(item)} aria-label={`Remove ${item.file.name}`}>×</button> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <StudioNote icon={<ImagePlus className="size-4" />} title="Up to 500 images" text="Stable ordering and retry per file." />
              <StudioNote icon={<Film className="size-4" />} title="One image, one video" text="No automatic stitching or timeline." />
              <StudioNote icon={<CheckCircle2 className="size-4" />} title="Pilot before scale" text="Review a small sample before the full run." />
            </div>
          )}
        </section>

        <aside className="space-y-5 border-t border-white/10 bg-slate-950/80 p-5 sm:p-7 lg:border-l lg:border-t-0">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-400">Motion direction</p><h2 className="mt-1 text-lg font-semibold">Batch settings</h2></div>
          <label className="block space-y-1.5 text-xs font-medium text-slate-300">
            Batch name
            <Input aria-label="Image batch name" className="border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-600" value={name} onChange={(event) => setName(event.target.value)} placeholder="Summer product motion" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5 text-xs font-medium text-slate-300">
              Platform
              <Input aria-label="Image batch platform" className="border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-600" value={platform} onChange={(event) => setPlatform(event.target.value)} placeholder="TikTok" />
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-slate-300">
              Duration
              <select aria-label="Image batch duration" className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-orange-400" value={duration} onChange={(event) => setDuration(event.target.value)}>{[4, 5, 6, 8, 10, 12, 15].map((value) => <option key={value} value={value}>{value}s</option>)}</select>
            </label>
          </div>
          <label className="block space-y-1.5 text-xs font-medium text-slate-300">
            Shared motion prompt
            <textarea aria-label="Shared animation prompt" className="min-h-44 w-full resize-y rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe camera and subject motion…" />
          </label>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-slate-900 px-2 py-2"><span className="block text-slate-500">Output</span><b className="mt-0.5 block text-slate-200">9:16</b></div>
            <div className="rounded-lg bg-slate-900 px-2 py-2"><span className="block text-slate-500">Quality</span><b className="mt-0.5 block text-slate-200">768P</b></div>
            <div className="rounded-lg bg-slate-900 px-2 py-2"><span className="block text-slate-500">Uploads</span><b className="mt-0.5 block text-slate-200">4 at once</b></div>
          </div>

          <div className="space-y-2 border-t border-white/10 pt-5">
            {batchId && counts.failed ? <Button className="w-full border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white" disabled={busy} variant="outline" onClick={() => void retryFailed()}>Retry failed uploads</Button> : null}
            {batchId ? <Button asChild className="w-full border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white" variant="outline"><Link href={`/dashboard/batches/${batchId}`}>Open batch workspace</Link></Button> : null}
            {!batchId ? <Button className="w-full bg-orange-500 text-slate-950 shadow-lg shadow-orange-950/30 hover:bg-orange-400 hover:text-slate-950" disabled={busy || !name.trim() || !prompt.trim() || files.length === 0} onClick={() => void createAndUpload()}>{busy ? <><Loader2 className="size-4 animate-spin" />Uploading…</> : 'Create and upload batch'}</Button> : null}
            <p className="text-center text-[11px] leading-4 text-slate-500">Creating a batch does not submit paid generation. Cost confirmation comes before Pilot.</p>
          </div>
          {message ? <p className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm leading-5 text-slate-300">{message}</p> : null}
        </aside>
      </div>
    </div>
  );
}

function StudioNote({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><span className="text-orange-400">{icon}</span><p className="mt-2 text-xs font-semibold text-slate-200">{title}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{text}</p></div>;
}

function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img className="size-10 rounded object-cover" src={url} alt="" /> : <span className="size-10 rounded bg-slate-800" />;
}
