import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  ActivityType,
  activityLogs,
  shotSkills,
  shotSkillVersions,
  teamMembers,
  type ShotSkill,
  type ShotSkillVersion,
} from '@/lib/db/schema';
import { hashShotSkillDefinition, hashStable } from './compiler';
import { shotSkillEditorFormSchema, type ShotSkillCard } from './schema';
import { assertAccessibleAcyclicFallback } from './persistence';

export type ShotSkillImportMode = 'new_card' | 'new_version' | 'fork';

export type ShotSkillImportBusinessIssue = {
  code:
    | 'SKILL_IMPORT_MODE_INVALID'
    | 'SKILL_IMPORT_TARGET_CHANGED'
    | 'SKILL_IMPORT_FORK_ID_REQUIRED'
    | 'SKILL_IMPORT_FORK_ID_INVALID'
    | 'SKILL_IMPORT_FORK_ID_CONFLICT'
    | 'SKILL_IMPORT_FALLBACK_INVALID'
    | 'SKILL_IMPORT_VERSION_EXHAUSTED'
    | 'SKILL_IMPORT_COMMIT_CONFLICT';
  path: string;
  message: string;
};

export class ShotSkillImportBusinessError extends Error {
  readonly code: ShotSkillImportBusinessIssue['code'];
  readonly path: string;

  constructor(issue: ShotSkillImportBusinessIssue) {
    super(issue.message);
    this.name = 'ShotSkillImportBusinessError';
    this.code = issue.code;
    this.path = issue.path;
  }

  toIssue(): ShotSkillImportBusinessIssue {
    return { code: this.code, path: this.path, message: this.message };
  }
}

export type ShotSkillImportTargetPreview = {
  stableId: string;
  importedVersion: string;
  targetVersion: string;
  targetScope: 'workspace_private';
  targetStatus: 'draft';
  conflict: 'none' | 'current_team' | 'official';
  conflictLabel: string;
  allowedModes: ShotSkillImportMode[];
  suggestedMode: ShotSkillImportMode;
  parentVersionId: number | null;
  parentVersion: string | null;
  fallback: {
    stableId: string | null;
    resolution: 'not_declared' | 'current_team' | 'official' | 'not_found';
    label: string;
  };
};

type SkillAndVersion = {
  skill: ShotSkill;
  version: ShotSkillVersion | null;
};

const stableIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function businessIssue(
  code: ShotSkillImportBusinessIssue['code'],
  path: string,
  message: string,
): never {
  throw new ShotSkillImportBusinessError({ code, path, message });
}

function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    businessIssue('SKILL_IMPORT_VERSION_EXHAUSTED', '$.version', 'The current parent does not have a valid semantic version.');
  }
  const candidate = `${match[1]}.${match[2]}.${BigInt(match[3]) + 1n}`;
  if (candidate.length > 30) {
    businessIssue('SKILL_IMPORT_VERSION_EXHAUSTED', '$.version', 'No next patch version fits the 30-character version contract.');
  }
  return candidate;
}

async function assertWorkspaceOwner(teamId: number, userId: number): Promise<void> {
  const membership = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(
    eq(teamMembers.teamId, teamId),
    eq(teamMembers.userId, userId),
    eq(teamMembers.role, 'owner'),
  )).limit(1);
  if (!membership[0]) {
    businessIssue('SKILL_IMPORT_TARGET_CHANGED', '$team', 'Only workspace owners can import private Shot Skills.');
  }
}

async function findSkillAndLatestVersion(teamId: number, stableId: string): Promise<{
  currentTeam: SkillAndVersion | null;
  official: SkillAndVersion | null;
}> {
  const skills = await db.select().from(shotSkills).where(and(
    eq(shotSkills.stableId, stableId),
    or(eq(shotSkills.ownerTeamId, teamId), isNull(shotSkills.ownerTeamId)),
  ));

  const withVersion = await Promise.all(skills.map(async (skill): Promise<SkillAndVersion> => {
    const version = (await db.select().from(shotSkillVersions)
      .where(eq(shotSkillVersions.shotSkillId, skill.id))
      .orderBy(desc(shotSkillVersions.createdAt), desc(shotSkillVersions.id))
      .limit(1))[0] ?? null;
    return { skill, version };
  }));

  return {
    currentTeam: withVersion.find((entry) => entry.skill.ownerTeamId === teamId) ?? null,
    official: withVersion.find((entry) => entry.skill.ownerTeamId === null) ?? null,
  };
}

async function chooseTargetVersion(skillId: number, importedVersion: string, parentVersion: string): Promise<string> {
  const existing = await db.select({ version: shotSkillVersions.version }).from(shotSkillVersions)
    .where(eq(shotSkillVersions.shotSkillId, skillId));
  const versions = new Set(existing.map((entry) => entry.version));
  if (!versions.has(importedVersion)) return importedVersion;
  let candidate = nextPatchVersion(parentVersion);
  while (versions.has(candidate)) candidate = nextPatchVersion(candidate);
  return candidate;
}

async function resolveFallback(teamId: number, stableId: string | undefined): Promise<ShotSkillImportTargetPreview['fallback']> {
  if (!stableId) return { stableId: null, resolution: 'not_declared', label: 'No fallback declared' };
  const active = await db.select({ skill: shotSkills }).from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkills.stableId, stableId),
      eq(shotSkillVersions.status, 'active'),
      or(eq(shotSkills.ownerTeamId, teamId), isNull(shotSkills.ownerTeamId)),
    ));
  if (active.some((entry) => entry.skill.ownerTeamId === teamId)) {
    return { stableId, resolution: 'current_team', label: 'Current Team private active Skill' };
  }
  if (active.some((entry) => entry.skill.ownerTeamId === null)) {
    return { stableId, resolution: 'official', label: 'Official active Skill' };
  }
  return { stableId, resolution: 'not_found', label: 'No accessible active fallback in the current Team' };
}

export async function previewPrivateShotSkillImportTarget(input: {
  teamId: number;
  definition: ShotSkillCard;
}): Promise<ShotSkillImportTargetPreview> {
  const definition = shotSkillEditorFormSchema.parse(input.definition);
  const collision = await findSkillAndLatestVersion(input.teamId, definition.id);
  const fallback = await resolveFallback(input.teamId, definition.fallbackSkillId);

  if (collision.currentTeam) {
    if (!collision.currentTeam.version) {
      businessIssue('SKILL_IMPORT_TARGET_CHANGED', '$.id', 'The current Team Skill has no version to use as an import parent.');
    }
    const targetVersion = await chooseTargetVersion(
      collision.currentTeam.skill.id,
      definition.version,
      collision.currentTeam.version.version,
    );
    return {
      stableId: definition.id,
      importedVersion: definition.version,
      targetVersion,
      targetScope: 'workspace_private',
      targetStatus: 'draft',
      conflict: 'current_team',
      conflictLabel: `Current Team Skill exists; confirmation creates a new version after v${collision.currentTeam.version.version}.`,
      allowedModes: ['new_version', 'fork'],
      suggestedMode: 'new_version',
      parentVersionId: collision.currentTeam.version.id,
      parentVersion: collision.currentTeam.version.version,
      fallback,
    };
  }

  if (collision.official) {
    return {
      stableId: definition.id,
      importedVersion: definition.version,
      targetVersion: definition.version,
      targetScope: 'workspace_private',
      targetStatus: 'draft',
      conflict: 'official',
      conflictLabel: 'An Official Skill uses this stable ID; confirmation requires a Fork with a new stable ID.',
      allowedModes: ['fork'],
      suggestedMode: 'fork',
      parentVersionId: null,
      parentVersion: null,
      fallback,
    };
  }

  return {
    stableId: definition.id,
    importedVersion: definition.version,
    targetVersion: definition.version,
    targetScope: 'workspace_private',
    targetStatus: 'draft',
    conflict: 'none',
    conflictLabel: 'No accessible Skill uses this stable ID.',
    allowedModes: ['new_card', 'fork'],
    suggestedMode: 'new_card',
    parentVersionId: null,
    parentVersion: null,
    fallback,
  };
}

export async function importPrivateShotSkillDraft(input: {
  teamId: number;
  userId: number;
  definition: ShotSkillCard;
  fileHash: string;
  fileName: string;
  expectedTargetHash: string;
  mode: ShotSkillImportMode;
  forkStableId?: string;
}): Promise<{ skill: ShotSkill; version: ShotSkillVersion; definition: ShotSkillCard }> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  const sourceDefinition = shotSkillEditorFormSchema.parse(input.definition);
  const preview = await previewPrivateShotSkillImportTarget({ teamId: input.teamId, definition: sourceDefinition });
  if (hashStable(preview) !== input.expectedTargetHash) {
    businessIssue('SKILL_IMPORT_TARGET_CHANGED', '$confirmation', 'The Team conflict, fallback, parent, or target changed after Preview. Preview the file again.');
  }
  if (!preview.allowedModes.includes(input.mode)) {
    businessIssue('SKILL_IMPORT_MODE_INVALID', '$confirmation.mode', 'The selected collision mode is not allowed for the current Team target.');
  }

  let definition = sourceDefinition;
  if (input.mode === 'new_version') {
    definition = shotSkillEditorFormSchema.parse({ ...sourceDefinition, version: preview.targetVersion });
  } else if (input.mode === 'fork') {
    if (!input.forkStableId) {
      businessIssue('SKILL_IMPORT_FORK_ID_REQUIRED', '$confirmation.forkStableId', 'A new stable ID is required for Fork imports.');
    }
    if (
      input.forkStableId.length > 100
      || !stableIdPattern.test(input.forkStableId)
      || input.forkStableId === sourceDefinition.id
    ) {
      businessIssue('SKILL_IMPORT_FORK_ID_INVALID', '$confirmation.forkStableId', 'Fork stable ID must be a different lowercase slug of at most 100 characters.');
    }
    const forkCollision = await findSkillAndLatestVersion(input.teamId, input.forkStableId);
    if (forkCollision.currentTeam || forkCollision.official) {
      businessIssue('SKILL_IMPORT_FORK_ID_CONFLICT', '$confirmation.forkStableId', 'Fork stable ID is already visible to the current Team.');
    }
    definition = shotSkillEditorFormSchema.parse({ ...sourceDefinition, id: input.forkStableId });
  }

  try {
    await assertAccessibleAcyclicFallback({
      teamId: input.teamId,
      stableId: definition.id,
      fallbackSkillId: definition.fallbackSkillId,
    });
  } catch (error) {
    businessIssue(
      'SKILL_IMPORT_FALLBACK_INVALID',
      '$.fallbackSkillId',
      error instanceof Error ? error.message.replace(/^fallbackSkillId:\s*/, '') : 'Fallback must be accessible, active, and acyclic.',
    );
  }

  try {
    return await db.transaction(async (tx) => {
    let skill: ShotSkill;
    let parentVersionId: number | null = null;

    if (input.mode === 'new_version') {
      const currentSkill = (await tx.select().from(shotSkills).where(and(
        eq(shotSkills.stableId, sourceDefinition.id),
        eq(shotSkills.ownerTeamId, input.teamId),
      )).limit(1).for('update'))[0];
      if (!currentSkill || preview.parentVersionId === null) {
        businessIssue('SKILL_IMPORT_TARGET_CHANGED', '$.id', 'The current Team import target changed after Preview. Preview the file again.');
      }
      const parent = (await tx.select().from(shotSkillVersions)
        .where(eq(shotSkillVersions.shotSkillId, currentSkill.id))
        .orderBy(desc(shotSkillVersions.createdAt), desc(shotSkillVersions.id))
        .limit(1))[0];
      if (!parent || parent.id !== preview.parentVersionId) {
        businessIssue('SKILL_IMPORT_TARGET_CHANGED', '$confirmation', 'The current parent version changed after Preview. Preview the file again.');
      }
      skill = currentSkill;
      parentVersionId = parent.id;
    } else {
      const changedTarget = await tx.select({ id: shotSkills.id }).from(shotSkills).where(and(
        eq(shotSkills.stableId, definition.id),
        or(eq(shotSkills.ownerTeamId, input.teamId), isNull(shotSkills.ownerTeamId)),
      )).limit(1);
      if (changedTarget[0]) {
        businessIssue('SKILL_IMPORT_TARGET_CHANGED', '$.id', 'The target stable ID became unavailable after Preview. Preview the file again.');
      }
      const insertedSkill = await tx.insert(shotSkills).values({
        stableId: definition.id,
        ownerTeamId: input.teamId,
        name: definition.name,
        description: definition.description,
        createdBy: input.userId,
      }).onConflictDoNothing().returning();
      if (!insertedSkill[0]) {
        businessIssue('SKILL_IMPORT_COMMIT_CONFLICT', '$.id', 'The target stable ID was created after Preview. Preview the file again.');
      }
      skill = insertedSkill[0];
    }

    const insertedVersion = await tx.insert(shotSkillVersions).values({
      shotSkillId: skill.id,
      parentVersionId,
      version: definition.version,
      specVersion: definition.specVersion,
      status: 'draft',
      normalizedDefinition: definition,
      definitionHash: hashShotSkillDefinition(definition),
      provenance: definition.provenance,
      createdBy: input.userId,
    }).onConflictDoNothing().returning();
    if (!insertedVersion[0]) {
      businessIssue('SKILL_IMPORT_COMMIT_CONFLICT', '$.version', 'The target version was created after Preview. Preview the file again.');
    }

    await tx.insert(activityLogs).values({
      teamId: input.teamId,
      userId: input.userId,
      action: ActivityType.IMPORT_SHOT_SKILL,
      metadata: {
        actorUserId: input.userId,
        fileHash: input.fileHash,
        fileName: input.fileName,
        mode: input.mode,
        createdSkillId: skill.id,
        createdVersionId: insertedVersion[0].id,
        stableId: definition.id,
        version: definition.version,
        parentVersionId,
      },
    });

    return { skill, version: insertedVersion[0], definition };
    }, { isolationLevel: 'serializable' });
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === '40001'
    ) {
      businessIssue(
        'SKILL_IMPORT_COMMIT_CONFLICT',
        '$confirmation',
        'The import target changed during confirmation. Preview the file again.',
      );
    }
    throw error;
  }
}
