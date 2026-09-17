import { z } from 'zod';
import { getAutoDlH3Environment } from '@/lib/config/env';
import type { CreateVideoTaskInput, VideoTaskResult } from './index';

const createResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
});

const queryResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['queued', 'processing', 'running', 'completed', 'failed', 'cancelled']),
  content_url: z.string().min(1).optional(),
  error: z.string().optional(),
});

const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class AutoDlH3RequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AutoDlH3RequestError';
    this.retryable = status === 429 || status >= 500;
  }
}

function endpoint(path: string): URL {
  const environment = getAutoDlH3Environment();
  const base = environment.AUTODL_H3_API_BASE_URL.endsWith('/')
    ? environment.AUTODL_H3_API_BASE_URL
    : `${environment.AUTODL_H3_API_BASE_URL}/`;
  return new URL(path.replace(/^\//, ''), base);
}

function authorizationHeaders(): Record<string, string> {
  const environment = getAutoDlH3Environment();
  return { Authorization: `Bearer ${environment.apiKey}` };
}

async function errorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = body.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((item) => JSON.stringify(item)).join('; ');
  }
  return `AutoDL H3 request returned HTTP ${response.status}.`;
}

async function imageDataUrl(sourceUrl: string): Promise<string> {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Reference image returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const extension = IMAGE_EXTENSION_BY_TYPE[contentType];
  if (!extension) throw new Error(`Reference image MIME type ${contentType || 'unknown'} is not supported by AutoDL H3.`);
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > IMAGE_MAX_BYTES) throw new Error('Reference image exceeds the AutoDL H3 25 MB limit.');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) throw new Error('Reference image exceeds the AutoDL H3 25 MB limit.');
  return `data:${contentType};base64,${body.toString('base64')}`;
}

export async function createAutoDlH3VideoTask(input: CreateVideoTaskInput): Promise<{ taskId: string }> {
  const environment = getAutoDlH3Environment();
  const image = await imageDataUrl(input.referenceImageUrl);
  const referenceMode = input.imageRole === 'reference_image';
  const response = await fetch(endpoint('/v1/videos'), {
    method: 'POST',
    headers: {
      ...authorizationHeaders(),
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      duration: input.durationSeconds,
      aspect_ratio: '9:16',
      preset: environment.AUTODL_H3_PRESET,
      prompt_mode: 'raw',
      generation_mode: referenceMode ? 'ref2va' : 'i2va',
      accepted_terms: true,
      ...(referenceMode
        ? { reference_images: [{ data: image, role: 'item', name: input.referenceImageName ?? 'Product reference' }] }
        : { first_frame: image }),
    }),
  });
  if (!response.ok) throw new AutoDlH3RequestError(await errorMessage(response), response.status);
  const parsed = createResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error('AutoDL H3 returned an invalid create response.');
  return { taskId: parsed.data.id };
}

export async function queryAutoDlH3VideoTask(taskId: string): Promise<VideoTaskResult> {
  const response = await fetch(endpoint(`/v1/videos/${encodeURIComponent(taskId)}`), {
    headers: authorizationHeaders(),
  });
  if (!response.ok) throw new AutoDlH3RequestError(await errorMessage(response), response.status);
  const parsed = queryResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error('AutoDL H3 returned an invalid query response.');
  const status = parsed.data.status;
  if (status === 'queued' || status === 'processing' || status === 'running') {
    return { status: status === 'queued' ? 'queued' : 'running' };
  }
  if (status === 'failed' || status === 'cancelled') {
    return { status, errorCode: `autodl_h3_${status}`, errorMessage: parsed.data.error ?? `AutoDL H3 task ${status}.` };
  }
  if (!parsed.data.content_url) throw new Error('AutoDL H3 completed without a content URL.');
  return {
    status: 'succeeded',
    outputUrl: new URL(parsed.data.content_url, endpoint('/')).toString(),
    outputHeaders: authorizationHeaders(),
  };
}
