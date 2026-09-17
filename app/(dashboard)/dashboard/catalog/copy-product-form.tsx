'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CatalogConflict } from '@/lib/catalog/contracts';

export function CopyProductForm({ catalogItemId, sourceSku }: { catalogItemId: number; sourceSku: string }) {
  const [externalSku, setExternalSku] = useState(`${sourceSku}-COPY`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [createdHref, setCreatedHref] = useState<string | null>(null);
  const [conflict, setConflict] = useState<CatalogConflict | null>(null);

  async function copyProduct() {
    setBusy(true);
    setMessage('');
    setConflict(null);
    setCreatedHref(null);
    try {
      const response = await fetch(`/api/catalog/${catalogItemId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalSku }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; item?: { id: number }; conflict?: CatalogConflict };
      if (response.status === 409 && result.conflict) {
        setConflict(result.conflict);
        setMessage(result.error ?? 'SKU already exists.');
        return;
      }
      if (!response.ok || !result.item) throw new Error(result.error ?? 'Could not copy SKU.');
      setCreatedHref(`/dashboard/catalog/${result.item.id}`);
      setMessage('Draft copy created. Review it before generation.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not copy SKU.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-3">
    <div className="flex flex-col gap-2 sm:flex-row"><Input aria-label="New copied SKU" onChange={(event) => setExternalSku(event.target.value)} value={externalSku} /><Button disabled={busy || !externalSku.trim()} onClick={() => void copyProduct()}><Copy className="mr-2 size-4" />{busy ? 'Copying…' : 'Create draft copy'}</Button></div>
    {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    {createdHref ? <Button asChild size="sm" variant="outline"><Link href={createdHref}>Open copied SKU</Link></Button> : null}
    {conflict ? <Button asChild size="sm" variant="outline"><Link href={conflict.existingItemHref}>Open existing SKU</Link></Button> : null}
  </div>;
}
