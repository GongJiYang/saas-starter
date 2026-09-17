import { z } from 'zod';
import { getMiniMaxEnvironment } from '@/lib/config/env';

const createTaskResponseSchema = z.object({
  task_id: z.string().min(1),
});

const errorResponseSchema = z.object({
  error: z.object({
    message: z.string().optional(),
  }),
});

const queryTaskResponseSchema = z.object({
  task: z.object({
    content: z
      .object({
        url: z.string().url().optional(),
      })
      .optional(),
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
      })
      .optional(),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  }),
});

export class MiniMaxRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MiniMaxRequestError';
    this.retryable = status === 429 || status >= 500;
  }
}

function getMiniMaxEndpoint(path: string): URL {
  const environment = getMiniMaxEnvironment();
  return new URL(path, environment.MINIMAX_API_BASE_URL);
}

async function readMiniMaxResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function getMiniMaxErrorMessage(body: unknown): string {
  const parsed = errorResponseSchema.safeParse(body);

  if (parsed.success && parsed.data.error.message) {
    return parsed.data.error.message;
  }

  return 'Request failed.';
}

export async function createMiniMaxVideoTask(input: {
  durationSeconds: number;
  referenceImageUrl: string;
  imageRole?: 'first_frame' | 'reference_image';
  prompt: string;
}): Promise<{ taskId: string }> {
  const environment = getMiniMaxEnvironment();
  const response = await fetch(getMiniMaxEndpoint('/v2/video_generation'), {
    body: JSON.stringify({
      content: [
        {
          text: input.prompt,
          type: 'text',
        },
        {
          image_url: { url: input.referenceImageUrl },
          role: input.imageRole ?? 'first_frame',
          type: 'image_url',
        },
      ],
      duration: input.durationSeconds,
      model: 'MiniMax-H3',
      ...(input.imageRole === 'reference_image' ? { ratio: '9:16' } : {}),
      resolution: '768P',
    }),
    headers: {
      Authorization: `Bearer ${environment.MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readMiniMaxResponse(response);

  if (!response.ok) {
    const message = getMiniMaxErrorMessage(body);
    throw new MiniMaxRequestError(message, response.status);
  }

  const parsed = createTaskResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new Error('MiniMax returned an invalid video task response.');
  }

  return { taskId: parsed.data.task_id };
}

export async function queryMiniMaxVideoTask(taskId: string): Promise<{
  errorCode?: string;
  errorMessage?: string;
  outputUrl?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
}> {
  const environment = getMiniMaxEnvironment();
  const response = await fetch(
    getMiniMaxEndpoint(`/v2/query/video_generation/${encodeURIComponent(taskId)}`),
    {
      headers: {
        Authorization: `Bearer ${environment.MINIMAX_API_KEY}`,
      },
    },
  );
  const body = await readMiniMaxResponse(response);

  if (!response.ok) {
    const message = getMiniMaxErrorMessage(body);
    throw new MiniMaxRequestError(message, response.status);
  }

  const parsed = queryTaskResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new Error('MiniMax returned an invalid video task response.');
  }

  return {
    errorCode: parsed.data.task.error?.code,
    errorMessage: parsed.data.task.error?.message,
    outputUrl: parsed.data.task.content?.url,
    status: parsed.data.task.status,
  };
}
