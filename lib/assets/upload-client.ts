'use client';

import {
  classifyUploadError,
  type UploadDiagnostic,
  type UploadOperationStage,
  type UploadPreflightResult,
} from './contracts';

type SignedUpload = {
  url: string;
  headers: Record<string, string>;
  completeUrl?: string;
  fallbackUrl?: string;
};

type UploadResult = {
  asset?: { id: number; fileName: string; contentType: string; byteSize: number };
  upload?: { id: number };
  transport: 'direct' | 'server_fallback';
};

export class UploadClientError extends Error {
  constructor(readonly diagnostic: UploadDiagnostic) {
    super(`${diagnostic.message} ${diagnostic.recommendation}`);
  }
}

class DirectUploadError extends Error {
  constructor(readonly status: number, readonly responseText: string) {
    super(responseText || `Direct upload returned HTTP ${status || 'unknown'}.`);
  }
}

function cosErrorFromResponse(error: DirectUploadError): unknown {
  const code = error.responseText.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? '';
  const message = error.responseText.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? error.message;
  return Object.assign(new Error(message), { code, statusCode: error.status });
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  stage: UploadOperationStage = 'transfer',
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new UploadClientError(classifyUploadError(error, stage));
  }
  const body = await response.json().catch(() => ({})) as { error?: string; diagnostic?: UploadDiagnostic } & T;
  if (!response.ok) {
    if (body.diagnostic) throw new UploadClientError(body.diagnostic);
    throw new UploadClientError(classifyUploadError(new Error(body.error ?? 'Upload request failed.'), stage));
  }
  return body;
}

function putDirect(file: File, signed: SignedUpload, onProgress?: (percent: number) => void): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const request = new XMLHttpRequest();
  request.open('PUT', signed.url);
  for (const [name, value] of Object.entries(signed.headers)) request.setRequestHeader(name, value);
  request.upload.onprogress = (event) => {
    if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
  };
  request.onload = () => {
    if (request.status >= 200 && request.status < 300) resolve();
    else reject(new DirectUploadError(request.status, request.responseText));
  };
  request.onerror = () => reject(new DirectUploadError(request.status, request.responseText));
  request.onabort = () => reject(new Error('Upload was cancelled.'));
  request.send(file);
  return promise;
}

export async function runUploadPreflight(contentType: string): Promise<UploadPreflightResult> {
  return requestJson<UploadPreflightResult>('/api/assets/uploads/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: window.location.origin, contentType }),
  }, 'preflight');
}

async function fallbackUpload(file: File, fallbackUrl: string): Promise<UploadResult> {
  let response: Response;
  try {
    response = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
  } catch (error) {
    throw new UploadClientError(classifyUploadError(error, 'transfer'));
  }
  const body = await response.json().catch(() => ({})) as {
    asset?: UploadResult['asset'];
    upload?: UploadResult['upload'];
    error?: string;
    diagnostic?: UploadDiagnostic;
  };
  if (!response.ok) {
    if (body.diagnostic) throw new UploadClientError(body.diagnostic);
    throw new UploadClientError(classifyUploadError(new Error(body.error ?? 'Server upload fallback failed.'), 'transfer'));
  }
  return { asset: body.asset, upload: body.upload, transport: 'server_fallback' };
}

export async function uploadSignedFile(input: {
  file: File;
  signed: SignedUpload;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult> {
  try {
    await putDirect(input.file, input.signed, input.onProgress);
    input.onProgress?.(100);
  } catch (error) {
    const directDiagnostic = error instanceof DirectUploadError
      ? classifyUploadError(cosErrorFromResponse(error), 'transfer')
      : classifyUploadError(error, 'transfer');
    if (directDiagnostic.code === 'signature_expired' || directDiagnostic.code === 'credential_permission_denied' || directDiagnostic.code === 'storage_account_arrears') {
      throw new UploadClientError(directDiagnostic);
    }
    const preflight = await runUploadPreflight(input.file.type);
    if (!input.signed.fallbackUrl) {
      throw new UploadClientError(preflight.diagnostic ?? directDiagnostic);
    }
    if (preflight.diagnostic && !['cors_preflight_denied', 'network_failure'].includes(preflight.diagnostic.code)) {
      throw new UploadClientError(preflight.diagnostic);
    }
    return fallbackUpload(input.file, input.signed.fallbackUrl);
  }

  if (!input.signed.completeUrl) return { transport: 'direct' };
  const completed = await requestJson<{ asset: UploadResult['asset']; upload: UploadResult['upload'] }>(input.signed.completeUrl, { method: 'POST' }, 'complete');
  return { ...completed, transport: 'direct' };
}
