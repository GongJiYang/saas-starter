import type { VideoJob } from '@/lib/db/schema';

export type VideoJobState = VideoJob['status'];

const allowedTransitions: Record<VideoJobState, readonly VideoJobState[]> = {
  queued: ['generating', 'failed'],
  generating: ['succeeded', 'failed'],
  succeeded: [],
  failed: ['queued'],
};

export function assertVideoJobTransition(
  current: VideoJobState,
  next: VideoJobState,
): void {
  if (!allowedTransitions[current].includes(next)) {
    throw new Error(`Video job cannot transition from ${current} to ${next}.`);
  }
}
