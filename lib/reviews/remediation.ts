export type ReviewRejectionCause =
  | 'technical'
  | 'fidelity'
  | 'spec_mismatch'
  | 'preference_change'
  | 'brief_change';

const reviewRejectionCauses = new Set<string>(['technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change']);

export function isReviewRejectionCause(value: string | null): value is ReviewRejectionCause {
  return value !== null && reviewRejectionCauses.has(value);
}

export type ReviewRemediation = {
  code: string;
  message: string;
  href: string;
  label: string;
};

export function getSingleReviewRemediation(input: {
  cause: ReviewRejectionCause;
  batchId: number;
  catalogItemId: number;
  campaignId: number;
  specVersionId: number;
}): ReviewRemediation {
  switch (input.cause) {
    case 'technical':
      return {
        code: 'review_retry_technical',
        message: 'The output was not adopted because of a technical failure. Retry generation with the unchanged approved inputs.',
        href: `/dashboard/batches/${input.batchId}#next-action`,
        label: 'Retry generation',
      };
    case 'fidelity':
      return {
        code: 'review_fix_fidelity',
        message: 'The output was not adopted because product fidelity failed. Review the verified SKU materials before retrying.',
        href: `/dashboard/catalog/${input.catalogItemId}#edit-product`,
        label: 'Review SKU materials',
      };
    case 'spec_mismatch':
      return {
        code: 'review_correct_spec',
        message: 'The output did not match the approved Creative Spec. Correct the Spec before generating another output.',
        href: `/dashboard/specs#spec-${input.specVersionId}`,
        label: 'Correct Creative Spec',
      };
    case 'preference_change':
      return {
        code: 'review_update_preference',
        message: 'The creative preference changed after generation. Create and approve a new Creative Spec version.',
        href: `/dashboard/specs#spec-${input.specVersionId}`,
        label: 'Create new Spec version',
      };
    case 'brief_change':
      return {
        code: 'review_update_brief',
        message: 'The Campaign Brief changed after generation. Update the Campaign before creating a new Spec version.',
        href: `/dashboard/campaigns/${input.campaignId}`,
        label: 'Update Campaign Brief',
      };
  }
}
