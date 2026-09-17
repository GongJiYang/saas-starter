'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/workspace/access';
import { recordReviewDecision } from '@/lib/reviews/decisions';

const adoptVideoSchema = z.object({
  videoJobId: z.coerce.number().int().positive(),
});

const rejectionCauseSchema = z.enum(['technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change']);
const rejectVideoSchema = adoptVideoSchema.extend({
  reason: z.string().trim().min(1, 'A reason is required.').max(2_000),
  rejectionCause: rejectionCauseSchema,
});

export type ReviewActionState = {
  error?: string;
  success?: string;
};


function revalidateReviewPages(): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/jobs');
  revalidatePath('/dashboard/reviews');
  revalidatePath('/dashboard/batches');
}

export async function adoptVideo(
  _previousState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const workspace = await requireWorkspace();
  const parsed = adoptVideoSchema.safeParse({
    videoJobId: formData.get('videoJobId'),
  });

  if (!parsed.success) {
    return { error: 'Invalid video job.' };
  }

  let batchId: number | null;
  try {
    batchId = await recordReviewDecision({
      decision: 'adopted',
      reason: null,
      reviewerId: workspace.user.id,
      teamId: workspace.team.id,
      videoJobId: parsed.data.videoJobId,
      qualityFailureCause: null,
    });
  } catch {
    return { error: 'Could not adopt this video.' };
  }

  revalidateReviewPages();
  if (batchId) redirect(`/dashboard/batches/${batchId}#next-action`);
  return { success: 'Video adopted.' };
}

export async function rejectVideo(
  _previousState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const workspace = await requireWorkspace();
  const parsed = rejectVideoSchema.safeParse({
    reason: formData.get('reason'),
    videoJobId: formData.get('videoJobId'),
    rejectionCause: formData.get('rejectionCause'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid review.' };
  }

  let batchId: number | null;
  try {
    batchId = await recordReviewDecision({
      decision: 'not_adopted',
      reason: parsed.data.reason,
      reviewerId: workspace.user.id,
      teamId: workspace.team.id,
      videoJobId: parsed.data.videoJobId,
      qualityFailureCause: parsed.data.rejectionCause,
    });
  } catch {
    return { error: 'Could not record this review.' };
  }

  revalidateReviewPages();
  if (batchId) redirect(`/dashboard/batches/${batchId}#next-action`);
  return { success: 'Video marked as not adopted.' };
}
