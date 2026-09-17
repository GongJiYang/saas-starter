import { NextResponse } from 'next/server';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';
import { cleanupExpiredImportObjects } from '@/lib/ops/cleanup';

export async function POST() {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (workspace.role !== 'owner') return NextResponse.json({ error: 'Only workspace owners can clean import objects.' }, { status: 403 });
  try {
    return NextResponse.json(await cleanupExpiredImportObjects({ teamId: workspace.team.id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not clean import objects.' }, { status: 503 });
  }
}
