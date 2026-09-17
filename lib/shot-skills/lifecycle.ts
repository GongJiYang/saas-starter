import type { ShotSkillStatus } from './schema';

const transitions: Record<ShotSkillStatus, readonly ShotSkillStatus[]> = {
  draft: ['testing'],
  testing: ['active'],
  active: ['deprecated'],
  deprecated: ['retired'],
  retired: [],
};

export function canTransitionShotSkillVersion(
  from: ShotSkillStatus,
  to: ShotSkillStatus,
): boolean {
  return transitions[from].includes(to);
}

export function assertShotSkillVersionTransition(
  from: ShotSkillStatus,
  to: ShotSkillStatus,
): void {
  if (!canTransitionShotSkillVersion(from, to)) {
    throw new Error(`Invalid Shot Skill version transition: ${from} → ${to}`);
  }
}
