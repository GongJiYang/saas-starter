import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { brandKits, catalogItems } from '@/lib/db/schema';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), itemIds: z.array(z.number().int().positive()).min(1).max(100), fields: z.object({ brandKitId: z.number().int().positive().optional(), platform: z.string().trim().min(1).max(50).optional(), campaignGoal: z.string().trim().min(1).optional(), durationSeconds: z.number().int().min(4).max(15).optional() }).strict() }).strict(),
  z.object({ action: z.literal('archive'), itemIds: z.array(z.number().int().positive()).min(1).max(100) }).strict(),
]);

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid Catalog bulk operation.' }, { status: 400 });
  const itemIds = [...new Set(parsed.data.itemIds)];
  if (parsed.data.action === 'archive') {
    const updated = await db.update(catalogItems).set({ readinessStatus: 'archived', updatedAt: new Date() }).where(and(eq(catalogItems.teamId, workspace.team.id), inArray(catalogItems.id, itemIds))).returning({ id: catalogItems.id });
    return NextResponse.json({ updatedIds: updated.map((item) => item.id) });
  }
  if (Object.keys(parsed.data.fields).length === 0) return NextResponse.json({ error: 'Select at least one Catalog field.' }, { status: 400 });
  if (parsed.data.fields.brandKitId) {
    const brand = await db.select({ id: brandKits.id }).from(brandKits).where(and(eq(brandKits.teamId, workspace.team.id), eq(brandKits.id, parsed.data.fields.brandKitId))).limit(1);
    if (!brand[0]) return NextResponse.json({ error: 'Brand Kit does not belong to the current workspace.' }, { status: 400 });
  }
  const updated = await db.update(catalogItems).set({ ...parsed.data.fields, updatedAt: new Date() }).where(and(eq(catalogItems.teamId, workspace.team.id), inArray(catalogItems.id, itemIds))).returning({ id: catalogItems.id });
  return NextResponse.json({ updatedIds: updated.map((item) => item.id) });
}
