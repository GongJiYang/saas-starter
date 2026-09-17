import { NextResponse } from 'next/server';
import { cleanupExpiredProductImageUploads } from '@/lib/assets/service';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function POST() {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (workspace.role !== 'owner') return NextResponse.json({ error: 'Only workspace owners can clean product image uploads.' }, { status: 403 });
  try {
    return NextResponse.json(await cleanupExpiredProductImageUploads({ teamId: workspace.team.id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not clean product image uploads.' }, { status: 503 });
  }
}
