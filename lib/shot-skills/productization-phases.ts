export type ShotSkillProductizationPhaseId = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

type Workstream = { name: string; taskRange: string };

export type ShotSkillProductizationPhase = {
  id: ShotSkillProductizationPhaseId;
  name: string;
  dependsOn: ShotSkillProductizationPhaseId[];
  execution: 'serial' | 'parallel';
  workstreams: Workstream[];
};

export const shotSkillProductizationPhases: readonly ShotSkillProductizationPhase[] = [
  { id: 'P0', name: 'Contract freeze', dependsOn: [], execution: 'serial', workstreams: [
    { name: 'Persistence contracts', taskRange: 'SKDB-01..SKDB-03' },
    { name: 'JSON contract', taskRange: 'SKIO-01' },
    { name: 'QA contracts', taskRange: 'SKQA-01..SKQA-03' },
  ] },
  { id: 'P1', name: 'Data foundation', dependsOn: ['P0'], execution: 'serial', workstreams: [
    { name: 'Persistence model', taskRange: 'SKDB-04..SKDB-12' },
    { name: 'Official migration and execution binding', taskRange: 'SKDB-19..SKDB-20' },
  ] },
  { id: 'P2', name: 'Parallel foundations', dependsOn: ['P1'], execution: 'parallel', workstreams: [
    { name: 'Library queries', taskRange: 'SKLIB-01..SKLIB-04' },
    { name: 'Editor foundation', taskRange: 'SKEDIT-01..SKEDIT-12' },
    { name: 'Import/export engine', taskRange: 'SKIO-02..SKIO-12' },
    { name: 'QA mapping', taskRange: 'SKQA-04..SKQA-13' },
  ] },
  { id: 'P3', name: 'Product operations', dependsOn: ['P2'], execution: 'parallel', workstreams: [
    { name: 'Library UI', taskRange: 'SKLIB-05..SKLIB-14' },
    { name: 'Editor workflow', taskRange: 'SKEDIT-13..SKEDIT-20' },
    { name: 'Import/export UI', taskRange: 'SKIO-13..SKIO-14' },
    { name: 'QA evidence', taskRange: 'SKQA-14..SKQA-24' },
  ] },
  { id: 'P4', name: 'Production clean cutover', dependsOn: ['P3'], execution: 'serial', workstreams: [
    { name: 'Runtime cutover', taskRange: 'SKCUT-01..SKCUT-10' },
  ] },
  { id: 'P5', name: 'End-to-end acceptance', dependsOn: ['P4'], execution: 'serial', workstreams: [
    { name: 'Private Skill production loop', taskRange: 'Draft..JSON Export' },
  ] },
] as const;

export const shotSkillStrictDependencies = [
  ['Editor save', 'Database Draft operation'],
  ['Testing release', 'Normalized definition hash'],
  ['Active release', 'Persisted validation evidence'],
  ['Production cutover', 'Three migrated Official Skills'],
  ['Skill QA', 'Frozen Recipe'],
  ['Metrics', 'QA and Review evidence'],
  ['Import', 'Private Draft write'],
  ['Registry fallback removal', 'Database Resolver'],
] as const;

function getPhase(id: ShotSkillProductizationPhaseId): ShotSkillProductizationPhase {
  const phase = shotSkillProductizationPhases.find((candidate) => candidate.id === id);
  if (!phase) throw new Error(`Unknown Shot Skill productization phase ${id}.`);
  return phase;
}

export function assertShotSkillPhaseCanStart(
  id: ShotSkillProductizationPhaseId,
  completed: ReadonlySet<ShotSkillProductizationPhaseId>,
): void {
  const missing = getPhase(id).dependsOn.filter((dependency) => !completed.has(dependency));
  if (missing.length > 0) throw new Error(`${id} cannot start before ${missing.join(', ')}.`);
}

export function createShotSkillProductizationPlan(
  target: ShotSkillProductizationPhaseId,
): ShotSkillProductizationPhase[] {
  const targetIndex = shotSkillProductizationPhases.findIndex((phase) => phase.id === target);
  if (targetIndex < 0) throw new Error(`Unknown Shot Skill productization phase ${target}.`);
  return shotSkillProductizationPhases.slice(0, targetIndex + 1).map((phase) => ({
    ...phase,
    dependsOn: [...phase.dependsOn],
    workstreams: phase.workstreams.map((workstream) => ({ ...workstream })),
  }));
}
