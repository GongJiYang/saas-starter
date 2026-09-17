import { Queue } from 'bullmq';
import { createQueueProducerConnection } from './connection';

export const VIDEO_POLL_QUEUE_NAME = 'video-poll';
export const VIDEO_SUBMIT_QUEUE_NAME = 'video-submit';
export const VIDEO_POLL_DELAY_MS = 10_000;

export type VideoQueuePayload = {
  videoJobId: number;
};

let pollQueue: Queue<VideoQueuePayload> | undefined;
let submitQueue: Queue<VideoQueuePayload> | undefined;

function getPollQueue(): Queue<VideoQueuePayload> {
  if (!pollQueue) {
    pollQueue = new Queue<VideoQueuePayload>(VIDEO_POLL_QUEUE_NAME, {
      connection: createQueueProducerConnection(),
    });
  }

  return pollQueue;
}

function getSubmitQueue(): Queue<VideoQueuePayload> {
  if (!submitQueue) {
    submitQueue = new Queue<VideoQueuePayload>(VIDEO_SUBMIT_QUEUE_NAME, {
      connection: createQueueProducerConnection(),
    });
  }

  return submitQueue;
}

export async function enqueueVideoPoll(videoJobId: number): Promise<void> {
  await getPollQueue().add(
    'poll',
    { videoJobId },
    {
      attempts: 5,
      backoff: {
        delay: 2_000,
        type: 'exponential',
      },
      delay: VIDEO_POLL_DELAY_MS,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function enqueueVideoSubmission(videoJobId: number): Promise<void> {
  await getSubmitQueue().add(
    'submit',
    { videoJobId },
    {
      attempts: 3,
      backoff: {
        delay: 2_000,
        type: 'exponential',
      },
      jobId: `video-submit-${videoJobId}`,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
