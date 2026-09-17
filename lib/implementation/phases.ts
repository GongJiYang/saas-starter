import { spawn } from 'node:child_process';

export type ImplementationPhaseId = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';

type Check = { name: string; script: string };
type Phase = {
  id: ImplementationPhaseId;
  dependsOn: ImplementationPhaseId[];
  checks: Check[];
  runChecksInParallel?: boolean;
};

export const implementationPhases: readonly Phase[] = [
  { id: 'P0', dependsOn: [], checks: [{ name: 'Shot Skill contracts', script: 'a1:check' }] },
  { id: 'P1', dependsOn: ['P0'], checks: [{ name: 'Bulk contracts', script: 'bulk:contract-check' }, { name: 'Bulk data model', script: 'bulk:model-check' }] },
  { id: 'P2', dependsOn: ['P1'], runChecksInParallel: true, checks: [{ name: 'CSV input chain', script: 'bulk:csv-check' }, { name: 'Reference input chain', script: 'references:check' }] },
  { id: 'P3', dependsOn: ['P2'], checks: [{ name: 'Creative Spec approval', script: 'creative-spec:check' }] },
  { id: 'P4', dependsOn: ['P3'], checks: [{ name: 'Production Batch scheduling', script: 'production-batch:check' }, { name: 'Quality stop-loss', script: 'quality:check' }] },
  { id: 'P5', dependsOn: ['P4'], checks: [{ name: 'Catalog and Batch workbench', script: 'catalog:check' }] },
  { id: 'P6', dependsOn: ['P5'], checks: [{ name: 'Production build', script: 'build' }] },
] as const;

export const implementationBoundaries = {
  p0ParallelWork: [['GATE-02', 'GATE-03', 'GATE-04'], ['SKILL-01', 'SKILL-16']] as const,
  p0DecisionGate: { blocked: ['GATE-05', 'GATE-06', 'GATE-07', 'GATE-08'], waitsFor: 'Skill A/B decision' },
  p2ParallelWork: [['CSV-01', 'CSV-19'], ['REF-01', 'REF-13']] as const,
  p4WaitsFor: 'Creative Spec approval contract',
  p5WaitsFor: 'corresponding queries and writes',
} as const;

function phaseById(id: ImplementationPhaseId): Phase {
  const phase = implementationPhases.find((candidate) => candidate.id === id);
  if (!phase) throw new Error(`Unknown implementation phase ${id}.`);
  return phase;
}

export function createImplementationPlan(target: ImplementationPhaseId): Phase[] {
  const targetIndex = implementationPhases.findIndex((phase) => phase.id === target);
  if (targetIndex < 0) throw new Error(`Unknown implementation phase ${target}.`);
  return implementationPhases.slice(0, targetIndex + 1).map((phase) => ({ ...phase, checks: [...phase.checks], dependsOn: [...phase.dependsOn] }));
}

export function assertPhaseCanStart(id: ImplementationPhaseId, completed: ReadonlySet<ImplementationPhaseId>): void {
  const missing = phaseById(id).dependsOn.filter((dependency) => !completed.has(dependency));
  if (missing.length > 0) throw new Error(`${id} cannot start before ${missing.join(', ')}.`);
}

function runScript(check: Check): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', [check.script], { env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${check.name} failed${signal ? ` with ${signal}` : ` with exit code ${code ?? 'unknown'}`}.`));
    });
  });
}

export async function runImplementationPlan(target: ImplementationPhaseId): Promise<void> {
  const completed = new Set<ImplementationPhaseId>();
  for (const phase of createImplementationPlan(target)) {
    assertPhaseCanStart(phase.id, completed);
    console.info(`\n[${phase.id}] ${phase.checks.map((check) => check.name).join(', ')}`);
    if (phase.runChecksInParallel) await Promise.all(phase.checks.map(runScript));
    else for (const check of phase.checks) await runScript(check);
    completed.add(phase.id);
  }
}
