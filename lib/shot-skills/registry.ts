import { productHeroSkill } from './cards/product-hero';
import { productMacroDetailSkill } from './cards/product-macro-detail';
import { productUseCaseSkill } from './cards/product-use-case';
import { shotSkillCardSchema, type ShotSkillCard } from './schema';

const builtInSkills = [
  productHeroSkill,
  productMacroDetailSkill,
  productUseCaseSkill,
] as const;

function validateRegistry(skills: readonly ShotSkillCard[]): readonly ShotSkillCard[] {
  const keys = new Set<string>();

  for (const skill of skills) {
    const parsed = shotSkillCardSchema.parse(skill);
    const key = `${parsed.id}@${parsed.version}`;
    if (keys.has(key)) {
      throw new Error(`Duplicate Shot Skill Card: ${key}`);
    }
    keys.add(key);

    if (parsed.fallbackSkillId && parsed.fallbackSkillId === parsed.id) {
      throw new Error(`Shot Skill Card cannot fall back to itself: ${key}`);
    }
  }

  return skills;
}

export const shotSkillRegistry = validateRegistry(builtInSkills);

export function getShotSkill(id: string, version?: string): ShotSkillCard | undefined {
  return shotSkillRegistry.find(
    (skill) => skill.id === id && (version === undefined || skill.version === version),
  );
}
