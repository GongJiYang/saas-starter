import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { shotSkillVersions, shotSkills } from '../lib/db/schema';
import {
  hashShotSkillDefinition,
  stableStringify,
} from '../lib/shot-skills/compiler';
import { shotSkillCardSchema } from '../lib/shot-skills/schema';
import { shotSkillRegistry } from '../lib/shot-skills/registry';

async function main() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`ALTER TABLE shot_skill_versions DISABLE TRIGGER shot_skill_versions_immutable_after_draft`);
    const rows = await tx.select({ skill: shotSkills, version: shotSkillVersions })
      .from(shotSkillVersions)
      .innerJoin(shotSkills, eq(shotSkillVersions.shotSkillId, shotSkills.id));
    for (const row of rows) {
      const officialDefinition = row.skill.ownerTeamId === null
        ? shotSkillRegistry.find((definition) => (
          definition.id === row.skill.stableId && definition.version === row.version.version
        ))
        : undefined;
      const normalized = officialDefinition ?? shotSkillCardSchema.parse(row.version.normalizedDefinition);
      const definitionHash = hashShotSkillDefinition(normalized);
      if (
        row.version.definitionHash !== definitionHash
        || stableStringify(row.version.normalizedDefinition) !== stableStringify(normalized)
      ) {
        await tx.update(shotSkillVersions).set({
          normalizedDefinition: normalized,
          definitionHash,
        }).where(eq(shotSkillVersions.id, row.version.id));
      }
    }
    await tx.execute(sql`ALTER TABLE shot_skill_versions ENABLE TRIGGER shot_skill_versions_immutable_after_draft`);
  });
  console.info('Shot Skill definitions and executable hashes are normalized.');
}

void main();
