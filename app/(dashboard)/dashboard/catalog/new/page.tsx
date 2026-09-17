import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { brandKits } from '@/lib/db/schema';
import { requireWorkspace } from '@/lib/workspace/access';
import { ProductForm } from '../product-form';

export default async function NewCatalogProductPage() {
  const workspace = await requireWorkspace();
  const brands = await db
    .select({ id: brandKits.id, name: brandKits.name })
    .from(brandKits)
    .where(eq(brandKits.teamId, workspace.team.id))
    .orderBy(asc(brandKits.name));

  return <div className="space-y-6">
    <section className="border-b border-gray-200 pb-6">
      <p className="text-sm font-medium text-orange-600">SKU Catalog</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">Add product</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Create one Workspace SKU without a CSV. Readiness uses the same product contract and error codes as bulk import.</p>
    </section>
    <ProductForm brandKits={brands} mode="create" />
  </div>;
}
