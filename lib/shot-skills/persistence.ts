import { z } from 'zod';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  shotSkillReleaseValidations,
  shotSkillVersions,
  shotSkills,
  teamMembers,
  type ShotSkill,
  type ShotSkillReleaseValidation,
  type ShotSkillVersion,
} from '@/lib/db/schema';
import { hashShotSkillDefinition, hashStable } from './compiler';
import { evaluateShotSkillEligibility } from './eligibility';
import {
  getApprovedSpecSkillContext,
  getPreferredApprovedSpecSkillId,
} from './approved-spec';
import { assertShotSkillVersionTransition } from './lifecycle';
import { previewShotSkillFixture } from './library';
import {
  compiledShotRecipeSchema,
  shotSkillCardSchema,
  shotSkillContextSchema,
  shotSkillEditorFormSchema,
  type CompiledShotRecipe,
  type ShotSkillCard,
  type ShotSkillContext,
  type ShotSkillStatus,
} from './schema';

export type TeamShotSkillVersion = {
  skill: ShotSkill;
  version: ShotSkillVersion;
  definition: ShotSkillCard;
};

export type ShotSkillReleaseEvidence = Omit<
  ShotSkillReleaseValidation,
  'fixture' | 'reasons' | 'compiledRecipe'
> & {
  fixture: ShotSkillContext;
  reasons: string[];
  compiledRecipe: CompiledShotRecipe | null;
};

export type ShotSkillReleaseReadiness = {
  evidence: ShotSkillReleaseEvidence[];
  blockers: string[];
};

export type ResolvedProductionShotSkill = TeamShotSkillVersion & {
  selectionReason: string;
  eligibility: Array<{
    shotSkillVersionId: number;
    stableId: string;
    eligible: boolean;
    reasons: string[];
  }>;
};

function parseDefinition(value: unknown): ShotSkillCard {
  return shotSkillCardSchema.parse(value);
}

function parseEditorDefinition(value: unknown): ShotSkillCard {
  return shotSkillEditorFormSchema.parse(value);
}

function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error('Shot Skill version must be semantic versioning.');
  const candidate = `${match[1]}.${match[2]}.${BigInt(match[3]!) + 1n}`;
  if (candidate.length > 30) throw new Error('Shot Skill patch version exceeds the 30-character persistence limit.');
  return candidate;
}

function parseReleaseEvidence(row: ShotSkillReleaseValidation): ShotSkillReleaseEvidence {
  return {
    ...row,
    fixture: shotSkillContextSchema.parse(row.fixture),
    reasons: z.array(z.string().min(1)).parse(row.reasons),
    compiledRecipe: row.compiledRecipe === null
      ? null
      : compiledShotRecipeSchema.parse(row.compiledRecipe),
  };
}

function releaseBlockers(
  status: ShotSkillVersion['status'],
  definitionHash: string,
  evidence: readonly ShotSkillReleaseEvidence[],
): string[] {
  const blockers: string[] = [];
  if (status !== 'testing') blockers.push('Only a Testing version can be approved for release.');
  const latest = evidence.find((entry) => entry.definitionHash === definitionHash);
  if (!latest) {
    blockers.push('Run and persist a controlled Fixture validation for this exact definition hash.');
  } else if (!latest.eligible) {
    blockers.push(`Latest controlled Fixture validation is ineligible: ${latest.reasons.join(' ') || 'no reason recorded'}`);
  }
  return blockers;
}

async function assertWorkspaceOwner(teamId: number, userId: number): Promise<void> {
  const membership = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(
      eq(teamMembers.teamId, teamId),
      eq(teamMembers.userId, userId),
      eq(teamMembers.role, 'owner'),
    ))
    .limit(1);

  if (!membership[0]) throw new Error('Only workspace owners can manage private Shot Skills.');
}

export async function assertAccessibleAcyclicFallback(input: {
  teamId: number;
  stableId: string;
  fallbackSkillId?: string;
}): Promise<void> {
  if (!input.fallbackSkillId) return;
  if (input.fallbackSkillId === input.stableId) {
    throw new Error('fallbackSkillId: A Skill cannot reference itself.');
  }
  const rows = await db
    .select({ skill: shotSkills, version: shotSkillVersions })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkillVersions.status, 'active'),
      or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
    ));
  const definitions = new Map<string, ShotSkillCard>();
  for (const row of rows.sort(
    (left, right) => Number(left.skill.ownerTeamId !== null) - Number(right.skill.ownerTeamId !== null),
  )) {
    definitions.set(row.skill.stableId, parseDefinition(row.version.normalizedDefinition));
  }
  if (!definitions.has(input.fallbackSkillId)) {
    throw new Error('fallbackSkillId: Fallback must reference an accessible active Skill.');
  }
  const visited = new Set([input.stableId]);
  let cursor: string | undefined = input.fallbackSkillId;
  while (cursor) {
    if (visited.has(cursor)) {
      throw new Error('fallbackSkillId: Fallback references must not form a cycle.');
    }
    visited.add(cursor);
    cursor = definitions.get(cursor)?.fallbackSkillId;
  }
}

async function getAccessibleVersion(input: {
  teamId: number;
  versionId: number;
}): Promise<TeamShotSkillVersion | null> {
  const rows = await db
    .select({ skill: shotSkills, version: shotSkillVersions })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkillVersions.id, input.versionId),
      or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, definition: parseDefinition(row.version.normalizedDefinition) };
}

export async function getShotSkillVersionForTeam(input: {
  teamId: number;
  versionId: number;
}): Promise<TeamShotSkillVersion | null> {
  return getAccessibleVersion(input);
}

export async function getActiveShotSkillVersionForTeam(input: {
  teamId: number;
  stableId: string;
}): Promise<TeamShotSkillVersion | null> {
  const rows = await db
    .select({ skill: shotSkills, version: shotSkillVersions })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkills.stableId, input.stableId),
      eq(shotSkillVersions.status, 'active'),
      or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
    ))
    .orderBy(desc(shotSkills.ownerTeamId), desc(shotSkillVersions.publishedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, definition: parseDefinition(row.version.normalizedDefinition) };
}

export async function resolveShotSkillVersionForApprovedSpec(input: {
  teamId: number;
  specSnapshot: string;
  lockedVersionId?: number;
}): Promise<ResolvedProductionShotSkill> {
  const context = getApprovedSpecSkillContext(input.specSnapshot);
  const preferredStableId = getPreferredApprovedSpecSkillId(input.specSnapshot);
  if (input.lockedVersionId !== undefined) {
    const locked = await getAccessibleVersion({
      teamId: input.teamId,
      versionId: input.lockedVersionId,
    });
    if (!locked) throw new Error('Locked Shot Skill version is not accessible to this workspace.');
    const result = evaluateShotSkillEligibility(context, [locked.definition])[0];
    if (!result?.eligible) {
      throw new Error(`Locked Shot Skill version is not eligible: ${result?.reasons.join(', ') ?? 'unknown reason'}.`);
    }
    return {
      ...locked,
      selectionReason: 'selected Batch-locked database Skill version',
      eligibility: [{
        shotSkillVersionId: locked.version.id,
        stableId: locked.skill.stableId,
        eligible: true,
        reasons: [],
      }],
    };
  }

  const rows = await db
    .select({ skill: shotSkills, version: shotSkillVersions })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkillVersions.status, 'active'),
      or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
    ))
    .orderBy(desc(shotSkillVersions.publishedAt), desc(shotSkillVersions.createdAt));
  const candidates = rows
    .map((row) => ({ ...row, definition: parseDefinition(row.version.normalizedDefinition) }))
    .sort((left, right) => Number(right.skill.ownerTeamId === input.teamId) - Number(left.skill.ownerTeamId === input.teamId));
  const evaluations = evaluateShotSkillEligibility(context, candidates.map((candidate) => candidate.definition));
  const evidence = candidates.map((candidate, index) => ({
    shotSkillVersionId: candidate.version.id,
    stableId: candidate.skill.stableId,
    eligible: evaluations[index]?.eligible ?? false,
    reasons: evaluations[index]?.reasons ?? ['eligibility result missing'],
  }));
  const preferred = candidates.find((candidate, index) => (
    candidate.skill.stableId === preferredStableId && evaluations[index]?.eligible
  ));
  const preferredDefinition = candidates.find((candidate) => candidate.skill.stableId === preferredStableId)?.definition;
  const fallback = preferredDefinition?.fallbackSkillId
    ? candidates.find((candidate, index) => (
      candidate.skill.stableId === preferredDefinition.fallbackSkillId && evaluations[index]?.eligible
    ))
    : undefined;
  const selected = preferred ?? fallback ?? candidates.find((_, index) => evaluations[index]?.eligible);
  if (!selected) {
    throw new Error(`No eligible persisted Shot Skill version. ${evidence.map((entry) => `${entry.stableId}: ${entry.reasons.join(', ')}`).join('; ')}`);
  }
  return {
    ...selected,
    selectionReason: preferred
      ? 'preferred persisted Skill version is eligible'
      : fallback
        ? `${preferredStableId} was not eligible; selected its persisted fallback`
        : 'selected first eligible persisted Skill version',
    eligibility: evidence,
  };
}

export async function getActiveShotSkillVersionMatchingRecipe(input: {
  teamId: number;
  stableId: string;
  version: string;
  definitionHash: string;
}): Promise<TeamShotSkillVersion | null> {
  const rows = await db
    .select({ skill: shotSkills, version: shotSkillVersions })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkills.stableId, input.stableId),
      eq(shotSkillVersions.version, input.version),
      eq(shotSkillVersions.definitionHash, input.definitionHash),
      eq(shotSkillVersions.status, 'active'),
      or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, definition: parseDefinition(row.version.normalizedDefinition) };
}

export async function createPrivateShotSkillDraft(input: {
  teamId: number;
  userId: number;
  definition: unknown;
}): Promise<TeamShotSkillVersion> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  const definition = parseEditorDefinition(input.definition);
  await assertAccessibleAcyclicFallback({
    teamId: input.teamId,
    stableId: definition.id,
    fallbackSkillId: definition.fallbackSkillId,
  });

  return db.transaction(async (tx) => {
    const skill = await tx.insert(shotSkills).values({
      stableId: definition.id,
      ownerTeamId: input.teamId,
      name: definition.name,
      description: definition.description,
      createdBy: input.userId,
    }).returning();
    if (!skill[0]) throw new Error('Shot Skill could not be created.');

    const version = await tx.insert(shotSkillVersions).values({
      shotSkillId: skill[0].id,
      version: definition.version,
      specVersion: definition.specVersion,
      status: 'draft',
      normalizedDefinition: definition,
      definitionHash: hashShotSkillDefinition(definition),
      provenance: definition.provenance,
      createdBy: input.userId,
    }).returning();
    if (!version[0]) throw new Error('Shot Skill version could not be created.');
    return { skill: skill[0], version: version[0], definition };
  });
}

function forkDefinitionForDuration(
  source: ShotSkillCard,
  version: string,
  durationSeconds?: number,
): ShotSkillCard {
  const durations = durationSeconds
    ? [...new Set([...source.provider.durationSeconds, durationSeconds])].sort((left, right) => left - right)
    : source.provider.durationSeconds;
  return parseEditorDefinition({
    ...source,
    version,
    eligibility: {
      ...source.eligibility,
      all: source.eligibility.all.map((predicate) =>
        predicate.field === 'durationSeconds' ? { ...predicate, in: durations } : predicate,
      ),
    },
    provider: { ...source.provider, durationSeconds: durations },
  });
}

export async function createShotSkillDraftFromVersion(input: {
  teamId: number;
  userId: number;
  sourceVersionId: number;
  durationSeconds?: number;
}): Promise<TeamShotSkillVersion> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  const source = await getAccessibleVersion({ teamId: input.teamId, versionId: input.sourceVersionId });
  if (!source) throw new Error('Shot Skill version is not available in the current workspace.');

  const definition = forkDefinitionForDuration(
    source.definition,
    nextPatchVersion(source.version.version),
    input.durationSeconds,
  );
  await assertAccessibleAcyclicFallback({
    teamId: input.teamId,
    stableId: definition.id,
    fallbackSkillId: definition.fallbackSkillId,
  });

  if (source.skill.ownerTeamId === input.teamId) {
    return db.transaction(async (tx) => {
      await tx.select({ id: shotSkillVersions.id }).from(shotSkillVersions)
        .where(eq(shotSkillVersions.id, source.version.id))
        .limit(1)
        .for('update');
      const existingVersions = await tx.select({ version: shotSkillVersions.version })
        .from(shotSkillVersions)
        .where(eq(shotSkillVersions.shotSkillId, source.skill.id));
      const usedVersions = new Set(existingVersions.map((entry) => entry.version));
      let successorVersion = nextPatchVersion(source.version.version);
      while (usedVersions.has(successorVersion)) successorVersion = nextPatchVersion(successorVersion);
      const successorDefinition = forkDefinitionForDuration(
        source.definition,
        successorVersion,
        input.durationSeconds,
      );
      const version = await tx.insert(shotSkillVersions).values({
        shotSkillId: source.skill.id,
        parentVersionId: source.version.id,
        version: successorDefinition.version,
        specVersion: successorDefinition.specVersion,
        status: 'draft',
        normalizedDefinition: successorDefinition,
        definitionHash: hashShotSkillDefinition(successorDefinition),
        provenance: successorDefinition.provenance,
        createdBy: input.userId,
      }).returning();
      if (!version[0]) throw new Error('Shot Skill successor draft could not be created.');
      return { skill: source.skill, version: version[0], definition: successorDefinition };
    });
  }

  return db.transaction(async (tx) => {
    let privateSkill = (await tx.select().from(shotSkills).where(and(
      eq(shotSkills.ownerTeamId, input.teamId),
      eq(shotSkills.stableId, source.skill.stableId),
    )).limit(1).for('update'))[0];
    if (!privateSkill) {
      privateSkill = (await tx.insert(shotSkills).values({
        stableId: source.skill.stableId,
        ownerTeamId: input.teamId,
        name: source.skill.name,
        description: source.skill.description,
        createdBy: input.userId,
      }).returning())[0];
    }
    if (!privateSkill) throw new Error('Private Shot Skill fork could not be created.');

    const existingVersions = await tx.select({ version: shotSkillVersions.version })
      .from(shotSkillVersions)
      .where(eq(shotSkillVersions.shotSkillId, privateSkill.id));
    const usedVersions = new Set(existingVersions.map((entry) => entry.version));
    let forkVersion = nextPatchVersion(source.version.version);
    while (usedVersions.has(forkVersion)) forkVersion = nextPatchVersion(forkVersion);
    const forkDefinition = parseEditorDefinition({
      ...forkDefinitionForDuration(source.definition, forkVersion, input.durationSeconds),
      provenance: {
        creator: 'workspace',
        source: `forked-from-version:${source.version.id}`,
      },
    });
    const inserted = await tx.insert(shotSkillVersions).values({
      shotSkillId: privateSkill.id,
      parentVersionId: source.version.id,
      version: forkDefinition.version,
      specVersion: forkDefinition.specVersion,
      status: 'draft',
      normalizedDefinition: forkDefinition,
      definitionHash: hashShotSkillDefinition(forkDefinition),
      provenance: forkDefinition.provenance,
      createdBy: input.userId,
    }).returning();
    if (!inserted[0]) throw new Error('Private Shot Skill fork version could not be created.');
    return { skill: privateSkill, version: inserted[0], definition: forkDefinition };
  });
}

export async function updatePrivateShotSkillDraft(input: {
  teamId: number;
  userId: number;
  versionId: number;
  expectedRevision: number;
  definition: unknown;
}): Promise<TeamShotSkillVersion> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  const current = await getAccessibleVersion({ teamId: input.teamId, versionId: input.versionId });
  if (!current || current.skill.ownerTeamId !== input.teamId) {
    throw new Error('Private Shot Skill draft not found.');
  }
  if (current.version.status !== 'draft') {
    throw new Error('Only draft Shot Skill versions can be edited.');
  }

  const definition = parseEditorDefinition(input.definition);
  if (definition.version !== current.version.version) {
    throw new Error('version: Semantic version is immutable after Draft creation.');
  }
  if (definition.id !== current.skill.stableId) {
    const siblingVersions = await db
      .select({ id: shotSkillVersions.id })
      .from(shotSkillVersions)
      .where(eq(shotSkillVersions.shotSkillId, current.skill.id));
    if (siblingVersions.some((version) => version.id !== current.version.id)) {
      throw new Error('id: Stable ID is immutable once the Skill has another version.');
    }
  }
  await assertAccessibleAcyclicFallback({
    teamId: input.teamId,
    stableId: definition.id,
    fallbackSkillId: definition.fallbackSkillId,
  });

  return db.transaction(async (tx) => {
    const updatedSkills = await tx.update(shotSkills).set({
      stableId: definition.id,
      name: definition.name,
      description: definition.description,
      updatedAt: new Date(),
    }).where(and(
      eq(shotSkills.id, current.skill.id),
      eq(shotSkills.ownerTeamId, input.teamId),
    )).returning();
    if (!updatedSkills[0]) throw new Error('Private Shot Skill draft not found.');

    const updatedVersions = await tx.update(shotSkillVersions).set({
      normalizedDefinition: definition,
      definitionHash: hashShotSkillDefinition(definition),
      provenance: definition.provenance,
      updatedAt: new Date(),
      revision: current.version.revision + 1,
    }).where(and(
      eq(shotSkillVersions.id, current.version.id),
      eq(shotSkillVersions.status, 'draft'),
      eq(shotSkillVersions.revision, input.expectedRevision),
    )).returning();
    if (!updatedVersions[0]) {
      throw new Error('Shot Skill draft was changed by another editor. Refresh before saving.');
    }
    return { skill: updatedSkills[0], version: updatedVersions[0], definition };
  });
}

export async function submitShotSkillVersionForTesting(input: {
  teamId: number;
  userId: number;
  versionId: number;
}): Promise<TeamShotSkillVersion> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  return db.transaction(async (tx) => {
    const current = (await tx
      .select({ skill: shotSkills, version: shotSkillVersions })
      .from(shotSkillVersions)
      .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
      .where(and(
        eq(shotSkillVersions.id, input.versionId),
        eq(shotSkills.ownerTeamId, input.teamId),
      ))
      .limit(1)
      .for('update'))[0];
    if (!current) throw new Error('Private Shot Skill draft not found.');
    assertShotSkillVersionTransition(current.version.status as ShotSkillStatus, 'testing');

    const definition = parseEditorDefinition(current.version.normalizedDefinition);
    const definitionHash = hashShotSkillDefinition(definition);
    const updated = await tx.update(shotSkillVersions).set({
      normalizedDefinition: definition,
      definitionHash,
      provenance: definition.provenance,
      status: 'testing',
      updatedAt: new Date(),
    }).where(and(
      eq(shotSkillVersions.id, current.version.id),
      eq(shotSkillVersions.status, 'draft'),
      eq(shotSkillVersions.revision, current.version.revision),
    )).returning();
    if (!updated[0]) throw new Error('Shot Skill draft changed while entering Testing. Refresh and try again.');
    return { skill: current.skill, version: updated[0], definition };
  });
}

export async function getShotSkillReleaseReadinessForTeam(input: {
  teamId: number;
  versionId: number;
}): Promise<ShotSkillReleaseReadiness | null> {
  const current = (await db
    .select({ skill: shotSkills, version: shotSkillVersions })
    .from(shotSkillVersions)
    .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
    .where(and(
      eq(shotSkillVersions.id, input.versionId),
      eq(shotSkills.ownerTeamId, input.teamId),
    ))
    .limit(1))[0];
  if (!current) return null;
  const rows = await db.select().from(shotSkillReleaseValidations).where(and(
    eq(shotSkillReleaseValidations.teamId, input.teamId),
    eq(shotSkillReleaseValidations.shotSkillVersionId, input.versionId),
  )).orderBy(desc(shotSkillReleaseValidations.createdAt), desc(shotSkillReleaseValidations.id));
  const evidence = rows.map(parseReleaseEvidence);
  return {
    evidence,
    blockers: releaseBlockers(current.version.status, current.version.definitionHash, evidence),
  };
}

export async function recordShotSkillReleaseValidation(input: {
  teamId: number;
  userId: number;
  versionId: number;
  fixture: unknown;
}): Promise<ShotSkillReleaseEvidence> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  const fixture = shotSkillContextSchema.parse(input.fixture);
  return db.transaction(async (tx) => {
    const current = (await tx
      .select({ skill: shotSkills, version: shotSkillVersions })
      .from(shotSkillVersions)
      .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
      .where(and(
        eq(shotSkillVersions.id, input.versionId),
        eq(shotSkills.ownerTeamId, input.teamId),
      ))
      .limit(1)
      .for('update'))[0];
    if (!current) throw new Error('Private Shot Skill version not found.');
    if (current.version.status !== 'testing') {
      throw new Error('Controlled release validation can only be persisted for a Testing version.');
    }
    const definition = parseEditorDefinition(current.version.normalizedDefinition);
    if (hashShotSkillDefinition(definition) !== current.version.definitionHash) {
      throw new Error('Testing version definition hash does not match its normalized definition.');
    }
    const fallbackRow = definition.fallbackSkillId
      ? (await tx
        .select({ skill: shotSkills, version: shotSkillVersions })
        .from(shotSkillVersions)
        .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
        .where(and(
          eq(shotSkills.stableId, definition.fallbackSkillId),
          eq(shotSkillVersions.status, 'active'),
          or(isNull(shotSkills.ownerTeamId), eq(shotSkills.ownerTeamId, input.teamId)),
        ))
        .orderBy(desc(shotSkills.ownerTeamId), desc(shotSkillVersions.publishedAt))
        .limit(1))[0]
      : null;
    const fallback = fallbackRow ? parseDefinition(fallbackRow.version.normalizedDefinition) : null;
    const preview = previewShotSkillFixture({ fixture, skill: definition, fallback });
    const inserted = (await tx.insert(shotSkillReleaseValidations).values({
      teamId: input.teamId,
      shotSkillVersionId: input.versionId,
      definitionHash: current.version.definitionHash,
      fixture: preview.fixture,
      fixtureHash: hashStable(preview.fixture),
      eligible: preview.eligible,
      reasons: preview.reasons,
      fallbackSkillId: preview.fallback?.skillId,
      fallbackEligible: preview.fallback?.eligible,
      selectionReason: preview.selectionReason,
      compiledRecipe: preview.compiled,
      createdBy: input.userId,
    }).returning())[0];
    if (!inserted) throw new Error('Controlled release validation evidence could not be persisted.');
    return parseReleaseEvidence(inserted);
  });
}

export async function activateShotSkillVersion(input: {
  teamId: number;
  userId: number;
  versionId: number;
}): Promise<TeamShotSkillVersion> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  return db.transaction(async (tx) => {
    const current = (await tx
      .select({ skill: shotSkills, version: shotSkillVersions })
      .from(shotSkillVersions)
      .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id))
      .where(and(
        eq(shotSkillVersions.id, input.versionId),
        eq(shotSkills.ownerTeamId, input.teamId),
      ))
      .limit(1)
      .for('update'))[0];
    if (!current) throw new Error('Private Shot Skill version not found.');
    assertShotSkillVersionTransition(current.version.status as ShotSkillStatus, 'active');
    const definition = parseEditorDefinition(current.version.normalizedDefinition);
    if (hashShotSkillDefinition(definition) !== current.version.definitionHash) {
      throw new Error('Testing version definition hash does not match its normalized definition.');
    }

    const evidenceRows = await tx.select().from(shotSkillReleaseValidations).where(and(
      eq(shotSkillReleaseValidations.teamId, input.teamId),
      eq(shotSkillReleaseValidations.shotSkillVersionId, input.versionId),
      eq(shotSkillReleaseValidations.definitionHash, current.version.definitionHash),
    )).orderBy(desc(shotSkillReleaseValidations.createdAt), desc(shotSkillReleaseValidations.id));
    const evidence = evidenceRows.map(parseReleaseEvidence);
    const blockers = releaseBlockers(
      current.version.status,
      current.version.definitionHash,
      evidence,
    );
    if (blockers.length > 0) throw new Error(`Shot Skill release blocked: ${blockers.join(' ')}`);

    await tx.update(shotSkillVersions).set({ status: 'deprecated', updatedAt: new Date() }).where(and(
      eq(shotSkillVersions.shotSkillId, current.skill.id),
      eq(shotSkillVersions.status, 'active'),
    ));
    const updated = await tx.update(shotSkillVersions).set({
      status: 'active',
      publishedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(shotSkillVersions.id, current.version.id),
      eq(shotSkillVersions.status, 'testing'),
    )).returning();
    if (!updated[0]) throw new Error('Shot Skill version changed while being activated. Refresh and review it again.');
    return {
      skill: current.skill,
      version: updated[0],
      definition,
    };
  });
}

export async function deprecateShotSkillVersion(input: {
  teamId: number;
  userId: number;
  versionId: number;
}): Promise<TeamShotSkillVersion> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  const current = await getAccessibleVersion({ teamId: input.teamId, versionId: input.versionId });
  if (!current || current.skill.ownerTeamId !== input.teamId) throw new Error('Private Shot Skill version not found.');
  assertShotSkillVersionTransition(current.version.status as ShotSkillStatus, 'deprecated');
  const updated = await db.update(shotSkillVersions).set({ status: 'deprecated', updatedAt: new Date() })
    .where(and(eq(shotSkillVersions.id, current.version.id), eq(shotSkillVersions.status, 'active'))).returning();
  if (!updated[0]) throw new Error('Shot Skill version could not be deprecated.');
  return { skill: current.skill, version: updated[0], definition: current.definition };
}

export async function retireShotSkillVersion(input: {
  teamId: number;
  userId: number;
  versionId: number;
}): Promise<TeamShotSkillVersion> {
  await assertWorkspaceOwner(input.teamId, input.userId);
  const current = await getAccessibleVersion({ teamId: input.teamId, versionId: input.versionId });
  if (!current || current.skill.ownerTeamId !== input.teamId) throw new Error('Private Shot Skill version not found.');
  assertShotSkillVersionTransition(current.version.status as ShotSkillStatus, 'retired');
  const updated = await db.update(shotSkillVersions).set({ status: 'retired', updatedAt: new Date() })
    .where(and(eq(shotSkillVersions.id, current.version.id), eq(shotSkillVersions.status, 'deprecated'))).returning();
  if (!updated[0]) throw new Error('Shot Skill version could not be retired.');
  return { skill: current.skill, version: updated[0], definition: current.definition };
}
