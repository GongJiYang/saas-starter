import { Queue } from 'bullmq';
import { createQueueProducerConnection } from './connection';

export const CSV_IMPORT_QUEUE_NAME = 'csv-import';

export type CsvImportQueuePayload = {
  importBatchId: number;
  teamId: number;
};

let csvImportQueue: Queue<CsvImportQueuePayload> | undefined;

function getCsvImportQueue(): Queue<CsvImportQueuePayload> {
  if (!csvImportQueue) {
    csvImportQueue = new Queue<CsvImportQueuePayload>(CSV_IMPORT_QUEUE_NAME, {
      connection: createQueueProducerConnection(),
    });
  }
  return csvImportQueue;
}

export async function enqueueCsvImport(payload: CsvImportQueuePayload): Promise<void> {
  await getCsvImportQueue().add('parse', payload, {
    attempts: 3,
    backoff: { delay: 2_000, type: 'exponential' },
    jobId: `csv-import-${payload.importBatchId}`,
    removeOnComplete: true,
    removeOnFail: true,
  });
}
