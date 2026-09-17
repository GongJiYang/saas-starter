import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { ArrowRight, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db/drizzle';
import { brandKits } from '@/lib/db/schema';
import { getCatalogItemDetailForTeam } from '@/lib/db/catalog-queries';
import { requireWorkspace } from '@/lib/workspace/access';
import { catalogProductInputSchema, type CatalogProductInput } from '@/lib/catalog/contracts';
import { CopyProductForm } from '../copy-product-form';
import { ProductForm } from '../product-form';

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default async function CatalogProductDetailPage({ params }: { params: Promise<{ catalogItemId: string }> }) {
  const workspace = await requireWorkspace();
  const catalogItemId = Number((await params).catalogItemId);
  if (!Number.isSafeInteger(catalogItemId) || catalogItemId <= 0) notFound();
  const [item, brands] = await Promise.all([
    getCatalogItemDetailForTeam(workspace.team.id, catalogItemId),
    db.select({ id: brandKits.id, name: brandKits.name }).from(brandKits)
      .where(eq(brandKits.teamId, workspace.team.id)).orderBy(asc(brandKits.name)),
  ]);
  if (!item) notFound();

  const detailAssets = item.assetBindings.filter((binding) => binding.purpose === 'detail');
  const primaryAsset = item.assetBindings.find((binding) => binding.purpose === 'primary')
    ?? item.assetBindings.find((binding) => binding.assetId === item.primaryAssetId);
  const readinessIssues = parseJson<Array<{ code: string; field: string; message: string }>>(item.readinessErrors, []);
  const initialValue: CatalogProductInput = catalogProductInputSchema.parse({
    externalSku: item.externalSku,
    productName: item.productName,
    category: item.category,
    primaryImageUrl: item.primaryImageUrl,
    productPageUrl: item.productPageUrl ?? undefined,
    primaryImageAuthorized: Boolean(item.primaryAssetId),
    primaryAssetId: item.primaryAssetId,
    detailImageUrls: [],
    detailAssetIds: detailAssets.map((asset) => asset.assetId),
    approvedClaims: parseJson(item.approvedClaims, []),
    prohibitedClaims: parseJson(item.prohibitedClaims, []),
    mustShowElements: parseJson(item.mustShowElements, []),
    immutableElements: parseJson(item.immutableElements, []),
    targetAudience: item.targetAudience,
    campaignGoal: item.campaignGoal,
    platform: item.platform,
    durationSeconds: item.durationSeconds,
    brandKitId: item.brandKitId,
    cta: item.cta,
  });
  const initialPrimaryAsset = primaryAsset ? {
    assetId: primaryAsset.assetId,
    uploadId: primaryAsset.uploadId,
    fileName: primaryAsset.fileName,
    previewUrl: `/api/assets/${primaryAsset.assetId}/download`,
    initial: true,
  } : undefined;
  const initialDetailAssets = detailAssets.map((asset) => ({
    assetId: asset.assetId,
    uploadId: asset.uploadId,
    fileName: asset.fileName,
    previewUrl: `/api/assets/${asset.assetId}/download`,
    initial: true,
  }));

  return <div className="space-y-8">
    <section className="border-b border-gray-200 pb-6">
      <p className="text-sm font-medium text-orange-600">SKU Catalog</p>
      <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-3xl font-semibold tracking-tight text-gray-950">{item.productName}</h1><p className="mt-2 font-mono text-sm text-muted-foreground">{item.externalSku}</p></div>
        <Button asChild><Link href={item.readinessStatus === 'ready' ? `/dashboard/batches?sku=${encodeURIComponent(item.externalSku)}` : '#edit-product'}>{item.readinessStatus === 'ready' ? 'Create video task' : 'Complete product information'}<ArrowRight className="ml-2 size-4" /></Link></Button>
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-3">
      <Card><CardHeader><CardTitle>Readiness</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p className="font-medium">{item.readinessStatus}</p>{readinessIssues.map((issue, index) => <p className="text-amber-800" key={`${issue.field}-${index}`}><code>{issue.field}</code>: {issue.message}</p>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>Brand Kit</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{item.brandKitName}</CardContent></Card>
      <Card><CardHeader><CardTitle>Audit</CardTitle></CardHeader><CardContent className="space-y-1 text-sm text-muted-foreground"><p>Created by {item.createdByName ?? item.createdByEmail}</p><p>{item.createdAt.toLocaleString()}</p><p>Updated {item.updatedAt.toLocaleString()}</p></CardContent></Card>
    </div>

    <section className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Archived primary image</CardTitle></CardHeader><CardContent>{primaryAsset ? <div className="space-y-3"><img alt={item.productName} className="max-h-80 w-full rounded-lg bg-gray-50 object-contain" src={`/api/assets/${primaryAsset.assetId}/download`} /><p className="text-xs text-muted-foreground">{primaryAsset.fileName} · {primaryAsset.contentType} · {primaryAsset.uploadSource}</p></div> : <div className="flex min-h-40 items-center justify-center gap-2 rounded-lg bg-gray-50 text-sm text-muted-foreground"><ImageIcon className="size-5" />No archived primary image</div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Archived detail images</CardTitle></CardHeader><CardContent>{detailAssets.length > 0 ? <div className="grid grid-cols-2 gap-3">{detailAssets.map((asset) => <div className="space-y-1" key={asset.assetId}><img alt="" className="aspect-square w-full rounded-lg bg-gray-50 object-contain" src={`/api/assets/${asset.assetId}/download`} /><p className="truncate text-xs text-muted-foreground">{asset.fileName}</p></div>)}</div> : <p className="text-sm text-muted-foreground">No detail images.</p>}</CardContent></Card>
    </section>

    <Card><CardHeader><CardTitle>Copy as a new SKU draft</CardTitle></CardHeader><CardContent><CopyProductForm catalogItemId={item.id} sourceSku={item.externalSku} /></CardContent></Card>

    <section className="space-y-4" id="edit-product"><div><h2 className="text-xl font-semibold">Edit product</h2><p className="mt-1 text-sm text-muted-foreground">Saving recalculates Readiness and records the change in Activity Log.</p></div><ProductForm brandKits={brands} catalogItemId={item.id} existingDetailAssetCount={detailAssets.length} initialDetailAssets={initialDetailAssets} initialPrimaryAsset={initialPrimaryAsset} initialValue={initialValue} mode="edit" /></section>
  </div>;
}
