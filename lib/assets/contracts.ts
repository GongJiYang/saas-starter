import { z } from 'zod';

export const PRODUCT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PRODUCT_IMAGE_UPLOAD_TTL_SECONDS = 15 * 60;
export const PRODUCT_IMAGE_FAILED_RETENTION_MS = 24 * 60 * 60 * 1_000;

export const productImageContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export type ProductImageContentType = z.infer<typeof productImageContentTypeSchema>;

export const uploadProbeContentTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);
export const PRODUCT_IMAGE_EXTENSIONS: Record<ProductImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const productImageUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: productImageContentTypeSchema,
  byteSize: z.number().int().positive().max(PRODUCT_IMAGE_MAX_BYTES),
}).strict();

export const uploadOperationStageSchema = z.enum([
  'signing',
  'preflight',
  'transfer',
  'verification',
  'archive',
  'complete',
]);
export type UploadOperationStage = z.infer<typeof uploadOperationStageSchema>;

export const uploadDiagnosticCodeSchema = z.enum([
  'cors_preflight_denied',
  'signature_expired',
  'credential_permission_denied',
  'object_key_mismatch',
  'object_not_found',
  'mime_mismatch',
  'size_mismatch',
  'magic_bytes_mismatch',
  'network_failure',
  'storage_account_arrears',
  'upload_expired',
  'unknown_upload_error',
]);
export type UploadDiagnosticCode = z.infer<typeof uploadDiagnosticCodeSchema>;

export const uploadDiagnosticSchema = z.object({
  code: uploadDiagnosticCodeSchema,
  stage: uploadOperationStageSchema,
  message: z.string().trim().min(1),
  retryable: z.boolean(),
  recommendation: z.string().trim().min(1),
}).strict();
export type UploadDiagnostic = z.infer<typeof uploadDiagnosticSchema>;

export const uploadPreflightRequestSchema = z.object({
  origin: z.string().url(),
  contentType: uploadProbeContentTypeSchema.default('image/jpeg'),
}).strict();

export const uploadPreflightResultSchema = z.object({
  bucket: z.string().min(1),
  region: z.string().min(1),
  origin: z.string().url(),
  signingAvailable: z.boolean(),
  cors: z.object({
    status: z.enum(['available', 'denied', 'unknown']),
    allowsOrigin: z.boolean(),
    allowsPut: z.boolean(),
    allowsContentType: z.boolean(),
  }).strict(),
  directUploadAvailable: z.boolean(),
  serverFallbackAvailable: z.literal(true),
  diagnostic: uploadDiagnosticSchema.nullable(),
}).strict();
export type UploadPreflightResult = z.infer<typeof uploadPreflightResultSchema>;

export function assertProductImageObjectKey(teamId: number, objectKey: string): void {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) throw new Error('Invalid Workspace.');
  if (!objectKey.startsWith(`teams/${teamId}/product-images/`)) {
    throw Object.assign(new Error('Product image object key does not belong to this Workspace.'), {
      code: 'object_key_mismatch',
    });
  }
}

export function matchesProductImageMagicBytes(contentType: ProductImageContentType, bytes: Uint8Array): boolean {
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  }
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

function errorRecord(error: unknown): { code: string; message: string; status: number | null } {
  if (!error || typeof error !== 'object') {
    return { code: '', message: error instanceof Error ? error.message : String(error), status: null };
  }
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === 'string' ? value.code : '',
    message: typeof value.message === 'string' ? value.message : error instanceof Error ? error.message : 'Upload failed.',
    status: typeof value.statusCode === 'number' ? value.statusCode : typeof value.status === 'number' ? value.status : null,
  };
}

export function classifyUploadError(error: unknown, stage: UploadOperationStage): UploadDiagnostic {
  const value = errorRecord(error);
  const normalized = `${value.code} ${value.message}`.toLowerCase();
  if (normalized.includes('upload_expired')) {
    return uploadDiagnosticSchema.parse({ code: 'upload_expired', stage, message: 'The upload request has expired.', retryable: true, recommendation: 'Request a new signed upload URL.' });
  }
  if (normalized.includes('arrears') || normalized.includes('recharge')) {
    return uploadDiagnosticSchema.parse({ code: 'storage_account_arrears', stage, message: 'COS account billing blocks object storage requests.', retryable: false, recommendation: 'Recharge or reactivate the configured COS account.' });
  }
  if (normalized.includes('object key') || normalized.includes('object_key_mismatch')) {
    return uploadDiagnosticSchema.parse({ code: 'object_key_mismatch', stage, message: 'The object key is outside this Workspace product-image prefix.', retryable: false, recommendation: 'Request a new upload URL from the current Workspace.' });
  }
  if (['requesttimetooskewed', 'signaturedoesnotmatch', 'expiredtoken', 'requestexpired'].some((code) => normalized.includes(code))) {
    return uploadDiagnosticSchema.parse({ code: 'signature_expired', stage, message: 'The upload signature is expired or no longer valid.', retryable: true, recommendation: 'Request a new signed upload URL and retry.' });
  }
  if (value.status === 403 && stage === 'preflight') {
    return uploadDiagnosticSchema.parse({ code: 'cors_preflight_denied', stage, message: 'COS rejected the browser CORS preflight for this Origin.', retryable: false, recommendation: 'Allow this Origin, PUT, Content-Type, and expose ETag in the COS bucket CORS policy.' });
  }
  if (value.status === 403 || normalized.includes('accessdenied')) {
    return uploadDiagnosticSchema.parse({ code: 'credential_permission_denied', stage, message: 'COS credentials do not have permission for this object operation.', retryable: false, recommendation: 'Grant the server credential the required object read/write/delete permissions.' });
  }
  if (value.status === 404 || normalized.includes('nosuchkey') || normalized.includes('not found')) {
    return uploadDiagnosticSchema.parse({ code: 'object_not_found', stage, message: 'The uploaded object was not found in COS.', retryable: true, recommendation: 'Upload the file again before completing the receipt.' });
  }
  if (normalized.includes('mime')) {
    return uploadDiagnosticSchema.parse({ code: 'mime_mismatch', stage, message: value.message, retryable: false, recommendation: 'Choose a JPEG, PNG, or WebP file whose MIME matches its bytes.' });
  }
  if (normalized.includes('magic')) {
    return uploadDiagnosticSchema.parse({ code: 'magic_bytes_mismatch', stage, message: value.message, retryable: false, recommendation: 'Choose a genuine JPEG, PNG, or WebP image.' });
  }
  if (normalized.includes('size') || normalized.includes('length')) {
    return uploadDiagnosticSchema.parse({ code: 'size_mismatch', stage, message: value.message, retryable: false, recommendation: 'Choose a file no larger than 20 MB and request a new signature.' });
  }
  if (error instanceof TypeError || normalized.includes('failed to fetch') || normalized.includes('network')) {
    return uploadDiagnosticSchema.parse({ code: 'network_failure', stage, message: 'The browser or server could not reach object storage.', retryable: true, recommendation: 'Run upload preflight, then retry or use the server upload fallback.' });
  }
  return uploadDiagnosticSchema.parse({ code: 'unknown_upload_error', stage, message: value.message || 'Upload failed.', retryable: true, recommendation: 'Retry once, then inspect the upload diagnostic record.' });
}
