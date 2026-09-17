'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductImageUploader, type ProductImageValue } from './product-image-uploader';
import {
  compactCatalogProductInput,
  previewCatalogReadiness,
  type CatalogConflict,
  type CatalogProductInput,
} from '@/lib/catalog/contracts';

type BrandOption = { id: number; name: string };
type Claim = { text: string; source: string };

type Props = {
  mode: 'create' | 'edit';
  brandKits: BrandOption[];
  initialValue?: CatalogProductInput;
  catalogItemId?: number;
  existingDetailAssetCount?: number;
  initialPrimaryAsset?: ProductImageValue;
  initialDetailAssets?: ProductImageValue[];
};

const inputClassName = 'h-10 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none ring-orange-500 transition focus:ring-2';
const textareaClassName = 'min-h-24 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-orange-500 transition focus:ring-2';

function emptyProduct(brandKits: BrandOption[]): CatalogProductInput {
  return {
    externalSku: '',
    productName: '',
    category: '',
    primaryImageUrl: '',
    productPageUrl: undefined,
    primaryImageAuthorized: false,
    primaryAssetId: null,
    detailImageUrls: [],
    detailAssetIds: [],
    approvedClaims: [],
    prohibitedClaims: [],
    mustShowElements: [],
    immutableElements: [],
    targetAudience: '',
    campaignGoal: '',
    platform: 'tiktok',
    durationSeconds: 5,
    brandKitId: brandKits[0]?.id ?? 0,
    cta: '',
  };
}

function ClaimEditor({ value, onChange }: { value: Claim[]; onChange: (value: Claim[]) => void }) {
  const rows = value.length > 0 ? value : [{ text: '', source: '' }];
  function update(index: number, field: keyof Claim, nextValue: string) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: nextValue } : row));
  }
  return <div className="space-y-2">
    {rows.map((claim, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" key={index}>
      <Input aria-label={`Approved claim ${index + 1}`} onChange={(event) => update(index, 'text', event.target.value)} placeholder="Approved claim" value={claim.text} />
      <Input aria-label={`Approved claim source ${index + 1}`} onChange={(event) => update(index, 'source', event.target.value)} placeholder="Evidence source" value={claim.source} />
      <Button aria-label={`Remove approved claim ${index + 1}`} disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} size="icon" type="button" variant="outline"><Trash2 className="size-4" /></Button>
    </div>)}
    <Button disabled={rows.length >= 5} onClick={() => onChange([...rows, { text: '', source: '' }])} size="sm" type="button" variant="outline"><Plus className="mr-2 size-4" />Add claim</Button>
  </div>;
}

function StringListEditor({ label, value, onChange, maxRows = 5 }: { label: string; value: string[]; onChange: (value: string[]) => void; maxRows?: number }) {
  const rows = value.length > 0 ? value : [''];
  return <div className="space-y-2">
    {rows.map((entry, index) => <div className="flex gap-2" key={index}>
      <Input aria-label={`${label} ${index + 1}`} onChange={(event) => onChange(rows.map((row, rowIndex) => rowIndex === index ? event.target.value : row))} placeholder={label} value={entry} />
      <Button aria-label={`Remove ${label} ${index + 1}`} disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} size="icon" type="button" variant="outline"><Trash2 className="size-4" /></Button>
    </div>)}
    <Button disabled={rows.length >= maxRows} onClick={() => onChange([...rows, ''])} size="sm" type="button" variant="outline"><Plus className="mr-2 size-4" />Add row</Button>
  </div>;
}

export function ProductForm({ mode, brandKits, initialValue, catalogItemId, existingDetailAssetCount = 0, initialPrimaryAsset, initialDetailAssets = [] }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<CatalogProductInput>(() => initialValue ?? emptyProduct(brandKits));
  const [detailUrlsTouched, setDetailUrlsTouched] = useState(false);
  const [primaryAssetTouched, setPrimaryAssetTouched] = useState(false);
  const [detailAssetsTouched, setDetailAssetsTouched] = useState(false);
  const [pendingCleanupUploadIds, setPendingCleanupUploadIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<CatalogConflict | null>(null);
  const readiness = useMemo(() => previewCatalogReadiness(compactCatalogProductInput(value)), [value]);

  function update<K extends keyof CatalogProductInput>(field: K, nextValue: CatalogProductInput[K]) {
    setValue((current) => ({ ...current, [field]: nextValue }));
    setConflict(null);
  }

  async function submit() {
    if (brandKits.length === 0 || (mode === 'edit' && !catalogItemId)) return;
    setBusy(true);
    setMessage('');
    setConflict(null);
    const compact = compactCatalogProductInput(value);
    const { externalSku: _externalSku, primaryAssetId: _primaryAssetId, detailAssetIds: _detailAssetIds, ...editable } = compact;
    const body = mode === 'create'
      ? compact
      : {
          ...editable,
          ...(primaryAssetTouched ? { primaryAssetId: compact.primaryAssetId ?? null } : {}),
          ...(detailAssetsTouched ? { detailAssetIds: compact.detailAssetIds } : {}),
          ...(detailUrlsTouched ? { detailImageUrls: compact.detailImageUrls } : { detailImageUrls: undefined }),
        };
    try {
      const response = await fetch(mode === 'create' ? '/api/catalog' : `/api/catalog/${catalogItemId}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        conflict?: CatalogConflict;
        item?: { id: number; readinessStatus: string };
      };
      if (response.status === 409 && result.conflict) {
        setConflict(result.conflict);
        setMessage(result.error ?? 'SKU already exists.');
        return;
      }
      if (!response.ok || !result.item) throw new Error(result.error ?? 'Catalog SKU could not be saved.');
      if (pendingCleanupUploadIds.length > 0) {
        await Promise.all(pendingCleanupUploadIds.map((uploadId) => fetch(`/api/assets/product-images/${uploadId}`, { method: 'DELETE' })));
        setPendingCleanupUploadIds([]);
      }
      if (mode === 'create') router.push(`/dashboard/catalog/${result.item.id}`);
      else {
        setMessage(`SKU saved as ${result.item.readinessStatus}.`);
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Catalog SKU could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  if (brandKits.length === 0) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Create a <Link className="font-medium underline" href="/dashboard/brand-kits">Brand Kit</Link> before adding a product.</div>;
  }

  return <div className="space-y-8">
    <section className="grid gap-5 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium">SKU<Input disabled={mode === 'edit'} maxLength={160} onChange={(event) => update('externalSku', event.target.value)} placeholder="Workspace-unique SKU" value={value.externalSku} /></label>
      <label className="grid gap-2 text-sm font-medium">Product name<Input maxLength={255} onChange={(event) => update('productName', event.target.value)} value={value.productName} /></label>
      <label className="grid gap-2 text-sm font-medium">Category<Input maxLength={100} onChange={(event) => update('category', event.target.value)} value={value.category} /></label>
      <label className="grid gap-2 text-sm font-medium">Brand Kit<select className={inputClassName} onChange={(event) => update('brandKitId', Number(event.target.value))} value={value.brandKitId}>{brandKits.map((brandKit) => <option key={brandKit.id} value={brandKit.id}>{brandKit.name}</option>)}</select></label>
      <div className="grid gap-3 sm:col-span-2"><ProductImageUploader initialAssets={initialPrimaryAsset ? [initialPrimaryAsset] : []} label="Local primary product image" maximum={1} onChange={(images) => { const image = images[0]; setPrimaryAssetTouched(true); update('primaryAssetId', image?.assetId ?? null); if (image) { update('primaryImageUrl', ''); update('primaryImageAuthorized', true); } }} onRemoveInitial={(uploadId) => setPendingCleanupUploadIds((current) => [...new Set([...current, uploadId])])} /><label className="grid gap-2 text-sm font-medium">Or use a primary image HTTPS URL<Input disabled={Boolean(value.primaryAssetId)} onChange={(event) => update('primaryImageUrl', event.target.value)} placeholder={value.primaryAssetId ? 'Remove the local image to use a URL' : 'https://…/product.jpg'} type="url" value={value.primaryImageUrl} /></label></div>
      <label className="grid gap-2 text-sm font-medium sm:col-span-2">Product page HTTPS URL (optional)<Input onChange={(event) => update('productPageUrl', event.target.value)} placeholder="https://…/product" type="url" value={value.productPageUrl ?? ''} /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input checked={value.primaryImageAuthorized} onChange={(event) => update('primaryImageAuthorized', event.target.checked)} type="checkbox" />I confirm this Workspace may use the product image.</label>
      <div className="grid gap-2 sm:col-span-2"><ProductImageUploader initialAssets={initialDetailAssets} label="Local detail images" maximum={9} onChange={(images) => { setDetailAssetsTouched(true); update('detailAssetIds', images.map((image) => image.assetId)); if (images.length > 0) update('detailImageUrls', []); }} onRemoveInitial={(uploadId) => setPendingCleanupUploadIds((current) => [...new Set([...current, uploadId])])} /></div>
      <div className="grid gap-2 sm:col-span-2"><span className="text-sm font-medium">Or use detail image HTTPS URLs (optional, up to 9)</span><StringListEditor label="Detail image URL" maxRows={9} onChange={(entries) => { setDetailUrlsTouched(true); update('detailImageUrls', entries); }} value={value.detailImageUrls} />{mode === 'edit' && existingDetailAssetCount > 0 && !detailUrlsTouched && !detailAssetsTouched ? <p className="text-xs text-muted-foreground">{existingDetailAssetCount} archived detail images will be retained. Entering new URLs replaces them.</p> : null}</div>
    </section>

    <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
      <div><h2 className="font-semibold">Approved claims</h2><p className="text-sm text-muted-foreground">Every claim requires its evidence source.</p></div>
      <ClaimEditor onChange={(claims) => update('approvedClaims', claims)} value={value.approvedClaims} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-2"><h3 className="text-sm font-medium">Prohibited claims</h3><StringListEditor label="Prohibited claim" onChange={(entries) => update('prohibitedClaims', entries)} value={value.prohibitedClaims} /></div>
        <div className="space-y-2"><h3 className="text-sm font-medium">Must-show elements</h3><StringListEditor label="Must-show element" onChange={(entries) => update('mustShowElements', entries)} value={value.mustShowElements} /></div>
        <div className="space-y-2"><h3 className="text-sm font-medium">Immutable elements</h3><StringListEditor label="Immutable element" onChange={(entries) => update('immutableElements', entries)} value={value.immutableElements} /></div>
      </div>
    </section>

    <section className="grid gap-5 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium">Target audience<textarea className={textareaClassName} onChange={(event) => update('targetAudience', event.target.value)} value={value.targetAudience} /></label>
      <label className="grid gap-2 text-sm font-medium">Campaign goal<textarea className={textareaClassName} onChange={(event) => update('campaignGoal', event.target.value)} value={value.campaignGoal} /></label>
      <label className="grid gap-2 text-sm font-medium">Platform<select className={inputClassName} onChange={(event) => update('platform', event.target.value)} value={value.platform}><option value="tiktok">TikTok</option><option value="instagram_reels">Instagram Reels</option><option value="youtube_shorts">YouTube Shorts</option></select></label>
      <label className="grid gap-2 text-sm font-medium">Duration (4–15 seconds)<Input max={15} min={4} onChange={(event) => update('durationSeconds', Number(event.target.value))} type="number" value={value.durationSeconds} /></label>
      <label className="grid gap-2 text-sm font-medium sm:col-span-2">Call to action<Input onChange={(event) => update('cta', event.target.value)} value={value.cta} /></label>
    </section>

    <section aria-live="polite" className={`rounded-xl border p-5 ${readiness.status === 'ready' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center gap-2 font-semibold">{readiness.status === 'ready' ? <CheckCircle2 className="size-5 text-emerald-700" /> : <AlertCircle className="size-5 text-amber-700" />}Readiness: {readiness.status}</div>
      {readiness.issues.length > 0 ? <ul className="mt-3 space-y-1 text-sm">{readiness.issues.map((issue, index) => <li key={`${issue.field}-${index}`}><code>{issue.field}</code>: {issue.message}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-900">{value.primaryAssetId ? 'Product images are archived and ready to bind.' : 'Product information is complete. Remote images will be archived when saved.'}</p>}
    </section>

    {message ? <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">{message}</p> : null}
    {conflict ? <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"><span>{conflict.existingProductName} already uses {conflict.externalSku}.</span><Button asChild size="sm"><Link href={conflict.existingItemHref}>Update existing</Link></Button><Button onClick={() => { setConflict(null); setMessage(''); }} size="sm" variant="outline">Cancel</Button></div> : null}
    <div className="flex items-center gap-3"><Button disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : mode === 'create' ? 'Save product' : 'Save changes'}</Button><Button asChild variant="outline"><Link href="/dashboard/catalog">Back to Catalog</Link></Button></div>
  </div>;
}
