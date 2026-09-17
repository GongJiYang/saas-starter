import { and, asc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { signProductionImageUploadForTeam } from '@/lib/assets/service';
import { db } from '@/lib/db/drizzle';
import { assetUploads } from '@/lib/db/schema';
import { domainErrorResponse } from '@/lib/errors/http';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

async function getBatchId(params: Promise<{ batchId: string }>) {
  const batchId = Number((await params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) throw new Error('Invalid Production Batch.');
  return batchId;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const batchId = await getBatchId(context.params);
    const uploads = await db.select({
      id: assetUploads.id,
      assetId: assetUploads.assetId,
      clientFileId: assetUploads.clientFileId,
      sequence: assetUploads.sequence,
      fileName: assetUploads.fileName,
      contentType: assetUploads.contentType,
      byteSize: assetUploads.byteSize,
      status: assetUploads.status,
      stage: assetUploads.stage,
      errorCode: assetUploads.errorCode,
      errorMessage: assetUploads.errorMessage,
    }).from(assetUploads).where(and(
      eq(assetUploads.teamId, workspace.team.id),
      eq(assetUploads.productionBatchId, batchId),
    )).orderBy(asc(assetUploads.sequence), asc(assetUploads.id));
    return NextResponse.json({ uploads });
  } catch (error) {
    return domainErrorResponse(error, 'internal_error', { teamId: workspace.team.id, userId: workspace.user.id, operation: 'production_batch.uploads.list' });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const batchId = await getBatchId(context.params);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Upload metadata is required.' }, { status: 400 });
    const value = body as { clientFileId?: unknown; sequence?: unknown; fileName?: unknown; contentType?: unknown; byteSize?: unknown };
    const clientFileId = typeof value.clientFileId === 'string' ? value.clientFileId : '';
    const sequence = typeof value.sequence === 'number' ? value.sequence : Number(value.sequence);
    const signed = await signProductionImageUploadForTeam({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      batchId,
      clientFileId,
      sequence,
      data: { fileName: value.fileName, contentType: value.contentType, byteSize: value.byteSize },
    });
    return NextResponse.json(signed, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error, 'asset_upload_failed', { teamId: workspace.team.id, userId: workspace.user.id, operation: 'production_batch.uploads.sign' });
  }
}
