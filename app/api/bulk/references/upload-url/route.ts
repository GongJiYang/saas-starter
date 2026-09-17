import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceModeSchema, referenceRightsSchema } from '@/lib/bulk/contracts';
import { REFERENCE_MAX_BYTES, createPresignedReferenceUpload } from '@/lib/storage/cos';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

const requestSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  rights: referenceRightsSchema,
  mode: referenceModeSchema.exclude(['none']),
  contentType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
  byteSize: z.number().int().positive().max(REFERENCE_MAX_BYTES),
}).superRefine((value, context) => {
  if (value.mode === 'owned_template' && value.rights === 'inspiration_only') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mode'], message: 'Inspiration-only references cannot use owned template mode.' });
  }
});

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid reference upload request.' }, { status: 400 });
  try {
    return NextResponse.json(createPresignedReferenceUpload({
      teamId: workspace.team.id,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not sign reference upload.' }, { status: 400 });
  }
}
