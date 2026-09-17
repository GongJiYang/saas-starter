import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  DomainError,
  customerNetworkError,
  domainErrorRegistry,
  normalizeDomainError,
} from '../lib/errors/domain';
import { classifyUploadError } from '../lib/assets/contracts';

const workspace = normalizeDomainError(new Error('Brand Kit does not belong to the current Workspace.'));
assert.equal(workspace.code, 'workspace_entity_forbidden');
assert.match(workspace.message, /another Workspace|current Workspace/i);

const eligibility = normalizeDomainError(new Error('No active Shot Skill is eligible for every selected SKU.'));
assert.equal(eligibility.code, 'skill_ineligible');
assert.ok(eligibility.remediations.some((remediation) => remediation.href === '/dashboard/skills'));
assert.ok(eligibility.remediations.some((remediation) => remediation.href === '/dashboard/catalog'));

const cost = normalizeDomainError(new Error('Single production cost confirmation is stale or missing.'));
assert.equal(cost.code, 'cost_confirmation_stale');
assert.match(cost.message, /Spec, frozen Skill, SKU selection, quantity, or duration changed/);

const transition = normalizeDomainError(new Error('Invalid production_batch transition: draft → producing'));
assert.equal(transition.code, 'invalid_transition');
assert.equal(transition.details.currentStatus, 'draft');
assert.equal(transition.details.requestedStatus, 'producing');
assert.match(transition.message, /currently draft/);
assert.match(transition.message, /highlighted Next action/);

const validation = normalizeDomainError(new z.ZodError([{
  code: 'custom',
  path: ['durationSeconds'],
  message: 'Invalid duration.',
}]));
assert.equal(validation.code, 'request_invalid');
assert.equal(validation.field, 'durationSeconds');

const upload = customerNetworkError(new TypeError('Failed to fetch'));
assert.equal(upload.code, 'asset_upload_failed');
assert.doesNotMatch(upload.message, /Failed to fetch/i);
assert.match(upload.message, /CORS|object storage|network/i);
const uploadDiagnostic = classifyUploadError(new TypeError('Failed to fetch'), 'transfer');
assert.equal(uploadDiagnostic.code, 'network_failure');
assert.doesNotMatch(uploadDiagnostic.message, /Failed to fetch/i);
assert.match(uploadDiagnostic.recommendation, /fallback/i);

const quality = normalizeDomainError(new Error('QA evidence does not pass quality checks.'));
assert.equal(quality.code, 'quality_gate_failed');
assert.ok(quality.remediations.some((remediation) => remediation.href === '/dashboard/reviews'));

const forbiddenCustomerFragments = [
  'eligibility.all.',
  'provider.durationSeconds',
  'PostgresError',
  'duplicate key value',
  'Failed to fetch',
];
for (const [code, entry] of Object.entries(domainErrorRegistry)) {
  assert.ok(entry.message.length > 0, `${code} needs customer copy.`);
  assert.ok(entry.remediations.every((remediation) => remediation.href.startsWith('/dashboard')));
  for (const fragment of forbiddenCustomerFragments) {
    assert.equal(entry.message.includes(fragment), false, `${code} leaks ${fragment}.`);
  }
}

const explicit = new DomainError('spec_not_approved', {
  remediations: [{ action: 'review_spec', label: 'Review Spec', href: '/dashboard/specs#spec-9' }],
});
assert.equal(explicit.remediations[0]?.href, '/dashboard/specs#spec-9');
console.info('Customer DomainError snapshot checks passed.');
