import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CSV_MAX_BYTES } from '@/lib/bulk/contracts';
import { classifyUploadError } from '@/lib/assets/contracts';
import { createPresignedCsvUpload } from '@/lib/storage/cos';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { consumeRateLimit } from '@/lib/ops/rate-limit';

const requestSchema = z.object({
  byteSize: z.number().int().positive().max(CSV_MAX_BYTES),
  contentType: z.literal('text/csv').default('text/csv'),
});

export async function POST(request: NextRequest) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!consumeRateLimit(`csv-upload:${workspace.team.id}:${workspace.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'CSV upload rate limit exceeded. Try again later.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `CSV files must be text/csv and no larger than ${CSV_MAX_BYTES} bytes.` },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(createPresignedCsvUpload({
      teamId: workspace.team.id,
      byteSize: parsed.data.byteSize,
    }));
  } catch (error) {
    const diagnostic = classifyUploadError(error, 'signing');
    console.error('Could not sign CSV upload:', error);
    return NextResponse.json({ error: diagnostic.message, diagnostic }, { status: 503 });
  }
}
