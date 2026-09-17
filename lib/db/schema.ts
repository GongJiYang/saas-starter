import {
  boolean,
  check,
  index,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 20 }),
});

export const teamMembers = pgTable('team_members', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  role: varchar('role', { length: 50 }).notNull(),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

export const invitations = pgTable('invitations', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  invitedBy: integer('invited_by')
    .notNull()
    .references(() => users.id),
  invitedAt: timestamp('invited_at').notNull().defaultNow(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
});

export const campaignStatus = pgEnum('campaign_status', [
  'draft',
  'ready',
  'generating',
  'review',
  'completed',
  'failed',
]);

export const assetType = pgEnum('asset_type', [
  'product_image',
  'generated_video',
]);

export const assetUploadSource = pgEnum('asset_upload_source', [
  'legacy',
  'local_upload',
  'remote_archive',
  'csv_import',
  'generated',
]);

export const assetUploadStatus = pgEnum('asset_upload_status', [
  'signed',
  'uploading',
  'uploaded',
  'archiving',
  'completed',
  'failed',
  'expired',
]);

export const assetUploadStage = pgEnum('asset_upload_stage', [
  'signing',
  'transfer',
  'verification',
  'archive',
  'complete',
]);

export const shotCardStatus = pgEnum('shot_card_status', [
  'proposed',
  'selected',
]);

export const shotSkillStatus = pgEnum('shot_skill_status', [
  'draft',
  'testing',
  'active',
  'deprecated',
  'retired',
]);

export const videoJobStatus = pgEnum('video_job_status', [
  'queued',
  'generating',
  'succeeded',
  'failed',
]);

export const reviewDecision = pgEnum('review_decision', [
  'adopted',
  'not_adopted',
]);

export const importBatchStatus = pgEnum('import_batch_status', [
  'uploaded',
  'validating',
  'needs_fix',
  'ready',
  'committed',
  'failed',
]);

export const importRowStatus = pgEnum('import_row_status', [
  'pending',
  'ready',
  'needs_fix',
  'excluded',
  'committed',
]);

export const catalogItemStatus = pgEnum('catalog_item_status', [
  'needs_input',
  'ready',
  'archived',
]);

export const creativeReferenceRights = pgEnum('creative_reference_rights', [
  'owned',
  'licensed',
  'inspiration_only',
]);

export const creativeReferenceMode = pgEnum('creative_reference_mode', [
  'structure',
  'owned_template',
]);

export const referenceAnalysisStatus = pgEnum('reference_analysis_status', [
  'draft',
  'approved',
  'rejected',
  'failed',
]);

export const productionBatchStatus = pgEnum('production_batch_status', [
  'draft',
  'ready_for_spec',
  'ready_to_generate',
  'generating',
  'review',
  'calibrating',
  'pilot_review',
  'ready',
  'producing',
  'paused',
  'reviewing',
  'completed',
  'cancelled',
]);

export const productionGenerationMode = pgEnum('production_generation_mode', [
  'single',
  'bulk',
]);

export const productionSourceMode = pgEnum('production_source_mode', [
  'catalog',
  'uploaded_images',
]);

export const productionPromptMode = pgEnum('production_prompt_mode', [
  'inherit',
  'override',
]);

export const productionBatchItemStatus = pgEnum('production_batch_item_status', [
  'pending',
  'pilot',
  'ready',
  'queued',
  'producing',
  'quality_review',
  'review',
  'completed',
  'failed',
  'excluded',
]);

export const creativeSpecStatus = pgEnum('creative_spec_status', [
  'draft',
  'awaiting_approval',
  'approved',
  'rejected',
  'superseded',
]);

export const brandKits = pgTable(
  'brand_kits',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 100 }).notNull(),
    brandVoice: text('brand_voice').notNull(),
    requiredElements: text('required_elements').notNull(),
    forbiddenElements: text('forbidden_elements').notNull(),
    defaultShotPreference: text('default_shot_preference').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('brand_kits_team_name_unique').on(table.teamId, table.name),
    index('brand_kits_team_created_at_idx').on(table.teamId, table.createdAt),
  ],
);

export const brandKitPreferenceVersions = pgTable(
  'brand_kit_preference_versions',
  {
    id: serial('id').primaryKey(),
    brandKitId: integer('brand_kit_id').notNull().references(() => brandKits.id),
    teamId: integer('team_id').notNull().references(() => teams.id),
    version: integer('version').notNull(),
    preference: text('preference').notNull(),
    sourceBatchId: integer('source_batch_id'),
    createdBy: integer('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('brand_kit_preference_versions_brand_version_unique').on(table.brandKitId, table.version),
    index('brand_kit_preference_versions_team_created_at_idx').on(table.teamId, table.createdAt),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    uploadedBy: integer('uploaded_by')
      .notNull()
      .references(() => users.id),
    type: assetType('type').notNull(),
    uploadSource: assetUploadSource('upload_source').notNull().default('legacy'),
    objectKey: text('object_key').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 100 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('assets_object_key_unique').on(table.objectKey),
    uniqueIndex('assets_id_team_unique').on(table.id, table.teamId),
    index('assets_team_created_at_idx').on(table.teamId, table.createdAt),
  ],
);

export const assetUploads = pgTable(
  'asset_uploads',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    createdBy: integer('created_by').notNull().references(() => users.id),
    assetId: integer('asset_id'),
    productionBatchId: integer('production_batch_id'),
    clientFileId: varchar('client_file_id', { length: 100 }),
    sequence: integer('sequence'),
    source: assetUploadSource('source').notNull(),
    status: assetUploadStatus('status').notNull().default('signed'),
    stage: assetUploadStage('stage').notNull().default('signing'),
    objectKey: text('object_key').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 100 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    signedAt: timestamp('signed_at').notNull().defaultNow(),
    uploadedAt: timestamp('uploaded_at'),
    archivedAt: timestamp('archived_at'),
    failedAt: timestamp('failed_at'),
    expiresAt: timestamp('expires_at'),
    errorCode: varchar('error_code', { length: 100 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('asset_uploads_byte_size_positive', sql`${table.byteSize} > 0`),
    check(
      'asset_uploads_completed_valid',
      sql`${table.status} <> 'completed' OR (${table.assetId} IS NOT NULL AND ${table.archivedAt} IS NOT NULL)`,
    ),
    check(
      'asset_uploads_failed_valid',
      sql`${table.status} <> 'failed' OR (${table.errorCode} IS NOT NULL AND ${table.failedAt} IS NOT NULL)`,
    ),
    uniqueIndex('asset_uploads_team_object_key_unique').on(table.teamId, table.objectKey),
    index('asset_uploads_team_status_created_at_idx').on(table.teamId, table.status, table.createdAt),
    foreignKey({
      columns: [table.assetId, table.teamId],
      foreignColumns: [assets.id, assets.teamId],
      name: 'asset_uploads_asset_team_fk',
    }),
    foreignKey({
      columns: [table.productionBatchId, table.teamId],
      foreignColumns: [productionBatches.id, productionBatches.teamId],
      name: 'asset_uploads_batch_team_fk',
    }),
    uniqueIndex('asset_uploads_batch_client_file_unique').on(table.productionBatchId, table.clientFileId),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    brandKitId: integer('brand_kit_id')
      .notNull()
      .references(() => brandKits.id),
    productAssetId: integer('product_asset_id')
      .notNull()
      .references(() => assets.id),
    name: varchar('name', { length: 160 }).notNull(),
    sellingPoints: text('selling_points').notNull(),
    targetPlatform: varchar('target_platform', { length: 50 }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    status: campaignStatus('status').notNull().default('draft'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('campaigns_duration_seconds_positive', sql`${table.durationSeconds} > 0`),
    index('campaigns_team_status_created_at_idx').on(
      table.teamId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const shotCards = pgTable(
  'shot_cards',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    position: integer('position').notNull(),
    title: varchar('title', { length: 100 }).notNull(),
    description: text('description').notNull(),
    status: shotCardStatus('status').notNull().default('proposed'),
    shotSkillVersionId: integer('shot_skill_version_id').references(() => shotSkillVersions.id),
    skillSelectionReason: text('skill_selection_reason'),
    skillEligibility: text('skill_eligibility').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('shot_cards_position_range', sql`${table.position} BETWEEN 1 AND 3`),
    uniqueIndex('shot_cards_campaign_position_unique').on(
      table.campaignId,
      table.position,
    ),
    uniqueIndex('shot_cards_selected_campaign_unique')
      .on(table.campaignId)
      .where(sql`${table.status} = 'selected'`),
    index('shot_cards_team_campaign_idx').on(table.teamId, table.campaignId),
    index('shot_cards_skill_version_idx').on(table.shotSkillVersionId),
  ],
);

export const shotSkills = pgTable(
  'shot_skills',
  {
    id: serial('id').primaryKey(),
    stableId: varchar('stable_id', { length: 100 }).notNull(),
    ownerTeamId: integer('owner_team_id').references(() => teams.id),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('shot_skills_official_stable_id_unique')
      .on(table.stableId)
      .where(sql`${table.ownerTeamId} IS NULL`),
    uniqueIndex('shot_skills_team_stable_id_unique')
      .on(table.ownerTeamId, table.stableId)
      .where(sql`${table.ownerTeamId} IS NOT NULL`),
    index('shot_skills_owner_team_created_at_idx').on(table.ownerTeamId, table.createdAt),
  ],
);

export const shotSkillVersions = pgTable(
  'shot_skill_versions',
  {
    id: serial('id').primaryKey(),
    shotSkillId: integer('shot_skill_id')
      .notNull()
      .references(() => shotSkills.id),
    parentVersionId: integer('parent_version_id').references((): AnyPgColumn => shotSkillVersions.id),
    version: varchar('version', { length: 30 }).notNull(),
    specVersion: varchar('spec_version', { length: 20 }).notNull(),
    status: shotSkillStatus('status').notNull().default('draft'),
    normalizedDefinition: jsonb('normalized_definition').notNull(),
    definitionHash: varchar('definition_hash', { length: 64 }).notNull(),
    provenance: jsonb('provenance').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [
    uniqueIndex('shot_skill_versions_skill_version_unique').on(table.shotSkillId, table.version),
    uniqueIndex('shot_skill_versions_one_active_per_skill')
      .on(table.shotSkillId)
      .where(sql`${table.status} = 'active'`),
    index('shot_skill_versions_skill_status_created_at_idx').on(
      table.shotSkillId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const shotSkillReleaseValidations = pgTable(
  'shot_skill_release_validations',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    shotSkillVersionId: integer('shot_skill_version_id').notNull().references(() => shotSkillVersions.id),
    definitionHash: varchar('definition_hash', { length: 64 }).notNull(),
    fixture: jsonb('fixture').notNull(),
    fixtureHash: varchar('fixture_hash', { length: 64 }).notNull(),
    eligible: boolean('eligible').notNull(),
    reasons: jsonb('reasons').notNull(),
    fallbackSkillId: varchar('fallback_skill_id', { length: 100 }),
    fallbackEligible: boolean('fallback_eligible'),
    selectionReason: text('selection_reason').notNull(),
    compiledRecipe: jsonb('compiled_recipe'),
    createdBy: integer('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'shot_skill_release_validations_hashes_valid',
      sql`${table.definitionHash} ~ '^[a-f0-9]{64}$' AND ${table.fixtureHash} ~ '^[a-f0-9]{64}$'`,
    ),
    index('shot_skill_release_validations_version_created_at_idx').on(
      table.shotSkillVersionId,
      table.createdAt,
    ),
    index('shot_skill_release_validations_team_version_idx').on(
      table.teamId,
      table.shotSkillVersionId,
    ),
  ],
);

export const videoJobs = pgTable(
  'video_jobs',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    campaignId: integer('campaign_id').references(() => campaigns.id),
    productionBatchItemId: integer('production_batch_item_id'),
    inputAssetId: integer('input_asset_id'),
    creativeSpecVersionId: integer('creative_spec_version_id').references(() => creativeSpecVersions.id),
    shotCardId: integer('shot_card_id').references(() => shotCards.id),
    submittedBy: integer('submitted_by')
      .notNull()
      .references(() => users.id),
    provider: varchar('provider', { length: 50 }).notNull().default('minimax'),
    shotSkillId: varchar('shot_skill_id', { length: 100 }),
    shotSkillVersionId: integer('shot_skill_version_id').references(() => shotSkillVersions.id),
    shotSkillVersion: varchar('shot_skill_version', { length: 30 }),
    shotSkillHash: varchar('shot_skill_hash', { length: 64 }),
    recipeSnapshot: text('recipe_snapshot'),
    externalTaskId: text('external_task_id'),
    status: videoJobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    failureCode: varchar('failure_code', { length: 100 }),
    failureReason: text('failure_reason'),
    qualityReport: text('quality_report').notNull().default('{}'),
    qualityObservationHash: varchar('quality_observation_hash', { length: 64 }),
    actualCostCny: numeric('actual_cost_cny', { precision: 12, scale: 2 }),
    retryOfVideoJobId: integer('retry_of_video_job_id'),
    retryReason: varchar('retry_reason', { length: 30 }),
    outputAssetId: integer('output_asset_id').references(() => assets.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [
    check('video_jobs_attempts_nonnegative', sql`${table.attempts} >= 0`),
    check(
      'video_jobs_new_recipe_complete',
      sql`(
        ${table.shotSkillVersionId} IS NOT NULL
        AND ${table.shotSkillId} IS NOT NULL
        AND ${table.shotSkillVersion} IS NOT NULL
        AND ${table.shotSkillHash} IS NOT NULL
        AND ${table.recipeSnapshot} IS NOT NULL
      ) OR (
        ${table.productionBatchItemId} IS NOT NULL
        AND ${table.inputAssetId} IS NOT NULL
        AND ${table.recipeSnapshot} IS NOT NULL
      )`,
    ),
    check(
      'video_jobs_quality_observation_hash_format',
      sql`${table.qualityObservationHash} IS NULL OR ${table.qualityObservationHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'video_jobs_context_shape',
      sql`(${table.campaignId} IS NULL AND ${table.shotCardId} IS NULL AND ${table.creativeSpecVersionId} IS NULL)
        OR (${table.campaignId} IS NOT NULL AND ${table.shotCardId} IS NOT NULL)`,
    ),
    check(
      'video_jobs_execution_source_complete',
      sql`${table.productionBatchItemId} IS NOT NULL AND ${table.inputAssetId} IS NOT NULL`,
    ),
    foreignKey({
      columns: [table.productionBatchItemId, table.teamId],
      foreignColumns: [productionBatchItems.id, productionBatchItems.teamId],
      name: 'video_jobs_batch_item_team_fk',
    }),
    foreignKey({
      columns: [table.inputAssetId, table.teamId],
      foreignColumns: [assets.id, assets.teamId],
      name: 'video_jobs_input_asset_team_fk',
    }),
    uniqueIndex('video_jobs_provider_external_task_id_unique').on(
      table.provider,
      table.externalTaskId,
    ),
    uniqueIndex('video_jobs_evidence_identity_unique').on(
      table.id,
      table.teamId,
      table.shotSkillVersionId,
    ),
    uniqueIndex('video_jobs_active_campaign_unique')
      .on(table.campaignId)
      .where(
        sql`${table.status} IN ('queued', 'generating')`,
      ),
    uniqueIndex('video_jobs_active_batch_item_unique')
      .on(table.productionBatchItemId)
      .where(sql`${table.status} IN ('queued', 'generating')`),
    index('video_jobs_batch_item_created_at_idx').on(table.productionBatchItemId, table.createdAt),
    index('video_jobs_team_status_created_at_idx').on(
      table.teamId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const reviews = pgTable(
  'reviews',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    videoJobId: integer('video_job_id')
      .notNull()
      .references(() => videoJobs.id),
    reviewerId: integer('reviewer_id')
      .notNull()
      .references(() => users.id),
    decision: reviewDecision('decision').notNull(),
    reason: text('reason'),
    qualityFailureCause: varchar('quality_failure_cause', { length: 30 }),
    qualityReport: text('quality_report').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'reviews_decision_cause_consistent',
      sql`(
        ${table.decision} = 'adopted'
        AND ${table.reason} IS NULL
        AND ${table.qualityFailureCause} IS NULL
      ) OR (
        ${table.decision} = 'not_adopted'
        AND length(trim(coalesce(${table.reason}, ''))) > 0
        AND ${table.qualityFailureCause} IN ('technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change')
      )`,
    ),
    check(
      'reviews_quality_report_frozen',
      sql`length(trim(${table.qualityReport})) > 2 AND trim(${table.qualityReport}) <> '{}'`,
    ),
    uniqueIndex('reviews_evidence_identity_unique').on(table.id, table.videoJobId, table.teamId),
    uniqueIndex('reviews_video_job_unique').on(table.videoJobId),
    index('reviews_team_decision_created_at_idx').on(
      table.teamId,
      table.decision,
      table.createdAt,
    ),
  ],
);

export const shotSkillValidationEvidence = pgTable(
  'shot_skill_validation_evidence',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    shotSkillVersionId: integer('shot_skill_version_id').notNull().references(() => shotSkillVersions.id),
    videoJobId: integer('video_job_id').notNull().references(() => videoJobs.id),
    reviewId: integer('review_id').references(() => reviews.id),
    evidenceType: varchar('evidence_type', { length: 30 }).notNull(),
    passed: boolean('passed').notNull(),
    reason: text('reason'),
    detail: jsonb('detail').notNull(),
    observationHash: varchar('observation_hash', { length: 64 }).notNull(),
    observationSnapshot: text('observation_snapshot').notNull(),
    evidenceSnapshot: text('evidence_snapshot').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'shot_skill_validation_evidence_type_consistent',
      sql`(
        ${table.evidenceType} = 'quality_gate'
        AND ${table.reviewId} IS NULL
      ) OR (
        ${table.evidenceType} IN ('adopted', 'rejected')
        AND ${table.reviewId} IS NOT NULL
      )`,
    ),
    check(
      'shot_skill_validation_evidence_passed_consistent',
      sql`(${table.evidenceType} <> 'adopted' OR ${table.passed})
        AND (${table.evidenceType} <> 'rejected' OR NOT ${table.passed})`,
    ),
    check(
      'shot_skill_validation_evidence_reason_consistent',
      sql`(${table.evidenceType} <> 'rejected' OR (
          length(trim(coalesce(${table.reason}, ''))) > 0
          AND ${table.detail}->>'rejectionCause' IN ('technical', 'fidelity', 'spec_mismatch', 'preference_change', 'brief_change')
        ))
        AND (${table.evidenceType} <> 'adopted' OR ${table.reason} IS NULL)`,
    ),
    check(
      'shot_skill_validation_evidence_snapshots_valid',
      sql`${table.observationHash} ~ '^[a-f0-9]{64}$'
        AND length(trim(${table.observationSnapshot})) > 2
        AND length(trim(${table.evidenceSnapshot})) > 2`,
    ),
    foreignKey({
      columns: [table.videoJobId, table.teamId, table.shotSkillVersionId],
      foreignColumns: [videoJobs.id, videoJobs.teamId, videoJobs.shotSkillVersionId],
      name: 'shot_skill_validation_evidence_job_identity_fk',
    }),
    foreignKey({
      columns: [table.reviewId, table.videoJobId, table.teamId],
      foreignColumns: [reviews.id, reviews.videoJobId, reviews.teamId],
      name: 'shot_skill_validation_evidence_review_identity_fk',
    }),
    uniqueIndex('shot_skill_validation_evidence_job_type_unique').on(table.videoJobId, table.evidenceType),
    index('shot_skill_validation_evidence_version_created_at_idx').on(table.shotSkillVersionId, table.createdAt),
  ],
);
 
export const catalogItems = pgTable(
  'catalog_items',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    createdBy: integer('created_by').notNull().references(() => users.id),
    externalSku: varchar('external_sku', { length: 160 }).notNull(),
    productName: varchar('product_name', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(),
    primaryImageUrl: text('primary_image_url').notNull(),
    productPageUrl: text('product_page_url'),
    primaryAssetId: integer('primary_asset_id'),
    readinessStatus: catalogItemStatus('readiness_status').notNull().default('needs_input'),
    readinessErrors: text('readiness_errors').notNull().default('[]'),
    approvedClaims: text('approved_claims').notNull().default('[]'),
    prohibitedClaims: text('prohibited_claims').notNull().default('[]'),
    mustShowElements: text('must_show_elements').notNull().default('[]'),
    immutableElements: text('immutable_elements').notNull().default('[]'),
    targetAudience: text('target_audience').notNull(),
    campaignGoal: text('campaign_goal').notNull(),
    platform: varchar('platform', { length: 50 }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    brandKitId: integer('brand_kit_id').notNull().references(() => brandKits.id),
    cta: text('cta').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('catalog_items_duration_seconds_positive', sql`${table.durationSeconds} BETWEEN 4 AND 15`),
    check(
      'catalog_items_ready_requires_primary_asset',
      sql`${table.readinessStatus} <> 'ready' OR ${table.primaryAssetId} IS NOT NULL`,
    ),
    uniqueIndex('catalog_items_team_external_sku_unique').on(table.teamId, table.externalSku),
    index('catalog_items_team_readiness_created_at_idx').on(
      table.teamId,
      table.readinessStatus,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.primaryAssetId, table.teamId],
      foreignColumns: [assets.id, assets.teamId],
      name: 'catalog_items_primary_asset_team_fk',
    }),
  ],
);

export const catalogItemAssets = pgTable(
  'catalog_item_assets',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    catalogItemId: integer('catalog_item_id').notNull().references(() => catalogItems.id),
    assetId: integer('asset_id').references(() => assets.id),
    purpose: varchar('purpose', { length: 50 }).notNull(),
    position: integer('position').notNull(),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('catalog_item_assets_position_positive', sql`${table.position} > 0`),
    check('catalog_item_assets_has_source', sql`${table.assetId} IS NOT NULL OR ${table.sourceUrl} IS NOT NULL`),
    uniqueIndex('catalog_item_assets_item_purpose_position_unique').on(
      table.catalogItemId,
      table.purpose,
      table.position,
    ),
    index('catalog_item_assets_team_item_idx').on(table.teamId, table.catalogItemId),
  ],
);

export const importBatches = pgTable(
  'import_batches',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    uploadedBy: integer('uploaded_by').notNull().references(() => users.id),
    fileObjectKey: text('file_object_key').notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    templateVersion: varchar('template_version', { length: 20 }).notNull(),
    status: importBatchStatus('status').notNull().default('uploaded'),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    invalidRows: integer('invalid_rows').notNull().default(0),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    committedAt: timestamp('committed_at'),
  },
  (table) => [
    check('import_batches_counts_nonnegative', sql`${table.totalRows} >= 0 AND ${table.validRows} >= 0 AND ${table.invalidRows} >= 0`),
    uniqueIndex('import_batches_team_file_hash_unique').on(table.teamId, table.fileHash),
    uniqueIndex('import_batches_team_idempotency_unique').on(table.teamId, table.idempotencyKey),
    index('import_batches_team_status_created_at_idx').on(table.teamId, table.status, table.createdAt),
  ],
);

export const importRows = pgTable(
  'import_rows',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    importBatchId: integer('import_batch_id').notNull().references(() => importBatches.id),
    rowNumber: integer('row_number').notNull(),
    rawValues: text('raw_values').notNull(),
    normalizedValues: text('normalized_values'),
    errors: text('errors').notNull().default('[]'),
    status: importRowStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('import_rows_row_number_positive', sql`${table.rowNumber} > 0`),
    uniqueIndex('import_rows_batch_row_number_unique').on(table.importBatchId, table.rowNumber),
    index('import_rows_team_batch_status_idx').on(table.teamId, table.importBatchId, table.status),
  ],
);

export const creativeReferences = pgTable(
  'creative_references',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    uploadedBy: integer('uploaded_by').notNull().references(() => users.id),
    catalogItemId: integer('catalog_item_id').references(() => catalogItems.id),
    sourceId: varchar('source_id', { length: 160 }).notNull(),
    objectKey: text('object_key').notNull(),
    sourceUrl: text('source_url'),
    rights: creativeReferenceRights('rights').notNull(),
    mode: creativeReferenceMode('mode').notNull(),
    contentType: varchar('content_type', { length: 100 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    durationSeconds: numeric('duration_seconds', { precision: 10, scale: 3 }),
    ratio: varchar('ratio', { length: 10 }),
    videoCodec: varchar('video_codec', { length: 50 }),
    audioCodec: varchar('audio_codec', { length: 50 }),
    hasAudioTrack: boolean('has_audio_track'),
    readabilityStatus: varchar('readability_status', { length: 30 }).notNull().default('pending'),
    readabilityError: text('readability_error'),
    status: varchar('status', { length: 30 }).notNull().default('uploaded'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('creative_references_byte_size_positive', sql`${table.byteSize} > 0`),
    uniqueIndex('creative_references_team_source_id_unique').on(table.teamId, table.sourceId),
    index('creative_references_team_catalog_item_idx').on(table.teamId, table.catalogItemId),
  ],
);

export const referenceAnalyses = pgTable(
  'reference_analyses',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    creativeReferenceId: integer('creative_reference_id').notNull().references(() => creativeReferences.id),
    version: varchar('version', { length: 30 }).notNull(),
    status: referenceAnalysisStatus('status').notNull().default('draft'),
    analysisSnapshot: text('analysis_snapshot').notNull(),
    model: varchar('model', { length: 80 }).notNull().default('heuristic-v1'),
    promptVersion: varchar('prompt_version', { length: 30 }),
    analysisHash: varchar('analysis_hash', { length: 64 }),
    borrowedStructure: text('borrowed_structure').notNull().default('[]'),
    excludedContent: text('excluded_content').notNull().default('[]'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reference_analyses_reference_version_unique').on(table.creativeReferenceId, table.version),
    index('reference_analyses_team_status_created_at_idx').on(table.teamId, table.status, table.createdAt),
  ],
);

export const referenceBenchmarks = pgTable(
  'reference_benchmarks',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    creativeReferenceId: integer('creative_reference_id').notNull().references(() => creativeReferences.id),
    createdBy: integer('created_by').notNull().references(() => users.id),
    provider: varchar('provider', { length: 50 }).notNull().default('minimax'),
    model: varchar('model', { length: 80 }).notNull().default('h3'),
    status: varchar('status', { length: 30 }).notNull().default('recorded'),
    costCny: numeric('cost_cny', { precision: 12, scale: 2 }),
    continuityScore: numeric('continuity_score', { precision: 5, scale: 4 }),
    productAccuracyScore: numeric('product_accuracy_score', { precision: 5, scale: 4 }),
    notes: text('notes'),
    productionEnabled: boolean('production_enabled').notNull().default(false),
    outperformsStructure: boolean('outperforms_structure').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('reference_benchmarks_cost_nonnegative', sql`${table.costCny} IS NULL OR ${table.costCny} >= 0`),
    check('reference_benchmarks_continuity_range', sql`${table.continuityScore} IS NULL OR (${table.continuityScore} BETWEEN 0 AND 1)`),
    check('reference_benchmarks_product_accuracy_range', sql`${table.productAccuracyScore} IS NULL OR (${table.productAccuracyScore} BETWEEN 0 AND 1)`),
    uniqueIndex('reference_benchmarks_team_reference_unique').on(table.teamId, table.creativeReferenceId),
    index('reference_benchmarks_team_created_at_idx').on(table.teamId, table.createdAt),
  ],
);

export const productionBatches = pgTable(
  'production_batches',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    createdBy: integer('created_by').notNull().references(() => users.id),
    name: varchar('name', { length: 160 }).notNull(),
    status: productionBatchStatus('status').notNull().default('draft'),
    generationMode: productionGenerationMode('generation_mode').notNull(),
    sourceMode: productionSourceMode('source_mode').notNull().default('catalog'),
    sharedPrompt: text('shared_prompt').notNull().default(''),
    sharedPromptVersion: integer('shared_prompt_version').notNull().default(1),
    defaultBrandKitId: integer('default_brand_kit_id').references(() => brandKits.id),
    defaultCreativeReferenceId: integer('default_creative_reference_id').references(() => creativeReferences.id),
    targetPlatform: varchar('target_platform', { length: 50 }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    campaignGoal: text('campaign_goal').notNull(),
    waveSize: integer('wave_size').notNull().default(10),
    stopLossConfig: text('stop_loss_config').notNull().default('{}'),
    specHash: varchar('spec_hash', { length: 64 }),
    maxEstimatedCostCny: numeric('max_estimated_cost_cny', { precision: 12, scale: 2 }),
    costConfirmation: text('cost_confirmation'),
    costConfirmedAt: timestamp('cost_confirmed_at'),
    skillVersionLock: text('skill_version_lock').notNull().default('{}'),
    pausedReason: text('paused_reason'),
    pausedFromStatus: productionBatchStatus('paused_from_status'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('production_batches_duration_seconds_valid', sql`${table.durationSeconds} BETWEEN 4 AND 15`),
    check('production_batches_wave_size_positive', sql`${table.waveSize} > 0`),
    check('production_batches_shared_prompt_version_positive', sql`${table.sharedPromptVersion} > 0`),
    uniqueIndex('production_batches_team_name_unique').on(table.teamId, table.name),
    index('production_batches_team_status_created_at_idx').on(table.teamId, table.status, table.createdAt),
    uniqueIndex('production_batches_id_team_unique').on(table.id, table.teamId),
  ],
);

export const creativeSpecVersions = pgTable(
  'creative_spec_versions',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    campaignId: integer('campaign_id').notNull().references(() => campaigns.id),
    referenceAnalysisId: integer('reference_analysis_id').references(() => referenceAnalyses.id),
    parentVersionId: integer('parent_version_id'),
    createdBy: integer('created_by').notNull().references(() => users.id),
    approvedBy: integer('approved_by').references(() => users.id),
    version: varchar('version', { length: 30 }).notNull(),
    status: creativeSpecStatus('status').notNull().default('draft'),
    specHash: varchar('spec_hash', { length: 64 }).notNull(),
    specSnapshot: text('spec_snapshot').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    approvedAt: timestamp('approved_at'),
    rejectionCode: varchar('rejection_code', { length: 50 }),
    rejectionNote: text('rejection_note'),
  },
  (table) => [
    uniqueIndex('creative_spec_versions_campaign_version_unique').on(table.campaignId, table.version),
    index('creative_spec_versions_team_status_created_at_idx').on(table.teamId, table.status, table.createdAt),
  ],
);

export const productionBatchItems = pgTable(
  'production_batch_items',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id),
    productionBatchId: integer('production_batch_id').notNull().references(() => productionBatches.id),
    catalogItemId: integer('catalog_item_id').references(() => catalogItems.id),
    inputAssetId: integer('input_asset_id').references(() => assets.id),
    sequence: integer('sequence').notNull().default(1),
    promptMode: productionPromptMode('prompt_mode').notNull().default('inherit'),
    promptOverride: text('prompt_override'),
    campaignId: integer('campaign_id').references(() => campaigns.id),
    creativeReferenceId: integer('creative_reference_id').references(() => creativeReferences.id),
    creativeSpecVersionId: integer('creative_spec_version_id').references(() => creativeSpecVersions.id),
    status: productionBatchItemStatus('status').notNull().default('pending'),
    isPilot: boolean('is_pilot').notNull().default(false),
    waveNumber: integer('wave_number').notNull().default(0),
    resultSummary: text('result_summary').notNull().default('{}'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('production_batch_items_wave_number_nonnegative', sql`${table.waveNumber} >= 0`),
    check('production_batch_items_sequence_positive', sql`${table.sequence} > 0`),
    check(
      'production_batch_items_source_shape',
      sql`(${table.catalogItemId} IS NOT NULL AND ${table.inputAssetId} IS NULL)
        OR (${table.catalogItemId} IS NULL AND ${table.inputAssetId} IS NOT NULL)`,
    ),
    check(
      'production_batch_items_prompt_shape',
      sql`(${table.promptMode} = 'inherit' AND ${table.promptOverride} IS NULL)
        OR (${table.promptMode} = 'override' AND length(trim(${table.promptOverride})) > 0)`,
    ),
    foreignKey({
      columns: [table.inputAssetId, table.teamId],
      foreignColumns: [assets.id, assets.teamId],
      name: 'production_batch_items_input_asset_team_fk',
    }),
    uniqueIndex('production_batch_items_batch_catalog_unique')
      .on(table.productionBatchId, table.catalogItemId)
      .where(sql`${table.catalogItemId} IS NOT NULL`),
    uniqueIndex('production_batch_items_batch_input_asset_unique')
      .on(table.productionBatchId, table.inputAssetId)
      .where(sql`${table.inputAssetId} IS NOT NULL`),
    uniqueIndex('production_batch_items_batch_sequence_unique').on(table.productionBatchId, table.sequence),
    uniqueIndex('production_batch_items_id_team_unique').on(table.id, table.teamId),
    index('production_batch_items_team_status_wave_idx').on(table.teamId, table.status, table.waveNumber),
  ],
);

export const teamsRelations = relations(teams, ({ many }) => ({
  teamMembers: many(teamMembers),
  activityLogs: many(activityLogs),
  invitations: many(invitations),
  brandKits: many(brandKits),
  assets: many(assets),
  assetUploads: many(assetUploads),
  campaigns: many(campaigns),
  shotCards: many(shotCards),
  videoJobs: many(videoJobs),
  reviews: many(reviews),
  catalogItems: many(catalogItems),
  catalogItemAssets: many(catalogItemAssets),
  importBatches: many(importBatches),
  importRows: many(importRows),
  creativeReferences: many(creativeReferences),
  referenceAnalyses: many(referenceAnalyses),
  referenceBenchmarks: many(referenceBenchmarks),
  productionBatches: many(productionBatches),
  productionBatchItems: many(productionBatchItems),
  creativeSpecVersions: many(creativeSpecVersions),
}));

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
  invitationsSent: many(invitations),
  brandKitsCreated: many(brandKits),
  assetsUploaded: many(assets),
  assetUploadsCreated: many(assetUploads),
  campaignsCreated: many(campaigns),
  videoJobsSubmitted: many(videoJobs),
  reviews: many(reviews),
  catalogItemsCreated: many(catalogItems),
  importBatchesUploaded: many(importBatches),
  creativeReferencesUploaded: many(creativeReferences),
  referenceBenchmarksCreated: many(referenceBenchmarks),
  productionBatchesCreated: many(productionBatches),
  creativeSpecVersionsCreated: many(creativeSpecVersions, {
    relationName: 'creativeSpecCreatedBy',
  }),
  creativeSpecVersionsApproved: many(creativeSpecVersions, {
    relationName: 'creativeSpecApprovedBy',
  }),
}));


export const invitationsRelations = relations(invitations, ({ one }) => ({
  team: one(teams, {
    fields: [invitations.teamId],
    references: [teams.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  team: one(teams, {
    fields: [activityLogs.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export const brandKitsRelations = relations(brandKits, ({ many, one }) => ({
  team: one(teams, {
    fields: [brandKits.teamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [brandKits.createdBy],
    references: [users.id],
  }),
  campaigns: many(campaigns),
  catalogItems: many(catalogItems),
  productionBatches: many(productionBatches),
}));

export const assetsRelations = relations(assets, ({ many, one }) => ({
  team: one(teams, {
    fields: [assets.teamId],
    references: [teams.id],
  }),
  uploadedBy: one(users, {
    fields: [assets.uploadedBy],
    references: [users.id],
  }),
  outputForJobs: many(videoJobs),
  productForCampaigns: many(campaigns),
  primaryForCatalogItems: many(catalogItems),
  catalogItemAssets: many(catalogItemAssets),
  uploads: many(assetUploads),
}));

export const assetUploadsRelations = relations(assetUploads, ({ one }) => ({
  team: one(teams, {
    fields: [assetUploads.teamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [assetUploads.createdBy],
    references: [users.id],
  }),
  asset: one(assets, {
    fields: [assetUploads.assetId],
    references: [assets.id],
  }),
}));


export const campaignsRelations = relations(campaigns, ({ many, one }) => ({
  team: one(teams, {
    fields: [campaigns.teamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [campaigns.createdBy],
    references: [users.id],
  }),
  brandKit: one(brandKits, {
    fields: [campaigns.brandKitId],
    references: [brandKits.id],
  }),
  productAsset: one(assets, {
    fields: [campaigns.productAssetId],
    references: [assets.id],
  }),
  shotCards: many(shotCards),
  videoJobs: many(videoJobs),
  creativeSpecVersions: many(creativeSpecVersions),
  productionBatchItems: many(productionBatchItems),
}));

export const shotCardsRelations = relations(shotCards, ({ many, one }) => ({
  team: one(teams, {
    fields: [shotCards.teamId],
    references: [teams.id],
  }),
  campaign: one(campaigns, {
    fields: [shotCards.campaignId],
    references: [campaigns.id],
  }),
  videoJobs: many(videoJobs),
}));

export const shotSkillsRelations = relations(shotSkills, ({ many, one }) => ({
  ownerTeam: one(teams, {
    fields: [shotSkills.ownerTeamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [shotSkills.createdBy],
    references: [users.id],
  }),
  versions: many(shotSkillVersions),
}));

export const shotSkillVersionsRelations = relations(shotSkillVersions, ({ many, one }) => ({
  shotSkill: one(shotSkills, {
    fields: [shotSkillVersions.shotSkillId],
    references: [shotSkills.id],
  }),
  parentVersion: one(shotSkillVersions, {
    fields: [shotSkillVersions.parentVersionId],
    references: [shotSkillVersions.id],
    relationName: 'shotSkillVersionParent',
  }),
  childVersions: many(shotSkillVersions, {
    relationName: 'shotSkillVersionParent',
  }),
  createdBy: one(users, {
    fields: [shotSkillVersions.createdBy],
    references: [users.id],
  }),
  videoJobs: many(videoJobs),
  releaseValidations: many(shotSkillReleaseValidations),
}));

export const shotSkillReleaseValidationsRelations = relations(shotSkillReleaseValidations, ({ one }) => ({
  team: one(teams, {
    fields: [shotSkillReleaseValidations.teamId],
    references: [teams.id],
  }),
  shotSkillVersion: one(shotSkillVersions, {
    fields: [shotSkillReleaseValidations.shotSkillVersionId],
    references: [shotSkillVersions.id],
  }),
  createdBy: one(users, {
    fields: [shotSkillReleaseValidations.createdBy],
    references: [users.id],
  }),
}));

export const videoJobsRelations = relations(videoJobs, ({ one }) => ({
  team: one(teams, {
    fields: [videoJobs.teamId],
    references: [teams.id],
  }),
  productionBatchItem: one(productionBatchItems, {
    fields: [videoJobs.productionBatchItemId],
    references: [productionBatchItems.id],
  }),
  inputAsset: one(assets, {
    fields: [videoJobs.inputAssetId],
    references: [assets.id],
  }),
  campaign: one(campaigns, {
    fields: [videoJobs.campaignId],
    references: [campaigns.id],
  }),
  shotCard: one(shotCards, {
    fields: [videoJobs.shotCardId],
    references: [shotCards.id],
  }),
  submittedBy: one(users, {
    fields: [videoJobs.submittedBy],
    references: [users.id],
  }),
  outputAsset: one(assets, {
    fields: [videoJobs.outputAssetId],
    references: [assets.id],
  }),
  creativeSpecVersion: one(creativeSpecVersions, {
    fields: [videoJobs.creativeSpecVersionId],
    references: [creativeSpecVersions.id],
  }),
  shotSkillVersion: one(shotSkillVersions, {
    fields: [videoJobs.shotSkillVersionId],
    references: [shotSkillVersions.id],
  }),
  review: one(reviews),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  team: one(teams, {
    fields: [reviews.teamId],
    references: [teams.id],
  }),
  videoJob: one(videoJobs, {
    fields: [reviews.videoJobId],
    references: [videoJobs.id],
  }),
  reviewer: one(users, {
    fields: [reviews.reviewerId],
    references: [users.id],
  }),
}));

export const catalogItemsRelations = relations(catalogItems, ({ many, one }) => ({
  team: one(teams, {
    fields: [catalogItems.teamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [catalogItems.createdBy],
    references: [users.id],
  }),
  brandKit: one(brandKits, {
    fields: [catalogItems.brandKitId],
    references: [brandKits.id],
  }),
  primaryAsset: one(assets, {
    fields: [catalogItems.primaryAssetId],
    references: [assets.id],
  }),
  assets: many(catalogItemAssets),
  creativeReferences: many(creativeReferences),
  productionBatchItems: many(productionBatchItems),
}));

export const catalogItemAssetsRelations = relations(catalogItemAssets, ({ one }) => ({
  team: one(teams, {
    fields: [catalogItemAssets.teamId],
    references: [teams.id],
  }),
  catalogItem: one(catalogItems, {
    fields: [catalogItemAssets.catalogItemId],
    references: [catalogItems.id],
  }),
  asset: one(assets, {
    fields: [catalogItemAssets.assetId],
    references: [assets.id],
  }),
}));

export const importBatchesRelations = relations(importBatches, ({ many, one }) => ({
  team: one(teams, {
    fields: [importBatches.teamId],
    references: [teams.id],
  }),
  uploadedBy: one(users, {
    fields: [importBatches.uploadedBy],
    references: [users.id],
  }),
  rows: many(importRows),
}));

export const importRowsRelations = relations(importRows, ({ one }) => ({
  team: one(teams, {
    fields: [importRows.teamId],
    references: [teams.id],
  }),
  importBatch: one(importBatches, {
    fields: [importRows.importBatchId],
    references: [importBatches.id],
  }),
}));

export const creativeReferencesRelations = relations(
  creativeReferences,
  ({ many, one }) => ({
    team: one(teams, {
      fields: [creativeReferences.teamId],
      references: [teams.id],
    }),
    uploadedBy: one(users, {
      fields: [creativeReferences.uploadedBy],
      references: [users.id],
    }),
    catalogItem: one(catalogItems, {
      fields: [creativeReferences.catalogItemId],
      references: [catalogItems.id],
    }),
    benchmarks: many(referenceBenchmarks),
    productionBatches: many(productionBatches),
    productionBatchItems: many(productionBatchItems),
    analyses: many(referenceAnalyses),
  }),
);

export const referenceAnalysesRelations = relations(referenceAnalyses, ({ many, one }) => ({
  team: one(teams, {
    fields: [referenceAnalyses.teamId],
    references: [teams.id],
  }),
  creativeReference: one(creativeReferences, {
    fields: [referenceAnalyses.creativeReferenceId],
    references: [creativeReferences.id],
  }),
  creativeSpecVersions: many(creativeSpecVersions),
}));

export const referenceBenchmarksRelations = relations(referenceBenchmarks, ({ one }) => ({
  team: one(teams, {
    fields: [referenceBenchmarks.teamId],
    references: [teams.id],
  }),
  creativeReference: one(creativeReferences, {
    fields: [referenceBenchmarks.creativeReferenceId],
    references: [creativeReferences.id],
  }),
  createdBy: one(users, {
    fields: [referenceBenchmarks.createdBy],
    references: [users.id],
  }),
}));

export const productionBatchesRelations = relations(productionBatches, ({ many, one }) => ({
  team: one(teams, {
    fields: [productionBatches.teamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [productionBatches.createdBy],
    references: [users.id],
  }),
  defaultBrandKit: one(brandKits, {
    fields: [productionBatches.defaultBrandKitId],
    references: [brandKits.id],
  }),
  defaultCreativeReference: one(creativeReferences, {
    fields: [productionBatches.defaultCreativeReferenceId],
    references: [creativeReferences.id],
  }),
  items: many(productionBatchItems),
}));

export const creativeSpecVersionsRelations = relations(
  creativeSpecVersions,
  ({ many, one }) => ({
    team: one(teams, {
      fields: [creativeSpecVersions.teamId],
      references: [teams.id],
    }),
    campaign: one(campaigns, {
      fields: [creativeSpecVersions.campaignId],
      references: [campaigns.id],
    }),
    referenceAnalysis: one(referenceAnalyses, {
      fields: [creativeSpecVersions.referenceAnalysisId],
      references: [referenceAnalyses.id],
    }),
    createdBy: one(users, {
      fields: [creativeSpecVersions.createdBy],
      references: [users.id],
      relationName: 'creativeSpecCreatedBy',
    }),
    approvedBy: one(users, {
      fields: [creativeSpecVersions.approvedBy],
      references: [users.id],
      relationName: 'creativeSpecApprovedBy',
    }),
    parentVersion: one(creativeSpecVersions, {
      fields: [creativeSpecVersions.parentVersionId],
      references: [creativeSpecVersions.id],
      relationName: 'creativeSpecParent',
    }),
    childVersions: many(creativeSpecVersions, {
      relationName: 'creativeSpecParent',
    }),
    productionBatchItems: many(productionBatchItems),
    videoJobs: many(videoJobs),
  }),
);

export const productionBatchItemsRelations = relations(
  productionBatchItems,
  ({ many, one }) => ({
    team: one(teams, {
      fields: [productionBatchItems.teamId],
      references: [teams.id],
    }),
    productionBatch: one(productionBatches, {
      fields: [productionBatchItems.productionBatchId],
      references: [productionBatches.id],
    }),
    catalogItem: one(catalogItems, {
      fields: [productionBatchItems.catalogItemId],
      references: [catalogItems.id],
    }),
    inputAsset: one(assets, {
      fields: [productionBatchItems.inputAssetId],
      references: [assets.id],
    }),
    videoJobs: many(videoJobs),
    campaign: one(campaigns, {
      fields: [productionBatchItems.campaignId],
      references: [campaigns.id],
    }),
    creativeReference: one(creativeReferences, {
      fields: [productionBatchItems.creativeReferenceId],
      references: [creativeReferences.id],
    }),
    creativeSpecVersion: one(creativeSpecVersions, {
      fields: [productionBatchItems.creativeSpecVersionId],
      references: [creativeSpecVersions.id],
    }),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type BrandKit = typeof brandKits.$inferSelect;
export type NewBrandKit = typeof brandKits.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type AssetUpload = typeof assetUploads.$inferSelect;
export type NewAssetUpload = typeof assetUploads.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type ShotCard = typeof shotCards.$inferSelect;
export type NewShotCard = typeof shotCards.$inferInsert;
export type ShotSkill = typeof shotSkills.$inferSelect;
export type NewShotSkill = typeof shotSkills.$inferInsert;
export type ShotSkillVersion = typeof shotSkillVersions.$inferSelect;
export type NewShotSkillVersion = typeof shotSkillVersions.$inferInsert;
export type ShotSkillReleaseValidation = typeof shotSkillReleaseValidations.$inferSelect;
export type NewShotSkillReleaseValidation = typeof shotSkillReleaseValidations.$inferInsert;
export type VideoJob = typeof videoJobs.$inferSelect;
export type NewVideoJob = typeof videoJobs.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type ShotSkillValidationEvidence = typeof shotSkillValidationEvidence.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type NewCatalogItem = typeof catalogItems.$inferInsert;
export type CatalogItemAsset = typeof catalogItemAssets.$inferSelect;
export type NewCatalogItemAsset = typeof catalogItemAssets.$inferInsert;
export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
export type ImportRow = typeof importRows.$inferSelect;
export type NewImportRow = typeof importRows.$inferInsert;
export type CreativeReference = typeof creativeReferences.$inferSelect;
export type NewCreativeReference = typeof creativeReferences.$inferInsert;
export type ReferenceAnalysis = typeof referenceAnalyses.$inferSelect;
export type NewReferenceAnalysis = typeof referenceAnalyses.$inferInsert;
export type ReferenceBenchmark = typeof referenceBenchmarks.$inferSelect;
export type NewReferenceBenchmark = typeof referenceBenchmarks.$inferInsert;
export type ProductionBatch = typeof productionBatches.$inferSelect;
export type NewProductionBatch = typeof productionBatches.$inferInsert;
export type ProductionBatchItem = typeof productionBatchItems.$inferSelect;
export type NewProductionBatchItem = typeof productionBatchItems.$inferInsert;
export type CreativeSpecVersion = typeof creativeSpecVersions.$inferSelect;
export type NewCreativeSpecVersion = typeof creativeSpecVersions.$inferInsert;
export type TeamDataWithMembers = Team & {
  teamMembers: (TeamMember & {
    user: Pick<User, 'id' | 'name' | 'email'>;
  })[];
};

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_TEAM = 'CREATE_TEAM',
  REMOVE_TEAM_MEMBER = 'REMOVE_TEAM_MEMBER',
  INVITE_TEAM_MEMBER = 'INVITE_TEAM_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
  CREATE_BRAND_KIT = 'CREATE_BRAND_KIT',
  UPDATE_BRAND_KIT = 'UPDATE_BRAND_KIT',
  UPLOAD_PRODUCT_ASSET = 'UPLOAD_PRODUCT_ASSET',
  CREATE_CAMPAIGN = 'CREATE_CAMPAIGN',
  SELECT_SHOT_CARD = 'SELECT_SHOT_CARD',
  SUBMIT_VIDEO_JOB = 'SUBMIT_VIDEO_JOB',
  IMPORT_CSV = 'IMPORT_CSV',
  COMMIT_CSV_IMPORT = 'COMMIT_CSV_IMPORT',
  CREATE_CATALOG_ITEM = 'CREATE_CATALOG_ITEM',
  UPDATE_CATALOG_ITEM = 'UPDATE_CATALOG_ITEM',
  COPY_CATALOG_ITEM = 'COPY_CATALOG_ITEM',
  APPROVE_CREATIVE_SPEC = 'APPROVE_CREATIVE_SPEC',
  CREATE_PRODUCTION_BATCH = 'CREATE_PRODUCTION_BATCH',
  UPDATE_PRODUCTION_BATCH_PROMPT = 'UPDATE_PRODUCTION_BATCH_PROMPT',
  ESTIMATE_BATCH_COST = 'ESTIMATE_BATCH_COST',
  CONFIRM_BATCH_COST = 'CONFIRM_BATCH_COST',
  SELECT_BATCH_PILOTS = 'SELECT_BATCH_PILOTS',
  SCHEDULE_BATCH_WAVE = 'SCHEDULE_BATCH_WAVE',
  PAUSE_PRODUCTION_BATCH = 'PAUSE_PRODUCTION_BATCH',
  RESUME_PRODUCTION_BATCH = 'RESUME_PRODUCTION_BATCH',
  CANCEL_PRODUCTION_BATCH = 'CANCEL_PRODUCTION_BATCH',
  COMPLETE_PRODUCTION_BATCH = 'COMPLETE_PRODUCTION_BATCH',
  EXPORT_PRODUCTION_BATCH = 'EXPORT_PRODUCTION_BATCH',
  EXPORT_ADOPTED_VIDEO = 'EXPORT_ADOPTED_VIDEO',
  BIND_PRODUCTION_BATCH_SPEC = 'BIND_PRODUCTION_BATCH_SPEC',
  RELEASE_BULK_PILOT = 'RELEASE_BULK_PILOT',
  QUALITY_GATE_RECORDED = 'QUALITY_GATE_RECORDED',
  CREATE_REMEDIATION = 'CREATE_REMEDIATION',
  VIDEO_JOB_SUCCEEDED = 'VIDEO_JOB_SUCCEEDED',
  VIDEO_JOB_FAILED = 'VIDEO_JOB_FAILED',
  RETRY_VIDEO_JOB = 'RETRY_VIDEO_JOB',
  ADOPT_VIDEO = 'ADOPT_VIDEO',
  REJECT_VIDEO = 'REJECT_VIDEO',
  IMPORT_SHOT_SKILL = 'IMPORT_SHOT_SKILL',
}
