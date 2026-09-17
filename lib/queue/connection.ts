import Redis from 'ioredis';
import { getQueueEnvironment } from '@/lib/config/env';

function createRedisConnection(maxRetriesPerRequest: number | null): Redis {
  return new Redis(getQueueEnvironment().REDIS_URL, {
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest
  });
}

/**
 * Creates a short-lived producer connection. Requests fail quickly when Redis
 * is unavailable instead of keeping an HTTP request open indefinitely.
 */
export function createQueueProducerConnection(): Redis {
  return createRedisConnection(1);
}

/**
 * Creates a worker connection. BullMQ requires unlimited command retries for
 * workers so they can resume processing after Redis reconnects.
 */
export function createQueueWorkerConnection(): Redis {
  return createRedisConnection(null);
}

export async function connectAndPingRedis(connection: Redis): Promise<void> {
  if (connection.status === 'wait') {
    await connection.connect();
  }

  await connection.ping();
}
