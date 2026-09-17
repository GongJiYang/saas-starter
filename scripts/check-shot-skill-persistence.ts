import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import {
  activateShotSkillVersion,
  createPrivateShotSkillDraft,
  createShotSkillDraftFromVersion,
  deprecateShotSkillVersion,
  retireShotSkillVersion,
  getShotSkillVersionForTeam,
  recordShotSkillReleaseValidation,
  submitShotSkillVersionForTesting,
  updatePrivateShotSkillDraft,
} from '../lib/shot-skills';
import { SHOT_SKILL_PREVIEW_FIXTURE } from '../lib/shot-skills/library';
import { productHeroSkill } from '../lib/shot-skills/cards/product-hero';
import { db } from '../lib/db/drizzle';
import { shotSkillReleaseValidations, shotSkillVersions, shotSkills } from '../lib/db/schema';

async function main() {
  const teamId = Number(process.env.SHOT_SKILL_TEST_TEAM_ID);
  const userId = Number(process.env.SHOT_SKILL_TEST_USER_ID);
  if (!Number.isSafeInteger(teamId) || !Number.isSafeInteger(userId)) {
    throw new Error('Set SHOT_SKILL_TEST_TEAM_ID and SHOT_SKILL_TEST_USER_ID to a workspace owner.');
  }

  const definition = {
    ...productHeroSkill,
    id: 'skill-persistence-check',
    version: '1.0.0',
    name: 'Skill persistence check',
    description: 'Ephemeral database contract verification.',
  };

  let skillId: number | null = null;
  let releaseVersionId: number | null = null;
  try {
    const draft = await createPrivateShotSkillDraft({ teamId, userId, definition });
    skillId = draft.skill.id;
    assert.equal(draft.version.status, 'draft');

    const editedDefinition = { ...definition, description: 'Updated before testing.' };
    const edited = await updatePrivateShotSkillDraft({
      teamId,
      userId,
      versionId: draft.version.id,
      expectedRevision: draft.version.revision,
      definition: editedDefinition,
    });
    assert.equal(edited.definition.description, 'Updated before testing.');

    const testing = await submitShotSkillVersionForTesting({ teamId, userId, versionId: edited.version.id });
    assert.equal(testing.version.status, 'testing');
    releaseVersionId = testing.version.id;
    await assert.rejects(
      () => activateShotSkillVersion({ teamId, userId, versionId: testing.version.id }),
      /controlled Fixture validation/,
    );
    await recordShotSkillReleaseValidation({
      teamId,
      userId,
      versionId: testing.version.id,
      fixture: SHOT_SKILL_PREVIEW_FIXTURE,
    });

    const active = await activateShotSkillVersion({ teamId, userId, versionId: testing.version.id });
    assert.equal(active.version.status, 'active');
    await assert.rejects(
      () => db.update(shotSkillVersions).set({ normalizedDefinition: definition }).where(eq(shotSkillVersions.id, active.version.id)),
      /immutable/,
    );

    const successor = await createShotSkillDraftFromVersion({ teamId, userId, sourceVersionId: active.version.id });
    assert.equal(successor.version.version, '1.0.1');
    assert.equal(successor.version.parentVersionId, active.version.id);

    const successorEdited = await updatePrivateShotSkillDraft({
      teamId,
      userId,
      versionId: successor.version.id,
      expectedRevision: successor.version.revision,
      definition: { ...successor.definition, description: 'One revision only.' },
    });
    await assert.rejects(
      () => updatePrivateShotSkillDraft({
        teamId,
        userId,
        versionId: successor.version.id,
        expectedRevision: successor.version.revision,
        definition: { ...successorEdited.definition, description: 'Stale write.' },
      }),
      /changed by another editor/,
    );

    const deprecated = await deprecateShotSkillVersion({ teamId, userId, versionId: active.version.id });
    assert.equal(deprecated.version.status, 'deprecated');
    const retired = await retireShotSkillVersion({ teamId, userId, versionId: deprecated.version.id });
    assert.equal(retired.version.status, 'retired');
    const historical = await getShotSkillVersionForTeam({
      teamId,
      versionId: retired.version.id,
    });
    assert.equal(historical?.version.status, 'retired');
    assert.equal(historical?.version.definitionHash, retired.version.definitionHash);

    console.info('Shot Skill persistence checks passed.');
  } finally {
    if (skillId) {
      if (releaseVersionId) {
        await db.delete(shotSkillReleaseValidations).where(eq(shotSkillReleaseValidations.shotSkillVersionId, releaseVersionId));
      }
      await db.delete(shotSkillVersions).where(eq(shotSkillVersions.shotSkillId, skillId));
      await db.delete(shotSkills).where(eq(shotSkills.id, skillId));
    }
  }
}

void main();
