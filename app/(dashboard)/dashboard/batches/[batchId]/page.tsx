import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProductionBatchForTeam } from '@/lib/db/bulk-queries';
import { requireWorkspace } from '@/lib/workspace/access';
import { GuidedBatchWorkbench } from './guided-batch-workbench';
import { ImageToVideoWorkbench } from './image-to-video-workbench';

export default async function ProductionBatchDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  const workspace = await requireWorkspace();
  const batchId = Number((await params).batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) notFound();
  const batch = await getProductionBatchForTeam(workspace.team.id, batchId);
  if (!batch) notFound();
  return batch.sourceMode === 'uploaded_images'
    ? <ImageToVideoWorkbench batchId={batchId} />
    : <div className="space-y-6"><Link className="text-sm font-medium text-orange-700 hover:text-orange-800" href="/dashboard/batches">← Production tasks</Link><GuidedBatchWorkbench batchId={batchId} /></div>;
}
