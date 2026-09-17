import { createMiniMaxVideoTask, queryMiniMaxVideoTask } from '@/lib/minimax/video';
import { getVideoProviderEnvironment } from '@/lib/config/env';
import { createAutoDlH3VideoTask, queryAutoDlH3VideoTask } from './autodl-h3';

export type VideoProviderName = 'minimax' | 'autodl-h3';

export type CreateVideoTaskInput = {
  durationSeconds: number;
  idempotencyKey: string;
  imageRole?: 'first_frame' | 'reference_image';
  prompt: string;
  referenceImageName?: string;
  referenceImageUrl: string;
};

export type VideoTaskResult = {
  errorCode?: string;
  errorMessage?: string;
  outputHeaders?: Record<string, string>;
  outputUrl?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
};

export function getConfiguredVideoProvider(): VideoProviderName {
  return getVideoProviderEnvironment().VIDEO_PROVIDER;
}

function providerName(value: string): VideoProviderName {
  if (value === 'minimax' || value === 'autodl-h3') return value;
  throw new Error(`Unsupported video provider: ${value}.`);
}

export async function createVideoTask(provider: string, input: CreateVideoTaskInput): Promise<{ taskId: string }> {
  switch (providerName(provider)) {
    case 'autodl-h3':
      return createAutoDlH3VideoTask(input);
    case 'minimax':
      return createMiniMaxVideoTask(input);
  }
}

export async function queryVideoTask(provider: string, taskId: string): Promise<VideoTaskResult> {
  switch (providerName(provider)) {
    case 'autodl-h3':
      return queryAutoDlH3VideoTask(taskId);
    case 'minimax':
      return queryMiniMaxVideoTask(taskId);
  }
}
