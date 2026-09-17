'use client';

import { useState } from 'react';
import { ImagePlus, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PRODUCT_IMAGE_MAX_BYTES,
  matchesProductImageMagicBytes,
  productImageContentTypeSchema,
  type ProductImageContentType,
} from '@/lib/assets/contracts';
import { uploadSignedFile } from '@/lib/assets/upload-client';
import { customerErrorMessage } from '@/lib/errors/client';

export type ProductImageValue = {
  assetId: number;
  uploadId: number | null;
  fileName: string;
  previewUrl: string;
  initial: boolean;
};

type Props = {
  label: string;
  maximum: number;
  initialAssets?: ProductImageValue[];
  onChange: (assets: ProductImageValue[]) => void;
  onRemoveInitial?: (uploadId: number) => void;
};

type SignedUpload = {
  uploadId: number;
  url: string;
  headers: Record<string, string>;
  completeUrl: string;
  fallbackUrl: string;
};

async function signUpload(file: File): Promise<SignedUpload> {
  const response = await fetch('/api/assets/product-images/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, byteSize: file.size }),
  });
  const body = await response.json().catch(() => ({})) as SignedUpload & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Could not sign product image upload.');
  return body;
}

async function validateFile(file: File): Promise<ProductImageContentType> {
  const contentType = productImageContentTypeSchema.parse(file.type);
  if (file.size <= 0 || file.size > PRODUCT_IMAGE_MAX_BYTES) throw new Error('Product images must be between 1 byte and 20 MB.');
  const prefix = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesProductImageMagicBytes(contentType, prefix)) throw new Error('Image bytes do not match the selected JPEG, PNG, or WebP MIME type.');
  return contentType;
}

export function ProductImageUploader({ label, maximum, initialAssets = [], onChange, onRemoveInitial }: Props) {
  const [assets, setAssets] = useState<ProductImageValue[]>(initialAssets);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');

  function publish(next: ProductImageValue[]) {
    setAssets(next);
    onChange(next);
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, maximum - (maximum === 1 ? 0 : assets.length)));
    if (selected.length === 0) return;
    setBusy(true);
    setMessage('');
    setProgress(0);
    const uploaded: ProductImageValue[] = [];
    try {
      for (const file of selected) {
        await validateFile(file);
        const signed = await signUpload(file);
        const result = await uploadSignedFile({ file, signed, onProgress: setProgress });
        if (!result.asset) throw new Error('Upload completed without an Asset receipt.');
        uploaded.push({
          assetId: result.asset.id,
          uploadId: signed.uploadId,
          fileName: result.asset.fileName,
          previewUrl: URL.createObjectURL(file),
          initial: false,
        });
      }
      const next = maximum === 1 ? uploaded.slice(-1) : [...assets, ...uploaded].slice(0, maximum);
      if (maximum === 1 && assets[0]) await removeAsset(assets[0], false);
      publish(next);
      setMessage(`${uploaded.length} image${uploaded.length === 1 ? '' : 's'} archived.`);
    } catch (error) {
      for (const item of uploaded) {
        if (item.uploadId) await fetch(`/api/assets/product-images/${item.uploadId}`, { method: 'DELETE' }).catch(() => undefined);
        if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      }
      setMessage(customerErrorMessage(error, 'Product image upload failed. Retry or use the server upload fallback.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeAsset(asset: ProductImageValue, updateState = true) {
    if (asset.initial) {
      if (asset.uploadId) onRemoveInitial?.(asset.uploadId);
    } else if (asset.uploadId) {
      const response = await fetch(`/api/assets/product-images/${asset.uploadId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Could not delete the unreferenced image.');
      }
    }
    if (asset.previewUrl.startsWith('blob:')) URL.revokeObjectURL(asset.previewUrl);
    if (updateState) publish(assets.filter((item) => item.assetId !== asset.assetId));
  }

  return <div className="space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">JPEG, PNG, or WebP · 20 MB maximum · {maximum === 1 ? 'one image' : `up to ${maximum} images`}</p></div><label className="inline-flex cursor-pointer items-center justify-center rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"><UploadCloud className="mr-2 size-4" />Choose image{maximum > 1 ? 's' : ''}<Input accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy || (maximum > 1 && assets.length >= maximum)} multiple={maximum > 1} onChange={(event) => void uploadFiles(event.target.files)} type="file" /></label></div>
    {busy ? <div className="space-y-1"><div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-orange-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="text-xs text-muted-foreground">Uploading {progress}%</p></div> : null}
    {assets.length > 0 ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{assets.map((asset) => <div className="relative rounded-lg border border-gray-200 p-2" key={asset.assetId}><img alt="" className="aspect-square w-full rounded object-contain" src={asset.previewUrl} /><p className="mt-1 truncate text-xs text-muted-foreground">{asset.fileName}</p><Button aria-label={`Remove ${asset.fileName}`} className="absolute right-1 top-1" disabled={busy} onClick={() => void removeAsset(asset).catch((error: unknown) => setMessage(customerErrorMessage(error, 'Could not remove image.')))} size="icon" type="button" variant="secondary"><Trash2 className="size-4" /></Button></div>)}</div> : <div className="flex items-center gap-2 text-sm text-muted-foreground"><ImagePlus className="size-5" />No archived images yet.</div>}
    {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
  </div>;
}
