import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { shotSkillVersions, shotSkills } from '@/lib/db/schema';
import { hashShotSkillDefinition } from './compiler';
import { shotSkillRegistry } from './registry';

export async function seedOfficialShotSkills(createdBy: number) {
  if (!Number.isSafeInteger(createdBy) || createdBy <= 0) {
    throw new Error('A valid user ID is required to seed official Shot Skills.');
  }

  return db.transaction(async (tx) => {
    const seeded = [];
    for (const definition of shotSkillRegistry) {
      const insertedSkill = await tx.insert(shotSkills).values({
        stableId: definition.id,
        name: definition.name,
        description: definition.description,
        createdBy,
      }).onConflictDoNothing().returning();

      const skill = insertedSkill[0] ?? (await tx.select().from(shotSkills).where(and(
        eq(shotSkills.stableId, definition.id),
        isNull(shotSkills.ownerTeamId),
      )).limit(1))[0];
      if (!skill) throw new Error(`Official Shot Skill ${definition.id} could not be resolved.`);

      const insertedVersion = await tx.insert(shotSkillVersions).values({
        shotSkillId: skill.id,
        version: definition.version,
        specVersion: definition.specVersion,
        status: 'active',
        normalizedDefinition: definition,
        definitionHash: hashShotSkillDefinition(definition),
        provenance: definition.provenance,
        createdBy,
        publishedAt: new Date(),
      }).onConflictDoNothing().returning();

      const version = insertedVersion[0] ?? (await tx.select().from(shotSkillVersions).where(and(
        eq(shotSkillVersions.shotSkillId, skill.id),
        eq(shotSkillVersions.version, definition.version),
      )).limit(1))[0];
      if (!version) throw new Error(`Official Shot Skill version ${definition.id}@${definition.version} could not be resolved.`);
      if (version.definitionHash !== hashShotSkillDefinition(definition)) {
        throw new Error(`Official Shot Skill ${definition.id}@${definition.version} does not match the code-owned definition.`);
      }
      seeded.push({ stableId: skill.stableId, version: version.version, versionId: version.id });
    }
    return seeded;
  });
}
