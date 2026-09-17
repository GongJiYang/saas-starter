import 'dotenv/config';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import {
  createQueueWorkerConnection,
} from '../lib/queue/connection';
import {
  VIDEO_POLL_QUEUE_NAME,
  VIDEO_SUBMIT_QUEUE_NAME,
  type VideoQueuePayload,
} from '../lib/queue/video-generation';
import {
  failVideoJob,
  processVideoPoll,
  processVideoSubmission,
} from '../lib/video-jobs/worker';
import {
  CSV_IMPORT_QUEUE_NAME,
  type CsvImportQueuePayload,
} from '../lib/queue/csv-import';
import { processCsvImport } from '../lib/bulk/import-worker';
import { cleanupExpiredImportObjects } from '../lib/ops/cleanup';
import {
  REFERENCE_ANALYSIS_QUEUE_NAME,
  type ReferenceAnalysisQueuePayload,
} from '../lib/queue/reference-analysis';
import { processReferenceAnalysis } from '../lib/references/worker';

let pollConnection: Redis | undefined;
let pollWorker: Worker<VideoQueuePayload> | undefined;
let stopping = false;
let submitConnection: Redis | undefined;
let submitWorker: Worker<VideoQueuePayload> | undefined;
let csvImportConnection: Redis | undefined;
let referenceAnalysisConnection: Redis | undefined;
let referenceAnalysisWorker: Worker<ReferenceAnalysisQueuePayload> | undefined;
let csvImportWorker: Worker<CsvImportQueuePayload> | undefined;
let cleanupTimer: NodeJS.Timeout | undefined;

async function recordTerminalWorkerFailure(
  job: { attemptsMade: number; data: VideoQueuePayload; opts: { attempts?: number } } | undefined,
  error: Error,
): Promise<void> {
  const maximumAttempts = job?.opts.attempts ?? 1;

  if (!job || job.attemptsMade < maximumAttempts) {
    return;
  }

  await failVideoJob(job.data.videoJobId, {
    code: 'worker_error',
    reason: error.message,
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  console.info(`Received ${signal}; closing video generation workers.`);
  await Promise.all([
    submitWorker?.close(),
    pollWorker?.close(),
    csvImportWorker?.close(),
    referenceAnalysisWorker?.close(),
  ]);
  await Promise.all([
    submitConnection?.quit(),
    pollConnection?.quit(),
    csvImportConnection?.quit(),
    referenceAnalysisConnection?.quit(),
  ]);
  clearInterval(cleanupTimer!);
}

async function main(): Promise<void> {
  submitConnection = createQueueWorkerConnection();
  pollConnection = createQueueWorkerConnection();
  submitConnection.on('error', (error) => {
    console.error('Video submit worker Redis connection error:', error);
  });
  pollConnection.on('error', (error) => {
    console.error('Video poll worker Redis connection error:', error);
  });
  csvImportConnection = createQueueWorkerConnection();
  csvImportConnection.on('error', (error) => {
    console.error('CSV import worker Redis connection error:', error);
  });
  referenceAnalysisConnection = createQueueWorkerConnection();
  referenceAnalysisConnection.on('error', (error) => {
    console.error('Reference analysis worker Redis connection error:', error);
  });

  submitWorker = new Worker<VideoQueuePayload>(
    VIDEO_SUBMIT_QUEUE_NAME,
    async (job) => processVideoSubmission(job.data.videoJobId),
    {
      concurrency: 2,
      connection: submitConnection,
    },
  );
  pollWorker = new Worker<VideoQueuePayload>(
    VIDEO_POLL_QUEUE_NAME,
    async (job) => processVideoPoll(job.data.videoJobId),
    {
      concurrency: 4,
      connection: pollConnection,
    },
  );
  csvImportWorker = new Worker<CsvImportQueuePayload>(
    CSV_IMPORT_QUEUE_NAME,
    async (job) => processCsvImport(job.data),
    {
      concurrency: 1,
      connection: csvImportConnection,
    },
  );
  csvImportWorker.on('failed', (job, error) => {
    console.error(`CSV import ${job?.data.importBatchId ?? 'unknown'} failed:`, error);
  });
  referenceAnalysisWorker = new Worker<ReferenceAnalysisQueuePayload>(
    REFERENCE_ANALYSIS_QUEUE_NAME,
    async (job) => processReferenceAnalysis(job.data),
    {
      concurrency: 1,
      connection: referenceAnalysisConnection,
    },
  );
  referenceAnalysisWorker.on('failed', (job, error) => {
    console.error(`Reference analysis ${job?.data.creativeReferenceId ?? 'unknown'} failed:`, error);
  });
  submitWorker.on('failed', (job, error) => {
    void recordTerminalWorkerFailure(job, error);
  });
  pollWorker.on('failed', (job, error) => {
    void recordTerminalWorkerFailure(job, error);
  });

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await Promise.all([
    submitWorker.waitUntilReady(),
    pollWorker.waitUntilReady(),
    csvImportWorker.waitUntilReady(),
    referenceAnalysisWorker.waitUntilReady(),
  ]);
  cleanupTimer = setInterval(() => { void cleanupExpiredImportObjects().catch((error: unknown) => console.error('Import object cleanup failed:', error)); }, 60 * 60 * 1000);
  cleanupTimer.unref();
  console.info('Video generation workers are ready.');

}
void main().catch(async (error: unknown) => {
  console.error('Video generation workers failed to start:', error);
  await shutdown('SIGTERM').catch(() => undefined);
  process.exitCode = 1;
});
