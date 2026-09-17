import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CatalogTable } from './catalog-table';
import { CatalogImporter } from './catalog-importer';

export default function CatalogPage() {
  return <div className="space-y-6">
    <section className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-orange-600">Product library</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">SKU Catalog</h1>
        <p className="mt-2 text-sm text-muted-foreground">Add one product directly or import a governed CSV.</p>
      </div>
      <Button asChild><Link href="/dashboard/catalog/new"><Plus className="mr-2 size-4" />Add product</Link></Button>
    </section>
    <CatalogTable />
    <CatalogImporter />
  </div>;
}
