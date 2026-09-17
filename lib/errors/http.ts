import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  domainErrorCodeSchema,
  domainRemediationSchema,
  normalizeDomainError,
  type DomainErrorCode,
} from './domain';

export const domainErrorResponseSchema = z.object({
  error: z.string().min(1),
  code: domainErrorCodeSchema,
  requestId: z.string().uuid(),
  field: z.string().min(1).optional(),
  details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  remediations: z.array(domainRemediationSchema),
}).strict();

export function domainErrorResponse(
  error: unknown,
  fallback: DomainErrorCode = 'internal_error',
  context: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const domainError = normalizeDomainError(error, fallback);
  const requestId = randomUUID();
  const technical = domainError.technicalCause ?? error;
  const workspaceName = typeof context.workspaceName === 'string' ? context.workspaceName : null;
  const customerMessage = workspaceName && (
    domainError.code === 'workspace_entity_forbidden'
    || domainError.code === 'workspace_entity_not_found'
  )
    ? `${domainError.message} Current Workspace: ${workspaceName}.`
    : domainError.message;
  const customerDetails = workspaceName
    ? { ...domainError.details, currentWorkspace: workspaceName }
    : domainError.details;
  console.error('[domain-error]', {
    requestId,
    code: domainError.code,
    customerMessage,
    internalDetail: technical instanceof Error ? technical.message : String(technical),
    stack: technical instanceof Error ? technical.stack : undefined,
    context,
  });
  const body = domainErrorResponseSchema.parse({
    error: customerMessage,
    code: domainError.code,
    requestId,
    field: domainError.field,
    details: customerDetails,
    remediations: domainError.remediations,
  });
  return NextResponse.json({ ...body, ...extra }, { status: domainError.status });
}

export function domainErrorBody(error: unknown, fallback: DomainErrorCode = 'internal_error') {
  const domainError = normalizeDomainError(error, fallback);
  return {
    error: domainError.message,
    code: domainError.code,
    field: domainError.field,
    details: domainError.details,
    remediations: domainError.remediations,
  };
}
