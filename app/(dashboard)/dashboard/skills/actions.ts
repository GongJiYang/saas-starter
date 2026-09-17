'use server';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  activateShotSkillVersion,
  createPrivateShotSkillDraft,
  createShotSkillDraftFromVersion,
  getActiveShotSkillVersionForTeam,
  hashStable,
  previewShotSkillFixture,
  recordShotSkillReleaseValidation,
  submitShotSkillVersionForTesting,
  updatePrivateShotSkillDraft,
  type ShotSkillFixturePreview,
} from '@/lib/shot-skills';
import {
  shotSkillContextSchema,
  shotSkillEditorFormSchema,
  shotSkillEditorFormToCard,
  type ShotSkillCard,
} from '@/lib/shot-skills/schema';
import {
  isShotSkillImportValidationError,
  previewShotSkillImport,
  validateShotSkillImportFileBoundary,
  SHOT_SKILL_JSON_MAX_BYTES,
} from '@/lib/shot-skills/io';
import {
  importPrivateShotSkillDraft,
  previewPrivateShotSkillImportTarget,
  ShotSkillImportBusinessError,
  type ShotSkillImportTargetPreview,
} from '@/lib/shot-skills/import-persistence';
import { requireWorkspace } from '@/lib/workspace/access';

export type SkillEditorFieldError = { code: string; path: string; message: string };
export type SkillEditorActionState = {
  error?: string;
  errors?: SkillEditorFieldError[];
  success?: string;
  revision?: number;
};

export type SkillFixturePreviewActionState = {
  errors?: SkillEditorFieldError[];
  preview?: ShotSkillFixturePreview;
};

export type SkillImportError = { code: string; path: string; message: string };
export type SkillImportActionState = {
  error?: SkillImportError;
  preview?: {
    token: string;
    teamName: string;
    fileName: string;
    fileHash: string;
    bytes: number;
    extensions: string[];
    definition: {
      id: string;
      version: string;
      name: string;
      specVersion: string;
    };
    target: ShotSkillImportTargetPreview;
  };
};

const IMPORT_PREVIEW_TOKEN_TYPE = 'shot-skill-import-preview+jwt';
const MAX_IMPORT_BASE64_LENGTH = Math.ceil(SHOT_SKILL_JSON_MAX_BYTES / 3) * 4;
const MAX_IMPORT_PREVIEW_TOKEN_LENGTH = Math.ceil(MAX_IMPORT_BASE64_LENGTH * 4 / 3) + 8_192;
const importPreviewTokenSchema = z.object({
  purpose: z.literal('shot_skill_import_preview'),
  teamId: z.number().int().positive(),
  userId: z.number().int().positive(),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  targetHash: z.string().regex(/^[a-f0-9]{64}$/),
  bytesBase64: z.string()
    .min(1)
    .max(MAX_IMPORT_BASE64_LENGTH)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).strict();
const importPreviewSecret = process.env.AUTH_SECRET;
if (!importPreviewSecret) throw new Error('AUTH_SECRET environment variable is not set');
const importPreviewTokenKey = createHash('sha256')
  .update('shot-skill-import-preview\0')
  .update(importPreviewSecret)
  .digest();

function importErrorState(error: unknown): SkillImportActionState {
  if (isShotSkillImportValidationError(error) || error instanceof ShotSkillImportBusinessError) {
    return { error: error.toIssue() };
  }
  return {
    error: {
      code: 'SKILL_IMPORT_UNEXPECTED',
      path: '$',
      message: 'Shot Skill import could not be processed.',
    },
  };
}

function importForbiddenState(): SkillImportActionState {
  return {
    error: {
      code: 'SKILL_IMPORT_FORBIDDEN',
      path: '$team.role',
      message: 'Only workspace owners can import private Shot Skills.',
    },
  };
}

async function requireOwnerWorkspace() {
  const workspace = await requireWorkspace();
  if (workspace.role !== 'owner') throw new Error('Only workspace owners can manage private Shot Skills.');
  return workspace;
}

function issueErrors(error: z.ZodError, prefix = ''): SkillEditorFieldError[] {
  return error.issues.map((issue) => ({
    code: issue.code === z.ZodIssueCode.custom ? 'invalid_contract' : issue.code,
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.') || 'definition',
    message: issue.message,
  }));
}

function errorState(errors: SkillEditorFieldError[]): SkillEditorActionState {
  const first = errors[0] ?? { code: 'invalid_contract', path: 'definition', message: 'Invalid Skill definition.' };
  return { error: `${first.path}: ${first.message}`, errors };
}

function blankDefinition(stableId: string, name: string): ShotSkillCard {
  return shotSkillEditorFormToCard({
    spec: 'shot_skill_card',
    specVersion: '1.0',
    id: stableId,
    version: '1.0.0',
    name,
    description: 'Describe the repeatable production method.',
    tags: ['workspace-private'],
    goal: 'Present one supplied product with controlled, brand-safe movement.',
    eligibility: {
      all: [
        { field: 'shotRole', in: ['hook'] },
        { field: 'primaryImageAvailable', equals: true },
      ],
      any: [],
      none: [],
    },
    requiredInputs: [{
      type: 'primary_product_image',
      minimumCount: 1,
      maximumCount: 1,
      authorization: 'licensed',
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      blocking: true,
    }],
    camera: {
      shotSize: 'Medium close-up.',
      composition: 'Keep one supplied product centered and legible.',
      movement: 'Use one restrained continuous movement.',
      focus: 'Keep focus on the supplied product.',
      lighting: 'Use controlled studio light and preserve product color.',
    },
    timeline: [
      { fromRatio: 0, toRatio: 0.3, action: 'Hold the supplied product identity clearly.' },
      { fromRatio: 0.3, toRatio: 0.8, action: 'Use one controlled continuous movement.' },
      { fromRatio: 0.8, toRatio: 1, action: 'Finish on one recognizable product frame.' },
    ],
    invariants: [
      { code: 'single_product', description: 'Show exactly one supplied product.' },
      { code: 'product_recognizable', description: 'Keep the product recognizable.' },
    ],
    forbidden: [
      { code: 'additional_products', description: 'Do not add products.' },
      { code: 'generated_readable_text', description: 'Do not generate readable packaging text.' },
    ],
    qualityChecks: [
      { code: 'single_product', severity: 'blocking' },
      { code: 'product_shape_preserved', severity: 'blocking' },
    ],
    provider: {
      id: 'minimax-h3',
      ratio: '9:16',
      resolution: '768P',
      durationSeconds: [4, 5],
      promptTemplateVersion: '1',
    },
    provenance: { creator: 'workspace', source: 'structured_editor' },
    extensions: {},
  });
}

export async function createShotSkillDraftAction(formData: FormData) {
  const workspace = await requireOwnerWorkspace();
  const parsed = z.object({
    stableId: z.string().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(160),
  }).safeParse({ stableId: formData.get('stableId'), name: formData.get('name') });
  if (!parsed.success) redirect('/dashboard/skills/new?error=Use+a+lowercase+slug+and+a+name.');
  const created = await createPrivateShotSkillDraft({
    teamId: workspace.team.id,
    userId: workspace.user.id,
    definition: blankDefinition(parsed.data.stableId, parsed.data.name),
  });
  redirect(`/dashboard/skills/${created.skill.id}/edit/${created.version.id}`);
}

export async function saveShotSkillDraftAction(
  _previous: SkillEditorActionState,
  formData: FormData,
): Promise<SkillEditorActionState> {
  const workspace = await requireOwnerWorkspace();
  const input = z.object({
    versionId: z.coerce.number().int().positive(),
    expectedRevision: z.coerce.number().int().positive(),
    definition: z.string().min(1),
  }).safeParse({
    versionId: formData.get('versionId'),
    expectedRevision: formData.get('expectedRevision'),
    definition: formData.get('definition'),
  });
  if (!input.success) return errorState(issueErrors(input.error));
  let raw: unknown;
  try {
    raw = JSON.parse(input.data.definition);
  } catch {
    return errorState([{ code: 'invalid_json', path: 'definition', message: 'Invalid serialized form data.' }]);
  }
  const form = shotSkillEditorFormSchema.safeParse(raw);
  if (!form.success) return errorState(issueErrors(form.error, 'definition'));
  const definition = shotSkillEditorFormToCard(form.data);
  try {
    const updated = await updatePrivateShotSkillDraft({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      versionId: input.data.versionId,
      expectedRevision: input.data.expectedRevision,
      definition,
    });
    revalidatePath('/dashboard/skills');
    revalidatePath(`/dashboard/skills/${updated.skill.id}`);
    return { success: 'Draft saved.', revision: updated.version.revision };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save Skill draft.';
    if (message === 'Shot Skill draft was changed by another editor. Refresh before saving.') {
      return errorState([{ code: 'revision_conflict', path: 'revision', message }]);
    }
    const separator = message.indexOf(':');
    const path = separator > 0 ? message.slice(0, separator) : 'definition';
    return errorState([{ code: 'draft_save_rejected', path, message: separator > 0 ? message.slice(separator + 1).trim() : message }]);
  }
}

export async function previewShotSkillDraftAction(
  _previous: SkillFixturePreviewActionState,
  formData: FormData,
): Promise<SkillFixturePreviewActionState> {
  const workspace = await requireOwnerWorkspace();
  const input = z.object({
    definition: z.string().min(1),
    fixture: z.string().min(1),
  }).safeParse({
    definition: formData.get('definition'),
    fixture: formData.get('fixture'),
  });
  if (!input.success) return { errors: issueErrors(input.error, 'preview') };
  let definitionJson: unknown;
  let fixtureJson: unknown;
  try {
    definitionJson = JSON.parse(input.data.definition);
  } catch {
    return { errors: [{ code: 'invalid_json', path: 'definition', message: 'Invalid serialized Skill definition.' }] };
  }
  try {
    fixtureJson = JSON.parse(input.data.fixture);
  } catch {
    return { errors: [{ code: 'invalid_json', path: 'fixture', message: 'Invalid serialized Fixture.' }] };
  }
  const definition = shotSkillEditorFormSchema.safeParse(definitionJson);
  if (!definition.success) return { errors: issueErrors(definition.error, 'definition') };
  const fixture = shotSkillContextSchema.safeParse(fixtureJson);
  if (!fixture.success) return { errors: issueErrors(fixture.error, 'fixture') };
  const fallback = definition.data.fallbackSkillId
    ? await getActiveShotSkillVersionForTeam({
      teamId: workspace.team.id,
      stableId: definition.data.fallbackSkillId,
    })
    : null;
  return {
    preview: previewShotSkillFixture({
      fixture: fixture.data,
      skill: shotSkillEditorFormToCard(definition.data),
      fallback: fallback?.definition,
    }),
  };
}

export async function submitShotSkillForTestingAction(
  _previous: SkillEditorActionState,
  formData: FormData,
): Promise<SkillEditorActionState> {
  const workspace = await requireOwnerWorkspace();
  const versionId = z.coerce.number().int().positive().safeParse(formData.get('versionId'));
  if (!versionId.success) {
    return errorState([{ code: 'invalid_version_id', path: 'versionId', message: 'Invalid Skill version.' }]);
  }
  try {
    const updated = await submitShotSkillVersionForTesting({ teamId: workspace.team.id, userId: workspace.user.id, versionId: versionId.data });
    revalidatePath('/dashboard/skills');
    revalidatePath(`/dashboard/skills/${updated.skill.id}`);
    return { success: 'Skill version is now frozen for testing.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not submit Skill for testing.';
    return errorState([{ code: 'testing_transition_rejected', path: 'status', message }]);
  }
}

export async function persistShotSkillReleaseValidationAction(
  _previous: SkillEditorActionState,
  formData: FormData,
): Promise<SkillEditorActionState> {
  const workspace = await requireOwnerWorkspace();
  const input = z.object({
    versionId: z.coerce.number().int().positive(),
    fixture: z.string().min(1),
  }).safeParse({
    versionId: formData.get('versionId'),
    fixture: formData.get('fixture'),
  });
  if (!input.success) return errorState(issueErrors(input.error, 'releaseValidation'));
  let fixtureJson: unknown;
  try {
    fixtureJson = JSON.parse(input.data.fixture);
  } catch {
    return errorState([{ code: 'invalid_json', path: 'fixture', message: 'Invalid serialized Fixture.' }]);
  }
  const fixture = shotSkillContextSchema.safeParse(fixtureJson);
  if (!fixture.success) return errorState(issueErrors(fixture.error, 'fixture'));
  try {
    await recordShotSkillReleaseValidation({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      versionId: input.data.versionId,
      fixture: fixture.data,
    });
    revalidatePath('/dashboard/skills');
    return { success: 'Controlled Fixture validation evidence persisted.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not persist release validation evidence.';
    return errorState([{ code: 'release_validation_rejected', path: 'validationEvidence', message }]);
  }
}

export async function activateShotSkillVersionAction(
  _previous: SkillEditorActionState,
  formData: FormData,
): Promise<SkillEditorActionState> {
  const workspace = await requireOwnerWorkspace();
  const versionId = z.coerce.number().int().positive().safeParse(formData.get('versionId'));
  if (!versionId.success) {
    return errorState([{ code: 'invalid_version_id', path: 'versionId', message: 'Invalid Skill version.' }]);
  }
  try {
    const updated = await activateShotSkillVersion({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      versionId: versionId.data,
    });
    revalidatePath('/dashboard/skills');
    revalidatePath(`/dashboard/skills/${updated.skill.id}`);
    revalidatePath(`/dashboard/skills/${updated.skill.id}/versions/${updated.version.id}`);
    return { success: 'Skill version is Active.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not activate Skill version.';
    return errorState([{ code: 'release_blocked', path: 'validationEvidence', message }]);
  }
}

export async function forkShotSkillVersionAction(formData: FormData) {
  const workspace = await requireOwnerWorkspace();
  const versionId = z.coerce.number().int().positive().parse(formData.get('versionId'));
  const durationSeconds = z.coerce.number().int().min(4).max(15).optional().parse(formData.get('durationSeconds') || undefined);
  const created = await createShotSkillDraftFromVersion({
    teamId: workspace.team.id,
    userId: workspace.user.id,
    sourceVersionId: versionId,
    durationSeconds,
  });
  redirect(`/dashboard/skills/${created.skill.id}/edit/${created.version.id}`);
}

export async function previewShotSkillImportAction(
  _previous: SkillImportActionState,
  formData: FormData,
): Promise<SkillImportActionState> {
  const workspace = await requireWorkspace();
  if (workspace.role !== 'owner') return importForbiddenState();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return {
      error: {
        code: 'SKILL_IMPORT_FILE_REQUIRED',
        path: '$file',
        message: 'Select a Shot Skill JSON file.',
      },
    };
  }

  try {
    validateShotSkillImportFileBoundary({
      fileName: file.name,
      contentType: file.type,
      byteLength: file.size,
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const preview = previewShotSkillImport({
      fileName: file.name,
      contentType: file.type,
      bytes,
    });
    const target = await previewPrivateShotSkillImportTarget({
      teamId: workspace.team.id,
      definition: preview.definition,
    });
    const token = await new SignJWT({
      purpose: 'shot_skill_import_preview',
      teamId: workspace.team.id,
      userId: workspace.user.id,
      fileName: file.name,
      contentType: file.type,
      fileHash: preview.fileHash,
      targetHash: hashStable(target),
      bytesBase64: Buffer.from(bytes).toString('base64'),
    })
      .setProtectedHeader({ alg: 'HS256', typ: IMPORT_PREVIEW_TOKEN_TYPE })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(importPreviewTokenKey);

    return {
      preview: {
        token,
        teamName: workspace.team.name,
        fileName: file.name,
        fileHash: preview.fileHash,
        bytes: preview.bytes,
        extensions: preview.extensions,
        definition: {
          id: preview.definition.id,
          version: preview.definition.version,
          name: preview.definition.name,
          specVersion: preview.definition.specVersion,
        },
        target,
      },
    };
  } catch (error) {
    return importErrorState(error);
  }
}

export async function confirmShotSkillImportAction(
  _previous: SkillImportActionState,
  formData: FormData,
): Promise<SkillImportActionState> {
  const workspace = await requireWorkspace();
  if (workspace.role !== 'owner') return importForbiddenState();
  const input = z.object({
    previewToken: z.string().min(1).max(MAX_IMPORT_PREVIEW_TOKEN_LENGTH),
    mode: z.enum(['new_card', 'new_version', 'fork']),
    forkStableId: z.string().max(100).optional(),
  }).safeParse({
    previewToken: formData.get('previewToken'),
    mode: formData.get('mode'),
    forkStableId: formData.get('forkStableId') || undefined,
  });
  if (!input.success) {
    const first = input.error.issues[0];
    return {
      error: {
        code: 'SKILL_IMPORT_CONFIRMATION_INVALID',
        path: `$confirmation.${first?.path.join('.') || 'input'}`,
        message: first?.message ?? 'Import confirmation is invalid.',
      },
    };
  }

  let payload: z.infer<typeof importPreviewTokenSchema>;
  try {
    const verified = await jwtVerify(input.data.previewToken, importPreviewTokenKey, {
      algorithms: ['HS256'],
      typ: IMPORT_PREVIEW_TOKEN_TYPE,
    });
    payload = importPreviewTokenSchema.parse(verified.payload);
    if (payload.teamId !== workspace.team.id || payload.userId !== workspace.user.id) {
      throw new Error('Preview principal mismatch.');
    }
  } catch {
    return {
      error: {
        code: 'SKILL_IMPORT_PREVIEW_INVALID',
        path: '$confirmation.previewToken',
        message: 'Import Preview is invalid or expired. Preview the original file again.',
      },
    };
  }

  let created;
  try {
    const bytes = new Uint8Array(Buffer.from(payload.bytesBase64, 'base64'));
    validateShotSkillImportFileBoundary({
      fileName: payload.fileName,
      contentType: payload.contentType,
      byteLength: bytes.byteLength,
    });
    const preview = previewShotSkillImport({
      fileName: payload.fileName,
      contentType: payload.contentType,
      bytes,
    });
    if (preview.fileHash !== payload.fileHash) {
      return {
        error: {
          code: 'SKILL_IMPORT_PREVIEW_TAMPERED',
          path: '$confirmation.previewToken',
          message: 'Import Preview bytes do not match the signed file hash.',
        },
      };
    }
    const currentTarget = await previewPrivateShotSkillImportTarget({
      teamId: workspace.team.id,
      definition: preview.definition,
    });
    if (hashStable(currentTarget) !== payload.targetHash) {
      return {
        error: {
          code: 'SKILL_IMPORT_TARGET_CHANGED',
          path: '$confirmation',
          message: 'The Team conflict, fallback, parent, or target changed after Preview. Preview the file again.',
        },
      };
    }
    created = await importPrivateShotSkillDraft({
      teamId: workspace.team.id,
      userId: workspace.user.id,
      definition: preview.definition,
      fileHash: preview.fileHash,
      fileName: payload.fileName,
      expectedTargetHash: payload.targetHash,
      mode: input.data.mode,
      forkStableId: input.data.forkStableId,
    });
  } catch (error) {
    return importErrorState(error);
  }

  revalidatePath('/dashboard/skills');
  revalidatePath(`/dashboard/skills/${created.skill.id}`);
  redirect(`/dashboard/skills/${created.skill.id}/edit/${created.version.id}`);
}
