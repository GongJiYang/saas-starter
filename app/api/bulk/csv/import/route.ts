import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { ActivityType, activityLogs, importBatches } from '@/lib/db/schema';
import { enqueueCsvImport } from '@/lib/queue/csv-import';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { CSV_TEMPLATE_VERSION } from '@/lib/bulk/contracts';
import { consumeRateLimit } from '@/lib/ops/rate-limit';

const requestSchema = z.object({
  objectKey: z.string().min(1).max(500),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i),
  idempotencyKey: z.string().trim().min(1).max(255),
  templateVersion: z.literal(CSV_TEMPLATE_VERSION).default(CSV_TEMPLATE_VERSION),
});

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!consumeRateLimit(`csv-import:${workspace.team.id}:${workspace.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'CSV import rate limit exceeded. Try again later.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success || !parsed.data.objectKey.startsWith(`teams/${workspace.team.id}/imports/`) || !parsed.data.objectKey.endsWith('.csv')) {
    return NextResponse.json({ error: 'Invalid CSV object or import request.' }, { status: 400 });
  }

  const existing = await db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.teamId, workspace.team.id),
        or(
          eq(importBatches.idempotencyKey, parsed.data.idempotencyKey),
          eq(importBatches.fileHash, parsed.data.fileHash),
        ),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return NextResponse.json({ importBatch: existing[0], idempotent: true });
  }

  const inserted = await db
    .insert(importBatches)
    .values({
      teamId: workspace.team.id,
      uploadedBy: workspace.user.id,
      fileObjectKey: parsed.data.objectKey,
      fileHash: parsed.data.fileHash.toLowerCase(),
      templateVersion: parsed.data.templateVersion,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();
  const batch = inserted[0] ?? (await db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.teamId, workspace.team.id),
        or(
          eq(importBatches.idempotencyKey, parsed.data.idempotencyKey),
          eq(importBatches.fileHash, parsed.data.fileHash.toLowerCase()),
        ),
      ),
    )
    .limit(1))[0];

  if (!batch) {
    return NextResponse.json({ error: 'Could not create import batch.' }, { status: 500 });
  }

  try {
    await enqueueCsvImport({ importBatchId: batch.id, teamId: workspace.team.id });
  } catch (error) {
    console.error('Could not enqueue CSV import:', error);
    return NextResponse.json(
      { error: 'CSV import queue is unavailable.', importBatch: batch },
      { status: 503 },
    );
  }
  await db.insert(activityLogs).values({ teamId: workspace.team.id, userId: workspace.user.id, action: ActivityType.IMPORT_CSV });

  return NextResponse.json({ importBatch: batch, idempotent: false }, { status: 201 });
}
