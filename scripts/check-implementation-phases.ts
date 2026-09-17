import assert from 'node:assert/strict';
import { assertPhaseCanStart, createImplementationPlan, implementationBoundaries, implementationPhases, runImplementationPlan, type ImplementationPhaseId } from '../lib/implementation/phases';

const ids = implementationPhases.map((phase) => phase.id);
assert.deepEqual(ids, ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
assert.deepEqual(createImplementationPlan('P3').map((phase) => phase.id), ['P0', 'P1', 'P2', 'P3']);
assert.deepEqual(implementationPhases.find((phase) => phase.id === 'P2')?.checks.map((check) => check.script), ['bulk:csv-check', 'references:check']);
assert.equal(implementationPhases.find((phase) => phase.id === 'P2')?.runChecksInParallel, true);
assert.equal(implementationPhases.filter((phase) => phase.runChecksInParallel).length, 1);
assert.deepEqual(implementationBoundaries.p0ParallelWork, [['GATE-02', 'GATE-03', 'GATE-04'], ['SKILL-01', 'SKILL-16']]);
assert.equal(implementationBoundaries.p0DecisionGate.waitsFor, 'Skill A/B decision');
assert.throws(() => assertPhaseCanStart('P3', new Set<ImplementationPhaseId>(['P0', 'P1'])), /P2/);
assert.throws(() => assertPhaseCanStart('P4', new Set<ImplementationPhaseId>(['P0', 'P1', 'P2'])), /P3/);
assert.throws(() => assertPhaseCanStart('P5', new Set<ImplementationPhaseId>(['P0', 'P1', 'P2', 'P3'])), /P4/);
assert.doesNotThrow(() => assertPhaseCanStart('P6', new Set<ImplementationPhaseId>(['P0', 'P1', 'P2', 'P3', 'P4', 'P5'])));

async function main(): Promise<void> {
  const targetArgument = process.argv.find((argument) => argument.startsWith('--run='));
  if (targetArgument) {
    const target = targetArgument.slice('--run='.length) as ImplementationPhaseId;
    if (!ids.includes(target)) throw new Error(`Unknown implementation phase ${target}.`);
    await runImplementationPlan(target);
  }
  console.info('Implementation phase boundary checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
