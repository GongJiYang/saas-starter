import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import COS from 'cos-nodejs-sdk-v5';
import { getObjectStorageEnvironment } from '@/lib/config/env';
import { CSV_MAX_BYTES } from '@/lib/bulk/contracts';
import { assertSafeRemoteUrl } from '@/lib/bulk/url-safety';
import {
  PRODUCT_IMAGE_EXTENSIONS,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_UPLOAD_TTL_SECONDS,
  assertProductImageObjectKey,
  matchesProductImageMagicBytes,
  type ProductImageContentType,
} from '@/lib/assets/contracts';

const SIGNED_URL_TTL_SECONDS = 15 * 60;


const referenceExtensions = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
} as const;

export const REFERENCE_MAX_BYTES = 100 * 1024 * 1024;
export type ReferenceContentType = keyof typeof referenceExtensions;

let cosClient: COS | undefined;

function assertTeamId(teamId: number): void {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) {
    throw new Error('teamId must be a positive integer');
  }
}


export function assertTeamObjectKey(teamId: number, objectKey: string): void {
  assertTeamId(teamId);

  if (!objectKey.startsWith(`teams/${teamId}/`)) {
    throw new Error('objectKey must belong to the supplied team');
  }
}

function getCosClient(): COS {
  if (cosClient) {
    return cosClient;
  }

  const environment = getObjectStorageEnvironment();
  cosClient = new COS({
    SecretId: environment.COS_SECRET_ID,
    SecretKey: environment.COS_SECRET_KEY
  });

  return cosClient;
}

function getBucketOptions(objectKey: string) {
  const environment = getObjectStorageEnvironment();

  return {
    Bucket: environment.COS_BUCKET,
    Region: environment.COS_REGION,
    Key: objectKey,
    Protocol: 'https:' as const,
    Sign: true,
    Expires: SIGNED_URL_TTL_SECONDS
  };
}

export function getObjectStoragePublicConfiguration() {
  const environment = getObjectStorageEnvironment();
  return { bucket: environment.COS_BUCKET, region: environment.COS_REGION };
}

export type PresignedProductImageUpload = {
  objectKey: string;
  url: string;
  headers: { 'Content-Type': ProductImageContentType };
  expiresAt: string;
};

export function createPresignedProductImageUpload(input: {
  teamId: number;
  contentType: ProductImageContentType;
  byteSize: number;
}): PresignedProductImageUpload {
  const extension = PRODUCT_IMAGE_EXTENSIONS[input.contentType];
  if (!extension || !Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error('Unsupported or oversized product image.');
  }
  assertTeamId(input.teamId);
  const objectKey = `teams/${input.teamId}/product-images/${randomUUID()}.${extension}`;
  assertProductImageObjectKey(input.teamId, objectKey);
  const headers = { 'Content-Type': input.contentType };
  const url = getCosClient().getObjectUrl({
    ...getBucketOptions(objectKey),
    Method: 'PUT',
    Headers: headers,
  });
  return {
    objectKey,
    url,
    headers,
    expiresAt: new Date(Date.now() + PRODUCT_IMAGE_UPLOAD_TTL_SECONDS * 1_000).toISOString(),
  };
}

function responseHeader(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return '';
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1]) : '';
}

export async function inspectProductImageObject(input: {
  teamId: number;
  objectKey: string;
  expectedContentType: ProductImageContentType;
  expectedByteSize: number;
}): Promise<void> {
  assertProductImageObjectKey(input.teamId, input.objectKey);
  const environment = getObjectStorageEnvironment();
  const prefix = await getCosClient().getObject({
    Bucket: environment.COS_BUCKET,
    Region: environment.COS_REGION,
    Key: input.objectKey,
    Range: 'bytes=0-15',
  });
  const contentType = responseHeader(prefix.headers, 'content-type').split(';', 1)[0]?.toLowerCase();
  const contentRange = responseHeader(prefix.headers, 'content-range');
  const rangeTotal = Number(contentRange.match(/\/(\d+)$/)?.[1]);
  const contentLength = Number(responseHeader(prefix.headers, 'content-length'));
  const byteSize = Number.isSafeInteger(rangeTotal) ? rangeTotal : contentLength;
  if (contentType !== input.expectedContentType) {
    throw Object.assign(new Error(`Product image MIME mismatch: expected ${input.expectedContentType}, received ${contentType || 'unknown'}.`), { code: 'mime_mismatch' });
  }
  if (!Number.isSafeInteger(byteSize) || byteSize !== input.expectedByteSize || byteSize > PRODUCT_IMAGE_MAX_BYTES) {
    throw Object.assign(new Error(`Product image size mismatch: expected ${input.expectedByteSize}, received ${Number.isFinite(byteSize) ? byteSize : 'unknown'}.`), { code: 'size_mismatch' });
  }
  if (!matchesProductImageMagicBytes(input.expectedContentType, new Uint8Array(prefix.Body))) {
    throw Object.assign(new Error('Product image magic bytes do not match its declared MIME type.'), { code: 'magic_bytes_mismatch' });
  }
}

export function createProductImageValidationStream(input: {
  contentType: ProductImageContentType;
  byteSize: number;
}): Transform {
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > PRODUCT_IMAGE_MAX_BYTES) {
    throw Object.assign(new Error('Product image size is invalid.'), { code: 'size_mismatch' });
  }
  let totalBytes = 0;
  let prefix = Buffer.alloc(0);
  let validated = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.byteLength;
      if (totalBytes > input.byteSize || totalBytes > PRODUCT_IMAGE_MAX_BYTES) {
        callback(Object.assign(new Error('Product image size exceeds the signed byte size.'), { code: 'size_mismatch' }));
        return;
      }
      if (!validated) {
        prefix = Buffer.concat([prefix, bytes]);
        if (prefix.length < 16 && totalBytes < input.byteSize) {
          callback();
          return;
        }
        if (!matchesProductImageMagicBytes(input.contentType, new Uint8Array(prefix))) {
          callback(Object.assign(new Error('Product image magic bytes do not match its declared MIME type.'), { code: 'magic_bytes_mismatch' }));
          return;
        }
        validated = true;
        callback(null, prefix);
        prefix = Buffer.alloc(0);
        return;
      }
      callback(null, bytes);
    },
    flush(callback) {
      if (!validated || totalBytes !== input.byteSize) {
        callback(Object.assign(new Error('Product image stream length does not match the signed byte size.'), { code: 'size_mismatch' }));
        return;
      }
      callback();
    },
  });
}

export async function uploadProductImageStream(input: {
  teamId: number;
  objectKey: string;
  contentType: ProductImageContentType;
  byteSize: number;
  body: Readable;
}): Promise<void> {
  assertProductImageObjectKey(input.teamId, input.objectKey);
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > PRODUCT_IMAGE_MAX_BYTES) {
    throw Object.assign(new Error('Product image size is invalid.'), { code: 'size_mismatch' });
  }
  const validator = createProductImageValidationStream({
    contentType: input.contentType,
    byteSize: input.byteSize,
  });
  input.body.pipe(validator);
  const environment = getObjectStorageEnvironment();
  await getCosClient().putObject({
    Body: validator,
    Bucket: environment.COS_BUCKET,
    ContentLength: input.byteSize,
    ContentType: input.contentType,
    Key: input.objectKey,
    Region: environment.COS_REGION,
  });
}

export async function probeUploadCors(input: {
  teamId: number;
  origin: string;
  contentType: string;
}): Promise<{ allowsOrigin: boolean; allowsPut: boolean; allowsContentType: boolean }> {
  assertTeamId(input.teamId);
  const environment = getObjectStorageEnvironment();
  const result = await getCosClient().optionsObject({
    Bucket: environment.COS_BUCKET,
    Region: environment.COS_REGION,
    Key: `teams/${input.teamId}/preflight/${randomUUID()}`,
    Origin: input.origin,
    AccessControlRequestMethod: 'PUT',
    AccessControlRequestHeaders: 'content-type',
  });
  const rawResult = result as unknown as Record<string, unknown>;
  if (result.statusCode === 403 || rawResult.OptionsForbidden === true) {
    throw Object.assign(new Error('COS rejected the CORS preflight request.'), { code: 'CorsPreflightForbidden', statusCode: 403 });
  }
  const allowOrigin = result.AccessControlAllowOrigin ?? responseHeader(result.headers, 'access-control-allow-origin');
  const allowMethods = result.AccessControlAllowMethods ?? responseHeader(result.headers, 'access-control-allow-methods');
  const allowHeaders = result.AccessControlAllowHeaders ?? responseHeader(result.headers, 'access-control-allow-headers');
  if (!allowOrigin || !allowMethods || !allowHeaders) {
    throw Object.assign(new Error('COS CORS preflight response is missing required allow headers.'), { code: 'CorsPreflightMissingHeaders', statusCode: result.statusCode ?? 403 });
  }
  const origins = allowOrigin.split(',').map((value) => value.trim());
  const methods = allowMethods.toUpperCase().split(',').map((value) => value.trim());
  const headers = allowHeaders.toLowerCase().split(',').map((value) => value.trim());
  return {
    allowsOrigin: origins.includes('*') || origins.includes(input.origin),
    allowsPut: methods.includes('PUT'),
    allowsContentType: headers.includes('*') || headers.includes('content-type'),
  };
}


export type PresignedReferenceUpload = {
  objectKey: string;
  url: string;
  headers: { 'Content-Type': ReferenceContentType };
  expiresAt: string;
};

export function createPresignedReferenceUpload(input: {
  teamId: number;
  contentType: ReferenceContentType;
  byteSize: number;
}): PresignedReferenceUpload {
  const extension = referenceExtensions[input.contentType];
  if (!extension || !Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > REFERENCE_MAX_BYTES) {
    throw new Error('Unsupported or oversized reference video.');
  }
  assertTeamId(input.teamId);
  const objectKey = `teams/${input.teamId}/references/${randomUUID()}.${extension}`;
  const headers = { 'Content-Type': input.contentType };
  const url = getCosClient().getObjectUrl({
    ...getBucketOptions(objectKey),
    Method: 'PUT',
    Headers: headers,
  });
  return {
    objectKey,
    url,
    headers,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1_000).toISOString(),
  };
}

export type PresignedCsvUpload = {
  objectKey: string;
  url: string;
  headers: {
    'Content-Type': 'text/csv';
  };
  expiresAt: string;
};

export function createPresignedCsvUpload(input: {
  teamId: number;
  byteSize: number;
}): PresignedCsvUpload {
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > CSV_MAX_BYTES) {
    throw new Error(`CSV file size must be between 1 and ${CSV_MAX_BYTES} bytes.`);
  }

  assertTeamId(input.teamId);
  const objectKey = `teams/${input.teamId}/imports/${randomUUID()}.csv`;
  const headers = {
    'Content-Type': 'text/csv' as const,
  };
  const url = getCosClient().getObjectUrl({
    ...getBucketOptions(objectKey),
    Method: 'PUT',
    Headers: headers,
  });

  return {
    objectKey,
    url,
    headers,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1_000).toISOString(),
  };
}

export type PresignedDownload = {
  url: string;
  expiresAt: string;
};

/**
 * The caller must load the Asset through a team-scoped query before signing.
 */
export function createPresignedDownload(input: {
  teamId: number;
  objectKey: string;
}): PresignedDownload {
  assertTeamObjectKey(input.teamId, input.objectKey);

  return {
    url: getCosClient().getObjectUrl({
      ...getBucketOptions(input.objectKey),
      Method: 'GET'
    }),
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1_000).toISOString()
  };
}

export async function downloadCsvObject(input: {
  teamId: number;
  objectKey: string;
}): Promise<Uint8Array> {
  assertTeamObjectKey(input.teamId, input.objectKey);
  if (!input.objectKey.startsWith(`teams/${input.teamId}/imports/`) || !input.objectKey.endsWith('.csv')) {
    throw new Error('CSV object key is invalid.');
  }

  const signed = createPresignedDownload(input);
  const response = await fetch(signed.url);
  if (!response.ok || !response.body) {
    throw new Error(`CSV object returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  if (contentType !== 'text/csv') {
    throw new Error('CSV object MIME type is invalid.');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > CSV_MAX_BYTES) {
    throw new Error('CSV object exceeds the size limit.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > CSV_MAX_BYTES) {
      await reader.cancel();
      throw new Error('CSV object exceeds the size limit.');
    }
    chunks.push(chunk.value);
  }
  if (totalBytes === 0) throw new Error('CSV object is empty.');
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export async function downloadReferenceObject(input: {
  teamId: number;
  objectKey: string;
}): Promise<{ body: Buffer; contentType: string }> {
  assertTeamObjectKey(input.teamId, input.objectKey);
  if (!input.objectKey.startsWith(`teams/${input.teamId}/references/`)) {
    throw new Error('Reference object key is invalid.');
  }

  const signed = createPresignedDownload(input);
  const response = await fetch(signed.url);
  if (!response.ok || !response.body) {
    throw new Error(`Reference object returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? '';
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(contentType)) {
    throw new Error(`Reference object MIME type ${contentType || 'unknown'} is not supported.`);
  }
  const maxBytes = 100 * 1024 * 1024;
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Reference object exceeds the size limit.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('Reference object exceeds the size limit.');
    }
    chunks.push(chunk.value);
  }
  if (totalBytes === 0) throw new Error('Reference object is empty.');
  return {
    body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes),
    contentType,
  };
}

export async function archiveGeneratedVideo(input: {
  sourceUrl: string;
  sourceHeaders?: Record<string, string>;
  teamId: number;
  videoJobId: number;
}): Promise<{
  byteSize: number;
  contentType: 'video/mp4';
  fileName: string;
  objectKey: string;
}> {
  assertTeamId(input.teamId);

  const sourceResponse = await fetch(input.sourceUrl, { headers: input.sourceHeaders });

  if (!sourceResponse.ok || !sourceResponse.body) {
    throw new Error(`Could not download the generated video from its provider (HTTP ${sourceResponse.status}).`);
  }

  // Node and DOM declarations disagree, but fetch returns a WHATWG stream at runtime.
  const nodeReadableBody = sourceResponse.body as unknown as NodeReadableStream;

  let byteSize = 0;
  const measuredBody = new Transform({
    transform(chunk, _encoding, callback) {
      byteSize += chunk.length;
      callback(null, chunk);
    },
  });
  Readable.fromWeb(nodeReadableBody).pipe(measuredBody);

  const environment = getObjectStorageEnvironment();
  const fileName = `video-job-${input.videoJobId}.mp4`;
  const objectKey = `teams/${input.teamId}/videos/${fileName}`;
  await getCosClient().putObject({
    Body: measuredBody,
    Bucket: environment.COS_BUCKET,
    ContentType: 'video/mp4',
    Key: objectKey,
    Region: environment.COS_REGION,
  });

  return {
    byteSize,
    contentType: 'video/mp4',
    fileName,
    objectKey,
  };
}

const remoteImageTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

const remoteReferenceTypes = {
  ...remoteImageTypes,
  'video/mp4': 'mp4',
} as const;

function matchesMagicBytes(contentType: string, body: Buffer): boolean {
  if (contentType === 'image/jpeg') return body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (contentType === 'image/png') return body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === 'image/webp') return body.subarray(0, 4).toString() === 'RIFF'
    && body.subarray(8, 12).toString() === 'WEBP';
  if (contentType === 'video/mp4') return body.subarray(4, 12).toString().includes('ftyp');
  return false;
}

async function fetchRemoteObject(input: {
  sourceUrl: string;
  maxBytes: number;
  allowedTypes: Record<string, string>;
}): Promise<{ body: Buffer; contentType: string }> {
  let currentUrl = input.sourceUrl;
  let response: Response | undefined;

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    await assertSafeRemoteUrl(currentUrl);
    response = await fetch(currentUrl, { redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) break;

    const location = response.headers.get('location');
    if (!location || redirectCount === 3) {
      throw new Error('Remote asset exceeded the redirect limit.');
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  if (!response?.ok) {
    throw new Error(`Remote asset returned HTTP ${response?.status ?? 'unknown'}.`);
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? '';
  if (!(contentType in input.allowedTypes)) {
    throw new Error(`Remote asset MIME type ${contentType || 'unknown'} is not supported.`);
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > input.maxBytes) {
    throw new Error('Remote asset exceeds the size limit.');
  }

  if (!response.body) throw new Error('Remote asset response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > input.maxBytes) throw new Error('Remote asset exceeds the size limit.');
    chunks.push(chunk.value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
  if (body.length === 0 || body.length > input.maxBytes || !matchesMagicBytes(contentType, body)) {
    throw new Error('Remote asset content does not match its declared type or size.');
  }

  return { body, contentType };
}

export async function archiveRemoteObject(input: {
  teamId: number;
  sourceUrl: string;
  kind: 'image' | 'reference';
  maxBytes?: number;
}): Promise<{
  objectKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
}> {
  assertTeamId(input.teamId);
  const allowedTypes = input.kind === 'image' ? remoteImageTypes : remoteReferenceTypes;
  const maxBytes = input.maxBytes ?? (input.kind === 'image' ? 20 * 1024 * 1024 : 100 * 1024 * 1024);
  const { body, contentType } = await fetchRemoteObject({
    sourceUrl: input.sourceUrl,
    maxBytes,
    allowedTypes,
  });
  const digest = createHash('sha256')
    .update(`${input.kind}:${input.sourceUrl}`)
    .digest('hex');
  const fileName = `${digest}.${(allowedTypes as Record<string, string>)[contentType]}`;
  const objectKey = `teams/${input.teamId}/import-assets/${fileName}`;
  const environment = getObjectStorageEnvironment();

  await getCosClient().putObject({
    Body: body,
    Bucket: environment.COS_BUCKET,
    ContentType: contentType,
    Key: objectKey,
    Region: environment.COS_REGION,
  });

  return {
    objectKey,
    fileName,
    contentType,
    byteSize: body.length,
  };
}

export async function deleteObjectForTeam(input: { teamId: number; objectKey: string }): Promise<void> {
  assertTeamObjectKey(input.teamId, input.objectKey);
  const environment = getObjectStorageEnvironment();
  await getCosClient().deleteObject({
    Bucket: environment.COS_BUCKET,
    Key: input.objectKey,
    Region: environment.COS_REGION,
  });
}
