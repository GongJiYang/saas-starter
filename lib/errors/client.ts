'use client';

export function customerErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.toLowerCase();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'The device is offline. Reconnect to the internet, then retry the upload.';
  }
  if (error instanceof DOMException && error.name === 'AbortError' || normalized.includes('timeout')) {
    return 'The upload timed out before object storage responded. Retry, or use the server upload fallback.';
  }
  if (error instanceof TypeError || normalized.includes('failed to fetch') || normalized.includes('networkerror')) {
    return 'The browser could not reach object storage. Check DNS and the bucket CORS Origin, then retry; the server upload fallback remains available.';
  }
  return message || fallback;
}
