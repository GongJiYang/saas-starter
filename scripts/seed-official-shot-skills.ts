import { seedOfficialShotSkills } from '../lib/shot-skills/official';

async function main() {
  const createdBy = Number(process.env.SHOT_SKILL_SEED_USER_ID);
  if (!Number.isSafeInteger(createdBy) || createdBy <= 0) {
    throw new Error('Set SHOT_SKILL_SEED_USER_ID to an existing internal user ID before seeding official Shot Skills.');
  }

  const seeded = await seedOfficialShotSkills(createdBy);
  console.info(JSON.stringify({ seeded }, null, 2));
}

void main();
