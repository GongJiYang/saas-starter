import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { creativeReferences, referenceAnalyses } from '@/lib/db/schema';
import { enqueueReferenceAnalysis } from '@/lib/queue/reference-analysis';
import { createCreativeReference } from '@/lib/references/actions';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const createSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  rights: z.enum(['owned', 'licensed', 'inspiration_only']),
  mode: z.enum(['structure', 'owned_template']),
  objectKey: z.string().min(1).max(500),
  contentType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
  byteSize: z.number().int().positive(),
  catalogItemId: z.number().int().positive().optional(),
});

export async function GET() {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const rows = await db.select({ reference: creativeReferences, analysis: referenceAnalyses })
    .from(creativeReferences)
    .leftJoin(referenceAnalyses, eq(referenceAnalyses.creativeReferenceId, creativeReferences.id))
    .where(eq(creativeReferences.teamId, workspace.team.id))
    .orderBy(desc(creativeReferences.createdAt));
  const references = rows.map(({ reference, analysis }) => ({ ...reference, analysis }));
  return NextResponse.json({ references });
}

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid reference declaration.' }, { status: 400 });
  try {
    const reference = await createCreativeReference({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      ...parsed.data,
    });
    await enqueueReferenceAnalysis({ teamId: workspace.team.id, creativeReferenceId: reference.id });
    return NextResponse.json({ reference }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save reference video.' }, { status: 400 });
  }
}
