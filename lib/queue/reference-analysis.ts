import { Queue } from 'bullmq';
import { createQueueProducerConnection } from '@/lib/queue/connection';

export const REFERENCE_ANALYSIS_QUEUE_NAME = 'reference-analysis';

export type ReferenceAnalysisQueuePayload = {
  teamId: number;
  creativeReferenceId: number;
};

let referenceAnalysisQueue: Queue<ReferenceAnalysisQueuePayload> | undefined;

function getReferenceAnalysisQueue(): Queue<ReferenceAnalysisQueuePayload> {
  if (!referenceAnalysisQueue) {
    referenceAnalysisQueue = new Queue<ReferenceAnalysisQueuePayload>(REFERENCE_ANALYSIS_QUEUE_NAME, {
      connection: createQueueProducerConnection(),
    });
  }
  return referenceAnalysisQueue;
}

export async function enqueueReferenceAnalysis(payload: ReferenceAnalysisQueuePayload): Promise<void> {
  await getReferenceAnalysisQueue().add('analyze', payload, {
    attempts: 3,
    backoff: { delay: 2_000, type: 'exponential' },
    jobId: `reference-analysis-${payload.creativeReferenceId}`,
    removeOnComplete: true,
    removeOnFail: true,
  });
}
